#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { GDriveDL } from "./lib/gdrive-downloader.js";
import { Logger } from "./lib/logger.js";
import { parseArguments } from "./lib/argument-parser.js";

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

// Entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
