A Node.js command-line tool to download Google Drive files and folders without authorization.

## Features

- ✅ Download single files or entire folders
- ✅ No Google authorization required
- ✅ Recursive folder downloads
- ✅ Progress tracking for large files
- ✅ Resume support (checks existing files)
- ✅ Preserve file modified times
- ✅ Handle quota exceeded errors gracefully
- ✅ Bulk download from URL list
- ✅ Zero dependencies (uses only Node.js built-in modules)

## Requirements

- Node.js >= 18.3.0 (uses native fetch API and `util.parseArgs`)

## Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/costinEEST/google-drive-download.git
cd google-drive-download

# Make executable (Unix/Linux/macOS)
chmod +x gdrive-dl.js

# Run directly
node gdrive-dl.js --help
```

### Global Installation (if published to npm)

```bash
npm install -g google-drive-download
```

## Usage

### Basic Examples

```bash
# Single file download
node gdrive-dl.js https://drive.google.com/file/d/FILE_ID/view

# Download using just the file ID
node gdrive-dl.js FILE_ID

# Download entire folder
node gdrive-dl.js https://drive.google.com/folders/FOLDER_ID

# Multiple files
node gdrive-dl.js url1 url2 url3
```

### Advanced Examples

```bash
# Download to specific directory
node gdrive-dl.js -P ./downloads https://drive.google.com/file/d/FILE_ID/view

# Download with custom filename
node gdrive-dl.js -O "My Document.pdf" https://drive.google.com/file/d/FILE_ID/view

# Download with all options
node gdrive-dl.js -P ./downloads -m -v https://drive.google.com/file/d/FILE_ID/view

# Quiet mode (no progress output)
node gdrive-dl.js -q https://drive.google.com/file/d/FILE_ID/view

# Continue on errors (useful for bulk downloads)
node gdrive-dl.js -e url1 url2 url3

# From URL file (one URL per line)
node gdrive-dl.js -f urls.txt -P ./downloads

# Debug mode
node gdrive-dl.js -d https://drive.google.com/file/d/FILE_ID/view
```

## Options

| Option                 | Short | Description                        | Default           |
| ---------------------- | ----- | ---------------------------------- | ----------------- |
| `--directory-prefix`   | `-P`  | Output directory                   | Current directory |
| `--output-document`    | `-O`  | Output filename (single file only) | Original filename |
| `--quiet`              | `-q`  | Disable console output             | `false`           |
| `--mtimes`             | `-m`  | Preserve modified times            | `false`           |
| `--debug`              | `-d`  | Enable debug logging               | `false`           |
| `--verbose`            | `-v`  | Debug + show HTML/headers          | `false`           |
| `--continue-on-errors` | `-e`  | Don't stop on first error          | `false`           |
| `--urlfile`            | `-f`  | Read URLs from text file           | -                 |
| `--help`               | `-h`  | Show help message                  | -                 |

## URL Formats Supported

The tool accepts various Google Drive URL formats:

```
https://drive.google.com/file/d/FILE_ID/view
https://drive.google.com/file/d/FILE_ID/edit
https://drive.google.com/folders/FOLDER_ID
https://drive.google.com/open?id=FILE_ID
https://drive.google.com/uc?id=FILE_ID
FILE_ID (just the ID)
```

## How It Works

1. **No Authentication**: Uses the public download endpoints that don't require OAuth
2. **Cookie Handling**: Manages cookies for download confirmations
3. **Stream Downloads**: Files are streamed to disk to handle large files efficiently
4. **Recursive Folders**: Parses folder pages to download all contents
5. **Progress Tracking**: Shows real-time download progress for files over 1MB

## Limitations

- Only works with publicly shared files/folders (link sharing must be enabled)
- Cannot download files that require authentication
- Google Drive's quota limits still apply
- Some file types may require download confirmation
- Very large files might be rate-limited by Google

## Troubleshooting

### "Does not have link sharing enabled"
The file/folder must be shared publicly. In Google Drive:
1. Right-click the file/folder
2. Click "Share"
3. Change "Restricted" to "Anyone with the link"

### "Quota exceeded"
This is a Google Drive limitation when too many users download a file. Try:
- Wait 24 hours and retry
- Ask the owner to make a copy of the file
- Use a different Google account (though this rarely helps)

### Large file confirmation
For large files, Google requires confirmation. The tool handles this automatically by:
1. Detecting the confirmation page
2. Extracting the confirmation token
3. Retrying with the token

## Credit

- Original Python implementation: [gdrivedl](https://github.com/matthuisman/gdrivedl) by [@matthuisman](https://github.com/matthuisman)

## License

MIT License - See [LICENSE](LICENSE) file for details

## Contributing

Pull requests are welcome! Please:
- Use only Node.js built-in modules (no external dependencies)
- Maintain compatibility with Node.js 18.3+
- Follow the existing code style
- Test with various file types and sizes

## TODO

- [ ] Add unit tests
- [ ] Add support for Google Docs/Sheets/Slides export
- [ ] Implement bandwidth limiting
- [ ] Add retry mechanism for network errors
- [ ] Support for proxies
- [ ] Parallel downloads for multiple files
```