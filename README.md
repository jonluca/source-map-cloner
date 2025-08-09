# Source Map Cloner

Extract and reconstruct original source files from production JavaScript source maps. This tool fetches source maps from websites and recreates the original file structure locally, making it invaluable for debugging minified code, security research, and understanding how production applications are built.

## Features

- 🔍 **Automatic Source Map Detection** - Finds and extracts source maps from JavaScript files
- 🕷️ **Web Crawling** - Recursively discover and process all JavaScript files on a site
- 📁 **Original Structure Preservation** - Maintains the original directory structure of source files
- 🚀 **Concurrent Processing** - Fast parallel fetching with configurable concurrency
- 📦 **Multiple URL Support** - Process multiple URLs in a single run
- 🔧 **Flexible Usage** - Use as a CLI tool or Node.js/Browser library
- 🌐 **Isomorphic** - Works in both Node.js and browser environments
- 💾 **In-Memory Processing** - All operations work in memory, file writing is optional
- 🎯 **Next.js Support** - Special handling for Next.js build manifests
- 🛡️ **Security Features** - Path traversal protection and header customization

## Installation

### Global CLI Installation

```bash
npm install -g source-map-cloner
```

### As a Project Dependency

```bash
npm install source-map-cloner
# or
yarn add source-map-cloner
```

### Development Setup

```bash
git clone https://github.com/yourusername/source-map-cloner.git
cd source-map-cloner
yarn install
yarn build
```

## Usage

### CLI Usage

#### Basic Usage

```bash
# Fetch source maps from a single URL
source-map-cloner -u https://example.com

# Specify output directory
source-map-cloner -u https://example.com -d ./output

# Process multiple URLs
source-map-cloner -u https://example.com -u https://example.com/page2

# Enable crawling to discover all pages
source-map-cloner -u https://example.com --crawl

# Preserve URL paths in output structure
source-map-cloner -u https://example.com --urlPathBasedSaving

# Add custom headers (useful for authentication)
source-map-cloner -u https://example.com -H "Authorization: Bearer token" -H "Cookie: session=abc"

# Verbose output for debugging
source-map-cloner -u https://example.com --verbose
```

#### CLI Options

| Option                 | Alias | Description                                         | Default       |
| ---------------------- | ----- | --------------------------------------------------- | ------------- |
| `--url`                | `-u`  | URL(s) to process (can be specified multiple times) | Required      |
| `--dir`                | `-d`  | Output directory for extracted files                | Site hostname |
| `--crawl`              | `-c`  | Enable crawling to discover linked pages            | `false`       |
| `--urlPathBasedSaving` | `-p`  | Include URL path in directory structure             | `false`       |
| `--headers`            | `-H`  | HTTP headers in "Name: Value" format                | `[]`          |
| `--verbose`            | `-v`  | Enable verbose logging                              | `false`       |

### Library Usage

#### Basic Example (Node.js)

```javascript
import cloneSourceMaps from "source-map-cloner";
import { createNodeFetch } from "source-map-cloner/node-fetch";

// Extract source maps into memory
const result = await cloneSourceMaps({
  urls: "https://example.com",
  fetch: createNodeFetch(), // Required: provide fetch implementation
  verbose: true,
});

// Access extracted files
console.log(`Extracted ${result.stats.totalFiles} files`);
for (const [path, content] of result.files) {
  console.log(`File: ${path}, Size: ${content.length} bytes`);
}

// Write files to disk
import fs from "fs/promises";
import path from "path";
for (const [filePath, content] of result.files) {
  const fullPath = path.join("./output", filePath);
  await fs.writeFile(fullPath, content);
}
```

#### TypeScript Support

```typescript
import cloneSourceMaps, { CloneOptions, CloneResult, FetchFunction } from "source-map-cloner";
import { createNodeFetch } from "source-map-cloner/node-fetch";

const options: CloneOptions = {
  urls: "https://example.com",
  fetch: createNodeFetch(), // Required: provide fetch implementation
  crawl: false,
  urlPathBasedSaving: true,
  verbose: true,
  headers: {
    Cookie: "session=abc123",
  },
};

const result: CloneResult = await cloneSourceMaps(options);

// Access results
result.files.forEach((content, path) => {
  console.log(`${path}: ${content.length} bytes`);
});

// Check for errors
if (result.errors.length > 0) {
  console.error("Errors encountered:", result.errors);
}
```

#### Browser Usage

```javascript
import cloneSourceMaps from "source-map-cloner";
import { createBrowserFetch } from "source-map-cloner/browser-fetch";

// Provide the browser fetch implementation
const result = await cloneSourceMaps({
  urls: "https://example.com",
  fetch: createBrowserFetch(), // Uses browser's native fetch API
  verbose: false, // Logging might not work in browser
});

// Process results in browser
console.log("Files extracted:", result.stats.totalFiles);
// You could display files, create a zip, etc.

// Alternative: Custom fetch implementation
const customFetch = async (url, options) => {
  const response = await fetch(url, {
    headers: options?.headers,
    mode: "cors",
  });
  return {
    body: await response.text(),
    statusCode: response.status,
    requestUrl: response.url,
  };
};

const result2 = await cloneSourceMaps({
  urls: "https://example.com",
  fetch: customFetch,
});
```

## API Reference

### `cloneSourceMaps(options: CloneOptions): Promise<CloneResult>`

Main function to clone source maps from one or more URLs. Returns all extracted files in memory.

#### CloneOptions

| Property             | Type                     | Required | Description                            |
| -------------------- | ------------------------ | -------- | -------------------------------------- |
| `urls`               | `string \| string[]`     | Yes      | URL(s) to process                      |
| `fetch`              | `FetchFunction`          | Yes      | Fetch implementation for HTTP requests |
| `crawl`              | `boolean`                | No       | Enable web crawling                    |
| `urlPathBasedSaving` | `boolean`                | No       | Preserve URL paths in output           |
| `headers`            | `Record<string, string>` | No       | Custom HTTP headers                    |
| `verbose`            | `boolean`                | No       | Enable verbose logging                 |

#### CloneResult

| Property | Type                  | Description                                        |
| -------- | --------------------- | -------------------------------------------------- |
| `files`  | `Map<string, string>` | Map of file paths to their contents                |
| `stats`  | `object`              | Statistics (totalFiles, totalSize, urls, duration) |
| `errors` | `Array`               | Array of errors encountered during processing      |

### `FetchFunction` Interface

The fetch function must implement the following interface:

```typescript
interface FetchFunction {
  (
    url: string,
    options?: {
      headers?: Record<string, string>;
    },
  ): Promise<{
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
