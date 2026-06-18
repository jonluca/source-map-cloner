# Source Map Cloner

A powerful TypeScript library and CLI tool for extracting and cloning source files from JavaScript source maps. Useful for analyzing minified JavaScript code by recovering the original source files.

## Features

- 🔍 **Source Map Extraction**: Automatically discovers and extracts source maps from JavaScript, MJS, and CJS files
- 🌐 **Multiple URL Support**: Process single URLs or crawl entire sites
- 🧩 **Framework-Aware Discovery**: Follows Next.js App Router Flight chunks and recursively discovers modern bundler imports
- 📁 **Structure Preservation**: Maintains original directory structure when extracting files
- 🚀 **TypeScript First**: Written in TypeScript with full type definitions
- 🔌 **Flexible Fetchers**: Built-in Node.js and browser-compatible HTTP fetchers
- 📦 **Programmatic API**: Use as a library in your own projects
- 🛠️ **CLI Tool**: Ready-to-use command-line interface

## Installation

```bash
npm install source-map-cloner
# or
yarn add source-map-cloner
# or
pnpm add source-map-cloner
```

## Usage

### CLI Usage

```bash
# Basic usage - extract source maps from a URL
npx source-map-cloner -u https://example.com -d output-directory

# Multiple URLs
npx source-map-cloner -u https://example.com -u https://another.com -d output-dir

# Enable crawling to discover linked pages
npx source-map-cloner --crawl -u https://example.com -d output-dir

# Custom headers for authentication
npx source-map-cloner -u https://example.com -H "Authorization: Bearer token" -d output-dir

# Custom user agent
npx source-map-cloner -u https://example.com -H "User-Agent: MyBot 1.0" -d output-dir

# Limit concurrent JavaScript requests and skip recovery of omitted sourcesContent
npx source-map-cloner -u https://example.com --concurrency 8 --no-fetch-missing-sources

# Limit recursive chunk discovery, or disable it entirely
npx source-map-cloner -u https://example.com --max-script-depth 2
npx source-map-cloner -u https://example.com --no-discover-referenced-scripts
```

### Programmatic API

#### Basic Example with Node.js Fetcher

```typescript
import { cloneSourceMaps, createConsoleLogger } from "source-map-cloner";
import { createNodeFetch } from "source-map-cloner/fetchers";

async function example() {
  const result = await cloneSourceMaps({
    urls: "https://example.com",
    fetch: createNodeFetch(),
    logger: createConsoleLogger(),
  });

  console.log(`Extracted ${result.stats.totalFiles} files`);
  console.log(`Total size: ${result.stats.totalSize} bytes`);

  // Access extracted files
  for (const [path, content] of result.files) {
    console.log(`File: ${path}, Size: ${content.length} bytes`);
  }
}
```

#### Advanced Example with Custom Options

```typescript
import { cloneSourceMaps, createConsoleLogger } from "source-map-cloner";
import { createNodeFetch } from "source-map-cloner/fetchers";

async function advancedExample() {
  const fetch = createNodeFetch({
    headers: {
      "User-Agent": "MyBot/1.0",
      Authorization: "Bearer token",
    },
  });

  const result = await cloneSourceMaps({
    urls: ["https://example.com", "https://another.com"],
    fetch,
    logger: createConsoleLogger(),
    crawl: true,
    verbose: true,
    headers: {
      "Accept-Language": "en-US",
    },
  });

  // Handle errors
  if (result.errors.length > 0) {
    console.error("Errors encountered:");
    for (const error of result.errors) {
      console.error(`- ${error.error} (URL: ${error.url || "N/A"})`);
    }
  }
}
```

#### Browser Usage

```typescript
import { cloneSourceMaps, noopLogger } from "source-map-cloner";
import { createBrowserFetch } from "source-map-cloner/fetchers";

async function browserExample() {
  const result = await cloneSourceMaps({
    urls: "https://example.com",
    fetch: createBrowserFetch(),
    logger: noopLogger, // Silent logger for browser environments
  });

  // Process results...
}
```

#### Custom Logger Implementation

```typescript
import { cloneSourceMaps, Logger } from "source-map-cloner";
import { createNodeFetch } from "source-map-cloner/fetchers";

const customLogger: Logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: (msg) => console.debug(`[DEBUG] ${msg}`),
};

const result = await cloneSourceMaps({
  urls: "https://example.com",
  fetch: createNodeFetch(),
  logger: customLogger,
});
```

#### Using the Default Node Fetcher

The `createNodeFetch` function creates a Node.js-compatible fetcher using the `got` library with sensible defaults:

```typescript
import { createNodeFetch } from "source-map-cloner/fetchers";

// Basic usage with default options
const fetch = createNodeFetch();

// With custom headers
const fetchWithAuth = createNodeFetch({
  headers: {
    Authorization: "Bearer token",
    "User-Agent": "MyApp/1.0",
  },
});

// The fetcher automatically handles:
// - HTTP/2 support
// - Cookie jar management
// - Custom cipher configuration for compatibility
// - Automatic retries on network failures
// - Proper encoding handling
```

## API Reference

### Main Functions

#### `cloneSourceMaps(options: CloneOptions): Promise<CloneResult>`

Main function to clone source maps from URLs.

**Options:**

- `urls`: Single URL string or array of URLs to process
- `fetch`: Fetch function for HTTP requests (use `createNodeFetch()` or `createBrowserFetch()`)
- `logger?`: Optional logger instance (defaults to no-op logger)
- `crawl?`: Enable crawling to discover linked pages
- `cleanupKnownInvalidFiles?`: Remove known invalid files
- `headers?`: Additional HTTP headers
- `verbose?`: Enable verbose logging
- `concurrency?`: Maximum concurrent JavaScript requests (defaults to `20`)
- `fetchMissingSources?`: Fetch referenced source files when `sourcesContent` is absent (defaults to `true`)
- `discoverReferencedScripts?`: Follow JavaScript referenced by fetched bundles (defaults to `true`)
- `maxScriptDepth?`: Maximum recursive chunk-discovery depth (defaults to `3`)

**Returns:** `CloneResult` with extracted files, statistics, and errors

### Fetchers

#### `createNodeFetch(options?)`

Creates a Node.js-compatible fetch function using `got`.

**Options:**

- `headers?`: Default headers to include with all requests

#### `createBrowserFetch()`

Creates a browser-compatible fetch function using the native Fetch API.

### Logger Utilities

#### `createConsoleLogger()`

Creates a logger that outputs to the console.

#### `noopLogger`

A silent logger that discards all output (useful for production or browser environments).

### Types

```typescript
interface CloneResult {
  files: Map<string, string>; // Map of file paths to contents
  stats: {
    totalFiles: number;
    totalSize: number;
    urls: string[];
    duration?: number;
  };
  errors: Array<{
    url?: string;
    file?: string;
    error: string;
  }>;
  warnings: Array<{
    url?: string;
    file?: string;
    warning: string;
  }>;
}

interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug?: (message: string) => void;
}

interface FetchFunction {
  (
    url: string,
    options?: { headers?: Record<string, string> },
  ): Promise<{
    body: string;
    statusCode: number;
    requestUrl: string;
  }>;
}
```

## How It Works

1. **URL Processing**: Fetches the HTML content from provided URLs
2. **JavaScript Discovery**: Extracts all JavaScript file references from the HTML
3. **Source Map Detection**: Searches for source map references in JavaScript files (both inline and external)
4. **Source Extraction**: Parses source maps and extracts original source content
5. **File Creation**: Returns a map of file paths to their contents

The tool handles various source map formats:

- External source map files (`//# sourceMappingURL=...`)
- Inline data URLs
- Next.js build manifests (`_buildManifest.js`)
- Next.js App Router chunks embedded in `self.__next_f` Flight payloads, including CDN asset prefixes
- Static and dynamic JavaScript imports emitted by Vite, Rollup, SvelteKit, Nuxt, Astro, Remix/React Router, and similar bundlers
- Maps without `sourcesContent` when their source URLs remain fetchable
- Indexed source maps and maps prefixed with a BOM or common JSON-hijacking guards

When multiple maps contain different content for the same normalized path, the first file keeps the original name and later files are preserved with names such as `app.conflict-2.ts`. These are returned as non-fatal warnings.

## Development

### Building

```bash
npm run build
```

### Type Checking

```bash
npm run typecheck
```

### Running in Development

```bash
npm run fetch-source -- -u https://example.com -d output-dir
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Security

This tool is designed for legitimate security research and debugging purposes. Please ensure you have permission before extracting source maps from websites you don't own.
