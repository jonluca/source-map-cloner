# Source Map Cloner

Extract and reconstruct original source files from production JavaScript source maps. This tool fetches source maps from websites and recreates the original file structure locally, making it invaluable for debugging minified code, security research, and understanding how production applications are built.

## Features

- 🔍 **Automatic Source Map Detection** - Finds and extracts source maps from JavaScript files
- 🕷️ **Web Crawling** - Recursively discover and process all JavaScript files on a site
- 📁 **Original Structure Preservation** - Maintains the original directory structure of source files
- 🚀 **Concurrent Processing** - Fast parallel fetching with configurable concurrency
- 📦 **Multiple URL Support** - Process multiple URLs in a single run
- 🔧 **Flexible Usage** - Use as a CLI tool or Node.js library
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

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--url` | `-u` | URL(s) to process (can be specified multiple times) | Required |
| `--dir` | `-d` | Output directory for extracted files | Site hostname |
| `--crawl` | `-c` | Enable crawling to discover linked pages | `false` |
| `--urlPathBasedSaving` | `-p` | Include URL path in directory structure | `false` |
| `--headers` | `-H` | HTTP headers in "Name: Value" format | `[]` |
| `--verbose` | `-v` | Enable verbose logging | `false` |

### Library Usage

#### Basic Example
```javascript
import cloneSourceMaps from 'source-map-cloner';

// Simple usage
await cloneSourceMaps({
  urls: 'https://example.com',
  outputDir: './extracted-sources'
});

// Multiple URLs with options
await cloneSourceMaps({
  urls: ['https://example.com', 'https://example.com/app'],
  outputDir: './output',
  crawl: true,
  verbose: true,
  headers: {
    'Authorization': 'Bearer token',
    'User-Agent': 'Custom Agent'
  }
});
```

#### TypeScript Support
```typescript
import cloneSourceMaps, { 
  CloneOptions, 
  SourceMapClonerOptions,
  fetchAndWriteSourcesForUrl 
} from 'source-map-cloner';

const options: CloneOptions = {
  urls: 'https://example.com',
  outputDir: './output',
  crawl: false,
  urlPathBasedSaving: true,
  verbose: true,
  headers: {
    'Cookie': 'session=abc123'
  }
};

try {
  await cloneSourceMaps(options);
  console.log('Source maps extracted successfully!');
} catch (error) {
  console.error('Extraction failed:', error);
}
```

#### Advanced Library Usage
```javascript
import { fetchAndWriteSourcesForUrl } from 'source-map-cloner';

// Use the lower-level API for custom workflows
const options = {
  verbose: true,
  urlPathBasedSaving: false,
  headers: { 'User-Agent': 'Custom Bot' },
  baseUrl: new URL('https://example.com'),
  outputDir: './custom-output',
  seenSources: new Set() // Track already processed sources
};

await fetchAndWriteSourcesForUrl('https://example.com/app.js', options);
```

## API Reference

### `cloneSourceMaps(options: CloneOptions): Promise<void>`

Main function to clone source maps from one or more URLs.

#### CloneOptions

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `urls` | `string \| string[]` | Yes | URL(s) to process |
| `outputDir` | `string` | No | Output directory (defaults to hostname) |
| `crawl` | `boolean` | No | Enable web crawling |
| `urlPathBasedSaving` | `boolean` | No | Preserve URL paths in output |
| `headers` | `Record<string, string>` | No | Custom HTTP headers |
| `verbose` | `boolean` | No | Enable verbose logging |

### `fetchAndWriteSourcesForUrl(url: string, options: SourceMapClonerOptions): Promise<void>`

Lower-level function for processing a single URL with more control.

#### SourceMapClonerOptions

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `outputDir` | `string` | Yes | Output directory path |
| `verbose` | `boolean` | No | Enable verbose logging |
| `urlPathBasedSaving` | `boolean` | No | Preserve URL paths |
| `headers` | `Record<string, string>` | No | HTTP headers |
| `baseUrl` | `URL` | No | Base URL for relative paths |
| `seenSources` | `Set<string>` | No | Track processed sources |

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
│   ├── components/
│   │   ├── Header.tsx
│   │   └── Footer.tsx
│   ├── utils/
│   │   └── helpers.js
│   └── index.js
├── node_modules/  (if included in source maps)
│   └── ...
└── webpack/  (webpack internals if present)
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