# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Source Map Cloner is a tool that fetches source maps from websites and recreates the original file structure locally. It's useful for analyzing minified JavaScript code by extracting the original source files.

## Development Commands

### Build and Type Checking
```bash
# Build the TypeScript project
npm run build

# Type check without emitting files
npm run typecheck
```

### Running the Tool
```bash
# Run the CLI tool with tsx (development)
npm run fetch-source -- <url> [directory]

# After building, run directly
node dist/cli.js <url> [directory]

# With multiple URLs
node dist/cli.js -u url1 -u url2 [directory]

# With crawling enabled
node dist/cli.js --crawl <url> [directory]
```

## Architecture

### Core Components

1. **CLI Entry Point** (`src/cli.ts`)
   - Handles command-line arguments using yargs
   - Supports single URL or crawling mode
   - Manages HTTP headers and user-agent configuration
   - Orchestrates the source map fetching process

2. **Main Logic** (`src/index.ts`)
   - `fetchAndWriteSourcesForUrl`: Main function that processes a URL
   - Extracts JavaScript files from HTML using jsdom
   - Parses source maps using source-map-consumer
   - Handles Next.js build manifests (_buildManifest.js)
   - Writes extracted source files to disk maintaining directory structure

3. **HTTP Client** (`src/http.ts`)
   - Configures HTTP/HTTPS agents with custom ciphers
   - Sets up cookie jar for session persistence
   - Uses `got` library for HTTP requests with HTTP/2 support

4. **Utilities** (`src/utils.ts`)
   - Source map URL extraction from JavaScript files
   - Handles various URL formats (data URLs, absolute, relative)
   - Fetches source map content from different sources

### Key Features

- **Multiple URL Support**: Process multiple URLs in a single run
- **Crawling Mode**: Automatically discover and process linked pages
- **Path-based Saving**: Option to preserve URL paths in output directory structure
- **Source Deduplication**: Tracks seen sources to avoid duplicate processing
- **Concurrent Processing**: Uses p-map for parallel source fetching (concurrency: 20)

### Source Map Processing Flow

1. Load URL and extract all JavaScript file references
2. For each JS file, look for source map references
3. Parse source maps and extract original source content
4. Handle path normalization to prevent directory traversal
5. Write files to disk preserving original structure

### TypeScript Configuration

- Target: ESNext with ES modules
- Strict mode enabled
- Declaration files emitted
- Module resolution: Bundler
- Output directory: `dist/`

## Important Implementation Details

- Uses VM2 for safely executing JavaScript to extract build manifests
- Handles various source map URL formats (inline comments, data URLs)
- Prevents directory traversal attacks by validating output paths
- Supports custom HTTP headers for authentication
- Gracefully handles JSDOM errors that occur during page parsing
- File existence checks before overwriting to detect conflicts