#! /usr/bin/env node
import path from "path";
import fs from "fs/promises";
import { mkdirp } from "mkdirp";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import UserAgent from "user-agents";
import { cloneSourceMaps, type CloneOptions, type CloneResult } from "../core/processor";
import { createNodeFetch } from "../fetchers";
import { InvalidURLError, formatError } from "../utils/errors";
import { createConsoleLogger } from "../utils/default-logger";

const logger = createConsoleLogger();
// Setup global error handlers
process.on("uncaughtException", (err) => {
  const isJsdomError = err.stack?.includes("jsdom") || err.stack?.includes("at https://");
  if (!isJsdomError) {
    logger.error(`Uncaught exception: ${formatError(err)}`);
    process.exit(1);
  }
});

process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled rejection: ${formatError(reason)}`);
  process.exit(1);
});

// Parse command line arguments
const args = yargs(hideBin(process.argv))
  .options({
    url: {
      type: "string",
      alias: "u",
      demandOption: true,
      array: true,
      description: "URL(s) to process. Can be provided multiple times (-u url1 -u url2) or as an array",
    },
    dir: {
      type: "string",
      alias: "d",
      description: "Output directory for extracted files (defaults to hostname)",
    },
    crawl: {
      type: "boolean",
      alias: "c",
      default: false,
      description: "Enable crawling to discover and process linked pages",
    },
    headers: {
      type: "string",
      alias: "H",
      default: [],
      array: true,
      description: 'HTTP Headers to send, in the format "HeaderName: HeaderValue"',
      coerce: (headers: string[]) => {
        const parsed: Record<string, string> = {};
        for (const header of headers) {
          const colonIndex = header.indexOf(":");
          if (colonIndex === -1) {
            throw new Error(`Invalid header format: ${header}. Expected "HeaderName: HeaderValue"`);
          }
          const key = header.substring(0, colonIndex).trim();
          const value = header.substring(colonIndex + 1).trim();
          if (!key || !value) {
            throw new Error(`Invalid header format: ${header}. Both name and value are required`);
          }
          parsed[key] = value;
        }
        return parsed;
      },
    },
    verbose: {
      type: "boolean",
      alias: "v",
      default: false,
      description: "Enable verbose logging for debugging",
    },
    dryRun: {
      type: "boolean",
      default: false,
      description: "Show what files would be written without actually writing them",
    },
  })
  .example([
    ["$0 -u https://example.com", "Clone source maps from a single URL"],
    ["$0 -u https://example.com -d ./output", "Specify output directory"],
    ["$0 -u https://example.com --crawl", "Enable crawling to discover all pages"],
    ['$0 -u https://example.com -H "Authorization: Bearer token"', "Add authentication header"],
    ["$0 -u https://example.com --dry-run", "Preview files without writing them"],
  ])
  .help()
  .alias("help", "h")
  .version()
  .alias("version", "V")
  .strict()
  .parseSync();

// Build default headers
const userAgent = new UserAgent({ deviceCategory: "desktop" });
const defaultHeaders: Record<string, string> = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "en",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "user-agent": userAgent.toString(),
};

// Merge custom headers with defaults
const headers = { ...defaultHeaders, ...args.headers };

// Determine output directory
let outputDir: string;
if (args.dir) {
  outputDir = args.dir;
} else {
  try {
    const firstUrl = new URL(args.url[0]!);
    outputDir = firstUrl.hostname;
  } catch {
    outputDir = "output";
  }
}

// Make output directory absolute if relative
if (!path.isAbsolute(outputDir)) {
  outputDir = path.join(process.cwd(), outputDir);
}

// Build options for cloning
const options: CloneOptions = {
  urls: args.url as [string, ...string[]],
  fetch: createNodeFetch(),
  logger,
  crawl: args.crawl,
  headers,
  verbose: args.verbose,
};

// Display configuration if verbose
if (args.verbose) {
  logger.info("Configuration:");
  logger.info(`  URLs: ${args.url.join(", ")}`);
  logger.info(`  Output directory: ${outputDir}`);
  logger.info(`  Crawling: ${args.crawl ? "enabled" : "disabled"}`);
  logger.info(`  Custom headers: ${Object.keys(args.headers).length} configured`);
  logger.info(`  Dry run: ${args.dryRun ? "enabled" : "disabled"}`);
}

/**
 * Write files from the clone result to disk
 */
async function writeFilesToDisk(result: CloneResult, outputDir: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    logger.info("\n=== DRY RUN MODE - No files will be written ===\n");
  }

  let filesWritten = 0;
  let bytesWritten = 0;

  for (const [filePath, content] of result.files) {
    const fullPath = path.join(outputDir, filePath);

    if (dryRun) {
      logger.info(`Would write: ${fullPath} (${content.length} bytes)`);
      filesWritten++;
      bytesWritten += content.length;
    } else {
      try {
        // Create directory if needed
        const dir = path.dirname(fullPath);
        await mkdirp(dir);

        // Write file
        await fs.writeFile(fullPath, content, "utf-8");

        if (args.verbose) {
          logger.info(`Wrote: ${fullPath} (${content.length} bytes)`);
        }

        filesWritten++;
        bytesWritten += content.length;
      } catch (error) {
        logger.error(`Failed to write ${fullPath}: ${error}`);
      }
    }
  }

  if (dryRun) {
    logger.info(`=== Would write ${filesWritten} files (${formatBytes(bytesWritten)}) ===`);
  } else {
    logger.info(`✓ Wrote ${filesWritten} files (${formatBytes(bytesWritten)})`);
  }
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Display errors from the result
 */
function displayErrors(result: CloneResult): void {
  if (result.errors.length > 0) {
    logger.warn(`Encountered ${result.errors.length} errors during processing:`);
    for (const error of result.errors) {
      if (error.url) {
        logger.warn(`  - URL ${error.url}: ${error.error}`);
      } else if (error.file) {
        logger.warn(`  - File ${error.file}: ${error.error}`);
      } else {
        logger.warn(`  - ${error.error}`);
      }
    }
  }
}

// Start cloning process
async function main() {
  try {
    const startTime = Date.now();
    logger.info(`Starting source map cloning for ${args.url.length} URL(s)...`);

    // Clone source maps into memory
    const result = await cloneSourceMaps(options);

    // Display statistics
    logger.info(`=== Extraction Complete ===`);
    logger.info(`  Total files extracted: ${result.stats.totalFiles}`);
    logger.info(`  Total size: ${formatBytes(result.stats.totalSize)}`);
    logger.info(`  Duration: ${((result.stats.duration ?? 0) / 1000).toFixed(2)}s`);

    // Display errors if any
    displayErrors(result);

    // Write files to disk (or show what would be written)
    await writeFilesToDisk(result, outputDir, args.dryRun);

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`✓ Total execution time: ${totalDuration}s`);

    if (!args.dryRun) {
      logger.info(`✓ Output saved to: ${outputDir}`);
    }

    process.exit(result.errors.length > 0 ? 1 : 0);
  } catch (error) {
    if (error instanceof InvalidURLError) {
      logger.error(`Invalid URL: ${error.message}`);
    } else {
      logger.error(`Failed to clone source maps: ${formatError(error)}`);
    }

    if (args.verbose && error instanceof Error) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  logger.error(`Unexpected error: ${formatError(error)}`);
  if (args.verbose && error instanceof Error) {
    console.error("\nStack trace:");
    console.error(error.stack);
  }
  process.exit(1);
});
