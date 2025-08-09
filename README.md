# Source Map Cloner

A powerful TypeScript library and CLI tool for extracting and cloning source files from JavaScript source maps. Useful for analyzing minified JavaScript code by recovering the original source files.

## Features

- 🔍 **Source Map Extraction**: Automatically discovers and extracts source maps from JavaScript files
- 🌐 **Multiple URL Support**: Process single URLs or crawl entire sites
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
npx source-map-cloner https://example.com output-directory

# Multiple URLs
npx source-map-cloner -u https://example.com -u https://another.com output-dir

# Enable crawling to discover linked pages
npx source-map-cloner --crawl https://example.com output-dir

# Custom headers for authentication
npx source-map-cloner --header "Authorization: Bearer token" https://example.com output-dir

# Custom user agent
npx source-map-cloner --user-agent "MyBot 1.0" https://example.com output-dir
```

### Programmatic API

#### Basic Example with Node.js Fetcher

```typescript
import { cloneSourceMaps, createNodeFetch, createConsoleLogger } from 'source-map-cloner';
import { createNodeFetch } from 'source-map-cloner/fetchers';

async function example() {
  const result = await cloneSourceMaps({
    urls: 'https://example.com',
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
import { cloneSourceMaps, createConsoleLogger } from 'source-map-cloner';
import { createNodeFetch } from 'source-map-cloner/fetchers';

async function advancedExample() {
  const fetch = createNodeFetch({
    headers: {
      'User-Agent': 'MyBot/1.0',
      'Authorization': 'Bearer token'
    }
  });

  const result = await cloneSourceMaps({
    urls: ['https://example.com', 'https://another.com'],
    fetch,
    logger: createConsoleLogger(),
    crawl: true,
    verbose: true,
    headers: {
      'Accept-Language': 'en-US'
    }
  });

  // Handle errors
  if (result.errors.length > 0) {
    console.error('Errors encountered:');
    for (const error of result.errors) {
      console.error(`- ${error.error} (URL: ${error.url || 'N/A'})`);
    }
  }
}
```

#### Browser Usage

```typescript
import { cloneSourceMaps, noopLogger } from 'source-map-cloner';
import { createBrowserFetch } from 'source-map-cloner/fetchers';

async function browserExample() {
  const result = await cloneSourceMaps({
    urls: 'https://example.com',
    fetch: createBrowserFetch(),
    logger: noopLogger, // Silent logger for browser environments
  });

  // Process results...
}
```

#### Custom Logger Implementation

```typescript
import { cloneSourceMaps, Logger } from 'source-map-cloner';
import { createNodeFetch } from 'source-map-cloner/fetchers';

const customLogger: Logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: (msg) => console.debug(`[DEBUG] ${msg}`),
};

const result = await cloneSourceMaps({
  urls: 'https://example.com',
  fetch: createNodeFetch(),
  logger: customLogger,
});
```

#### Using the Default Node Fetcher

The `createNodeFetch` function creates a Node.js-compatible fetcher using the `got` library with sensible defaults:

```typescript
import { createNodeFetch } from 'source-map-cloner/fetchers';

// Basic usage with default options
const fetch = createNodeFetch();

// With custom headers
const fetchWithAuth = createNodeFetch({
  headers: {
    'Authorization': 'Bearer token',
    'User-Agent': 'MyApp/1.0'
  }
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
- `headers?`: Additional HTTP headers
- `verbose?`: Enable verbose logging

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
  files: Map<string, string>;  // Map of file paths to contents
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
}

interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug?: (message: string) => void;
}

interface FetchFunction {
  (url: string, options?: { headers?: Record<string, string> }): Promise<{
    body: string;
    statusCode: number;
    requestUrl: string;
  }>;
}
```

## How It Works

1. **Discovery Phase**
   - Fetches the target URL and parses HTML content
   - Extracts all JavaScript file references from `<script>` tags and other sources
   - Optionally crawls linked pages to discover more JavaScript files

2. **Source Map Extraction**
   - For each JavaScript file, looks for source map references
   - Supports multiple source map formats:
     - External `.map` files
     - Inline source maps (data URLs)
     - Source map comments in JavaScript files

3. **Source Reconstruction**
   - Parses source maps to extract original source code
   - Handles various source map formats (webpack, Next.js, etc.)
   - Preserves original directory structure

4. **File Writing**
   - Creates necessary directories
   - Writes source files with original content
   - Prevents directory traversal attacks
   - Handles duplicate files intelligently

## Use Cases

- **Security Research**: Analyze production applications for security vulnerabilities
- **Debugging Production Issues**: Understand minified code behavior in production
- **Learning**: Study how popular websites structure their applications
- **Migration**: Understand legacy codebases when source code is unavailable
- **Compliance**: Verify third-party code in production environments
- **Recovery**: Reconstruct source code when original files are lost

## Output Structure

The tool creates a directory structure that mirrors the original source:

```

output-directory/
├── src/
│ ├── components/
│ │ ├── Header.tsx
│ │ └── Footer.tsx
│ ├── utils/
│ │ └── helpers.js
│ └── index.js
├── node_modules/ (if included in source maps)
│ └── ...
└── webpack/ (webpack internals if present)
└── ...

```

## Limitations

- Only works with websites that include source maps in production
- Cannot recover source code if source maps don't include source content
- Some source maps may have incomplete or modified source content
- Rate limiting on target servers may affect crawling speed
- Very large sites may require significant disk space

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## License

MIT

## Credits

Some utilities and patterns are adapted from [webpack's source-map-loader](https://github.com/webpack-contrib/source-map-loader).

## Disclaimer

This tool is intended for legitimate purposes such as debugging, security research, and education. Users are responsible for ensuring they have permission to access and download source maps from target websites. Always respect intellectual property rights and terms of service.

```

```
