import { mkdir, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";

import { CookieManager } from "./cookie-manager.js";
import { Logger } from "./logger.js";
import {
  ITEM_URL,
  FILE_URL,
  FOLDER_URL,
  USER_AGENT,
  FOLDER_PATTERN,
  CONFIRM_PATTERNS,
  UUID_PATTERN,
  FILENAME_PATTERN,
} from "./constants.js";
import { sanitize, urlToId, parseModifiedTime } from "./utils.js";
import { fileExists, setModifiedTime } from "./file-utils.js";

export class GDriveDL {
  constructor(options = {}) {
    this.quiet = options.quiet || false;
    this.overwrite = options.overwrite || false;
    this.mtimes = options.mtimes || false;
    this.continueOnErrors = options.continueOnErrors || false;
    this.createEmptyDirs = true;
    this.processed = [];
    this.errors = [];
    this.cookieManager = new CookieManager();
    this.logger = options.logger || new Logger("info");
  }

  async request(url) {
    this.logger.debug(`Requesting: ${url}`);

    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Cookie: this.cookieManager.getCookieString(),
      },
      redirect: "manual",
    });

    // Handle redirects manually to capture cookies
    if (response.status >= 300 && response.status < 400) {
      this.cookieManager.parseCookies(response.headers.get("set-cookie"));
      const location = response.headers.get("location");
      if (location) {
        return this.request(location);
      }
    }

    this.cookieManager.parseCookies(response.headers.get("set-cookie"));
    return response;
  }

  error(message) {
    this.logger.error(message);
    this.errors.push(message);
    if (!this.continueOnErrors) {
      process.exit(1);
    }
  }

  async processFile(
    id,
    directory,
    verbose,
    filename = null,
    modified = null,
    confirm = "",
    uuid = ""
  ) {
    let filePath = null;
    const modifiedTs = parseModifiedTime(modified);

    if (filename) {
      filePath = isAbsolute(filename) ? filename : join(directory, filename);
      if (await fileExists(filePath, modifiedTs, this.overwrite)) {
        this.logger.info(`${filePath} [Exists]`);
        return;
      }
    }

    let url = FILE_URL(id);
    if (confirm) url += `&confirm=${confirm}`;
    if (uuid) url += `&uuid=${uuid}`;

    const response = await this.request(url);

    if (response.url.includes("ServiceLogin")) {
      this.error(`${id}: does not have link sharing enabled`);
      return;
    }

    const contentDisposition = response.headers.get("content-disposition");

    if (!contentDisposition) {
      // Need to read response body to find confirm token
      const html = await response.text();

      if (html.includes("Google Drive - Quota exceeded")) {
        this.error(`${id}: Quota exceeded for this file`);
        return;
      }

      // Find confirm token
      let confirmMatch = null;
      for (const pattern of CONFIRM_PATTERNS) {
        confirmMatch = html.match(pattern);
        if (confirmMatch) break;
      }

      const uuidMatch = html.match(UUID_PATTERN);
      const newUuid = uuidMatch ? uuidMatch[1] : "";

      if (confirmMatch) {
        const newConfirm = confirmMatch[1];
        this.logger.debug(`Found confirmation '${newConfirm}', trying it`);
        return this.processFile(
          id,
          directory,
          verbose,
          filename,
          modified,
          newConfirm,
          newUuid
        );
      } else {
        this.logger.debug("Trying confirmation 't' as a last resort");
        return this.processFile(
          id,
          directory,
          verbose,
          filename,
          modified,
          "t",
          newUuid
        );
      }
    }

    if (!filePath) {
      const filenameMatch = contentDisposition.match(FILENAME_PATTERN);
      if (filenameMatch) {
        filename = filenameMatch[1];
        filePath = join(directory, sanitize(filename));
        if (await fileExists(filePath, modifiedTs, this.overwrite)) {
          this.logger.info(`${filePath} [Exists]`);
          return;
        }
      }
    }

    // Create directory if needed
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });

    // Download file with progress
    await this.downloadFile(response, filePath);

    // Set modified time if available
    if (modifiedTs) {
      await setModifiedTime(filePath, modifiedTs);
    }
  }

  async downloadFile(response, filePath) {
    let downloadedBytes = 0;
    let lastOutput = 0;

    const progressStream = new PassThrough();

    // Only need 'data' event for progress
    progressStream.on("data", (chunk) => {
      downloadedBytes += chunk.length;

      if (!this.quiet && downloadedBytes - lastOutput > 1048576) {
        process.stdout.write(
          `\r${filePath} ${(downloadedBytes / 1024 / 1024).toFixed(2)}MB`
        );
        lastOutput = downloadedBytes;
      }
    });

    try {
      await pipeline(
        response.body,
        progressStream,
        createWriteStream(filePath)
      );

      if (!this.quiet) process.stdout.write("\n");
    } catch (error) {
      // Pipeline already cleaned up the streams
      await unlink(filePath).catch(() => {});
      throw error;
    }
  }

  async processFolder(id, directory, verbose) {
    if (this.processed.includes(id)) {
      this.logger.debug(`Skipping already processed folder: ${id}`);
      return;
    }

    this.processed.push(id);
    const response = await this.request(FOLDER_URL(id));
    const html = await response.text();

    if (verbose) {
      this.logger.debug(`HTML page contents:\n\n${html}\n\n`);
    }

    const matches = [...html.matchAll(FOLDER_PATTERN)];

    if (!matches.length && html.includes("ServiceLogin")) {
      this.error(`${id}: does not have link sharing enabled`);
      return;
    }

    for (const match of matches) {
      const [, url, itemName, modified] = match;
      const itemId = urlToId(url);

      if (!itemId) {
        this.error(`${url}: Unable to find ID from url`);
        continue;
      }

      if (url.toLowerCase().includes("/file/")) {
        await this.processFile(
          itemId,
          directory,
          verbose,
          sanitize(itemName),
          modified
        );
      } else if (url.toLowerCase().includes("/folders/")) {
        await this.processFolder(
          itemId,
          join(directory, sanitize(itemName)),
          verbose
        );
      }
    }

    // Create empty directory if needed
    if (this.createEmptyDirs) {
      await mkdir(directory, { recursive: true });
      this.logger.info(`Directory: ${directory} [Created]`);
    }
  }

  async processUrl(url, directory, verbose, filename = null) {
    const id = urlToId(url);
    if (!id) {
      this.error(`${url}: Unable to find ID from url`);
      return;
    }

    // Check if it's a file or folder
    const lowerUrl = url.toLowerCase();
    if (!lowerUrl.includes("://")) {
      const response = await this.request(ITEM_URL(id));
      url = response.url;
    }

    if (url.includes("/file/") || url.includes("/uc?")) {
      await this.processFile(id, directory, verbose, filename);
    } else if (url.includes("/folders/")) {
      if (filename) {
        this.logger.warn(
          "Ignoring --output-document option for folder download"
        );
      }
      await this.processFolder(id, directory, verbose);
    } else {
      this.error(`${id}: returned an unknown url ${url}`);
    }
  }
}
