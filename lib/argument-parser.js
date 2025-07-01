import { parseArgs } from "node:util";

export function parseArguments() {
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
