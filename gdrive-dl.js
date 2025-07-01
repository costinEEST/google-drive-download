import { readFile, mkdir, unlink, stat, utimes } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";
import { debuglog } from "node:util";

// Debug logger using built-in util.debuglog
const debug = debuglog("gdrive");

class CookieManager {
  constructor() {
    this.cookies = new Map();
  }

  parseCookies(setCookieHeaders) {
    if (!setCookieHeaders) return;
    const cookies = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : [setCookieHeaders];

    cookies.forEach((cookie) => {
      const [nameValue] = cookie.split(";");
      const [name, value] = nameValue.split("=");
      this.cookies.set(name.trim(), value.trim());
    });
  }

  getCookieString() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

const ITEM_URL = (id) => `https://drive.google.com/open?id=${id}`;
const FILE_URL = (id) =>
  `https://drive.usercontent.google.com/download?id=${id}&export=download&authuser=0`;
const FOLDER_URL = (id) =>
  `https://drive.google.com/embeddedfolderview?id=${id}#list`;
const CHUNKSIZE = 64 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const ID_PATTERNS = [
  /\/file\/d\/([0-9A-Za-z_-]{10,})(?:\/|$)/i,
  /\/folders\/([0-9A-Za-z_-]{10,})(?:\/|$)/i,
  /id=([0-9A-Za-z_-]{10,})(?:&|$)/i,
  /([0-9A-Za-z_-]{10,})/i,
];

const FOLDER_PATTERN =
  /<a href="(https:\/\/drive\.google\.com\/.*?)".*?<div class="flip-entry-title">(.*?)<\/div>.*?<div class="flip-entry-last-modified"><div>(.*?)<\/div>/gis;
const CONFIRM_PATTERNS = [
  /confirm=([0-9A-Za-z_-]+)/i,
  /name="confirm"\s+value="([0-9A-Za-z_-]+)"/i,
];
const UUID_PATTERN = /name="uuid"\s+value="([0-9A-Za-z_-]+)"/i;
const FILENAME_PATTERN = /filename="(.*?)"/i;

class Logger {
  constructor(level = "info") {
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
    this.level = this.levels[level] || 1;
  }

  debug(...args) {
    if (this.level <= 0) console.log("DEBUG:", ...args);
  }

  info(...args) {
    if (this.level <= 1) console.log("INFO:", ...args);
  }

  warn(...args) {
    if (this.level <= 2) console.warn("WARN:", ...args);
  }

  error(...args) {
    if (this.level <= 3) console.error("ERROR:", ...args);
  }
}

class GDriveDL {
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

  urlToId(url) {
    for (const pattern of ID_PATTERNS) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
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
    const modifiedTs = this.getModified(modified);

    if (filename) {
      filePath = isAbsolute(filename) ? filename : join(directory, filename);
      if (await this.exists(filePath, modifiedTs)) {
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
        if (await this.exists(filePath, modifiedTs)) {
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
      await this.setModified(filePath, modifiedTs);
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
      const itemId = this.urlToId(url);

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

  getModified(modified) {
    if (!modified || !this.mtimes) return null;

    try {
      const now = new Date();
      let date;

      if (modified.includes(":")) {
        // Time format: "3:45 PM"
        const [hour, minutePart] = modified.toLowerCase().split(":");
        let hours = parseInt(hour);
        const minutes = parseInt(minutePart);

        if (minutePart.includes("pm") && hours !== 12) hours += 12;
        if (minutePart.includes("am") && hours === 12) hours = 0;

        date = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            hours + 7,
            minutes
          )
        );
      } else if (modified.includes("/")) {
        // Date format: "12/25/23"
        const [month, day, year] = modified.split("/");
        date = new Date(
          2000 + parseInt(year),
          parseInt(month) - 1,
          parseInt(day)
        );
      } else {
        // Month day format: "Dec 25"
        date = new Date(modified + " " + now.getFullYear());
      }

      return Math.floor(date.getTime() / 1000);
    } catch (error) {
      this.logger.debug(`Failed to convert mtime: ${modified}`);
      return null;
    }
  }

  async setModified(filePath, timestamp) {
    if (!timestamp) return;

    try {
      const date = new Date(timestamp * 1000);
      await utimes(filePath, date, date);
    } catch (error) {
      this.logger.debug("Failed to set mtime");
    }
  }

  async exists(filePath, modified) {
    if (this.overwrite) return false;

    try {
      const stats = await stat(filePath);
      if (modified) {
        return Math.floor(stats.mtime.getTime() / 1000) === modified;
      }
      return true;
    } catch {
      return false;
    }
  }

  async processUrl(url, directory, verbose, filename = null) {
    const id = this.urlToId(url);
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

function parseArguments() {
  const { values, positionals } = parseArgs({
    options: {
      "directory-prefix": {
        type: "string",
        short: "P",
        default: ".",
      },
      "output-document": {
        type: "string",
        short: "O",
      },
      quiet: {
        type: "boolean",
        short: "q",
        default: false,
      },
      mtimes: {
        type: "boolean",
        short: "m",
        default: false,
      },
      debug: {
        type: "boolean",
        short: "d",
        default: false,
      },
      verbose: {
        type: "boolean",
        short: "v",
        default: false,
      },
      "continue-on-errors": {
        type: "boolean",
        short: "e",
        default: false,
      },
      urlfile: {
        type: "string",
        short: "f",
      },
      help: {
        type: "boolean",
        short: "h",
        default: false,
      },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Usage: node gdrive-dl.js [urls...] [options]

Options:
  -P, --directory-prefix    Output directory (default: current directory)
  -O, --output-document     Output filename (single file only)
  -q, --quiet              Disable console output
  -m, --mtimes             Use modified times to check for changed files
  -d, --debug              Debug level logging
  -v, --verbose            Debug logging with HTML/HTTP headers
  -e, --continue-on-errors Continue on errors
  -f, --urlfile            Text file containing URLs (one per line)
  -h, --help               Show this help message
`);
    process.exit(0);
  }

  return { values, positionals };
}

async function main() {
  const { values, positionals } = parseArguments();

  // Set verbose implies debug
  if (values.verbose) values.debug = true;

  // Configure logger
  const logLevel = values.debug ? "debug" : values.quiet ? "warn" : "info";
  const logger = new Logger(logLevel);

  // Collect URLs
  let urls = [...positionals];

  // Read URLs from file if specified
  if (values.urlfile) {
    try {
      const fileContent = await readFile(values.urlfile, "utf-8");
      const fileUrls = fileContent
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      urls.push(...fileUrls);
    } catch (error) {
      logger.error(`Failed to read URL file: ${error.message}`);
      process.exit(1);
    }
  }

  if (urls.length === 0) {
    logger.error("No URLs provided");
    process.exit(1);
  }

  // Warn about output-document with multiple URLs
  if (values["output-document"] && urls.length > 1) {
    logger.warn("Ignoring --output-document option for multiple url download");
    values["output-document"] = null;
  }

  // Create downloader instance
  const gdrive = new GDriveDL({
    quiet: values.quiet,
    overwrite: values["output-document"] !== undefined,
    mtimes: values.mtimes,
    continueOnErrors: values["continue-on-errors"],
    logger,
  });

  // Process each URL
  if (urls.length > 1) {
    logger.info(`Processing ${urls.length} urls`);
  }

  for (const url of urls) {
    await gdrive.processUrl(
      url,
      values["directory-prefix"],
      values.verbose,
      values["output-document"]
    );
  }

  // Exit with error if any errors occurred
  if (gdrive.errors.length > 0) {
    process.exit(1);
  }
}

function sanitize(filename) {
  const blacklist = ["\\", "/", ":", "*", "?", '"', "<", ">", "|", "\0"];
  const reserved = ["CON", "PRN", "AUX", "NUL", "COM1" /* ... */];

  // Decode HTML entities (like Python's unescape)
  filename = decodeURIComponent(filename);

  // Remove blacklisted characters
  filename = filename
    .split("")
    .filter((c) => !blacklist.includes(c))
    .join("");

  // Remove control characters (ASCII < 32)
  filename = filename
    .split("")
    .filter((c) => c.charCodeAt(0) > 31)
    .join("");

  // Trim dots and spaces
  filename = filename.replace(/[. ]+$/, "").trim();

  // Handle edge cases
  if (filename.split("").every((c) => c === ".")) filename = "_" + filename;
  if (reserved.includes(filename.toUpperCase())) filename = "_" + filename;
  if (!filename) filename = "_";

  // Handle length limits (255 chars)
  if (filename.length > 255) {
    const parts = filename.split(".");
    let ext = "";
    if (parts.length > 1) {
      ext = "." + parts.pop();
      filename = filename.slice(0, -ext.length);
    }
    filename = filename.slice(0, 255 - ext.length) + ext;
  }

  return filename;
}

// Entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
