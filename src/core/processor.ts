import pMap from "p-map";
import { processSourceMap } from "../parsers/source-map";
import { discoverJavaScriptFiles, getFallbackSourceMapUrl } from "../parsers/javascript";
import { getSourceMappingURL } from "./source-map-utils";
import { fetchFromURL } from "../fetchers/utils";
import { InvalidURLError } from "../utils/errors";
import { noopLogger } from "../utils/default-logger";
import type { CloneOptions, CloneResult, SourceMapClonerOptions, SourceFile } from "./types";
import { createBrowserFetch } from "../fetchers/browser";

/**
 * Fetch and parse a JavaScript file for source maps
 */
async function fetchAndParseJsFile(url: string, options: SourceMapClonerOptions): Promise<SourceFile[]> {
  const { verbose, headers, fetch, logger } = options;

  try {
    const { body: data } = await fetch(url, { headers });
    const { sourceMappingURL } = getSourceMappingURL(data);

    if (verbose && sourceMappingURL) {
      options.logger.info(`Found source map url: ${sourceMappingURL}`);
    }

    // Try both the source map URL and fallback .map URL
    const urlsToCheck = [sourceMappingURL, getFallbackSourceMapUrl(url)].filter(Boolean) as string[];

    for (const sourceMapUrl of urlsToCheck) {
      try {
        const { sourceContent } = await fetchFromURL(sourceMapUrl, url, headers || {}, fetch);

        if (sourceContent && !sourceContent.startsWith("<")) {
          if (verbose) {
            options.logger.info(`Found source map content: ${sourceMapUrl}`);
          }
          const files = await processSourceMap(sourceContent, url, options);
          if (files.length > 0) {
            return files;
          }
        } else if (verbose) {
          options.logger.info(`No source map content for: ${sourceMapUrl}`);
        }
      } catch (error) {
        if (verbose) {
          options.logger.warn(`Failed to fetch source map from ${sourceMapUrl}: ${error}`);
        }
      }
    }
  } catch (error) {
    options.logger.error(`Error fetching JS file ${url}: ${error}`);
    if (verbose) {
      console.error(error);
    }
  }

  return [];
}

/**
 * Process a single URL to extract source maps
 */
export async function fetchAndWriteSourcesForUrl(
  url: string,
  options: SourceMapClonerOptions,
  result: CloneResult,
): Promise<void> {
  const seenSources = options.seenSources || new Set<string>();

  try {
    // Discover all JavaScript files from the URL
    const jsFiles = await discoverJavaScriptFiles(url, options);

    // Filter out already processed files
    const unseenFiles = jsFiles.filter((file) => !seenSources.has(file));
    unseenFiles.forEach((file) => seenSources.add(file));

    if (options.verbose) {
      options.logger.info(`Found ${unseenFiles.length} new JavaScript files from ${url}`);
    }

    // Process files in parallel with concurrency limit
    const fileArrays = await pMap(
      unseenFiles,
      async (jsFile) => {
        try {
          return await fetchAndParseJsFile(jsFile, options);
        } catch (error) {
          result.errors.push({
            file: jsFile,
            error: String(error),
          });
          if (options.verbose) {
            console.error(error);
          }
          return [];
        }
      },
      { concurrency: 20 },
    );

    // Flatten and add all files to the result
    for (const files of fileArrays) {
      for (const file of files) {
        // Check for duplicates
        if (!result.files.has(file.path)) {
          result.files.set(file.path, file.content);
          result.stats.totalSize += file.content.length;
        } else if (options.verbose) {
          options.logger.warn(`Duplicate file skipped: ${file.path}`);
        }
      }
    }

    options.logger.info(`Finished processing ${url}`);
  } catch (error) {
    result.errors.push({
      url,
      error: String(error),
    });
    if (options.verbose) {
      console.error(error);
    }
  }
}

/**
 * Clone source maps from one or more URLs and return results in memory
 */
export async function cloneSourceMaps(options: CloneOptions): Promise<CloneResult> {
  const startTime = Date.now();
  const urls = Array.isArray(options.urls) ? options.urls : [options.urls];

  if (urls.length === 0) {
    throw new Error("No URLs provided");
  }

  const firstUrl = urls[0];
  let baseUrl: URL;

  try {
    baseUrl = new URL(firstUrl);
  } catch (error) {
    throw new InvalidURLError(firstUrl, error);
  }

  const result: CloneResult = {
    files: new Map<string, string>(),
    stats: {
      totalFiles: 0,
      totalSize: 0,
      urls,
    },
    errors: [],
  };

  const clonerOptions: SourceMapClonerOptions = {
    fetch: options.fetch,
    logger: options.logger || noopLogger,
    verbose: options.verbose || false,
    headers: options.headers || {},
    baseUrl,
    seenSources: new Set<string>(),
  };

  if (options.crawl) {
    await crawlAndProcess(urls, clonerOptions, result);
  } else {
    // Process each URL sequentially
    for (const url of urls) {
      await fetchAndWriteSourcesForUrl(url, clonerOptions, result);
    }
  }

  // Update final stats
  result.stats.totalFiles = result.files.size;
  result.stats.duration = Date.now() - startTime;

  return result;
}

/**
 * Crawl websites and process discovered pages
 */
async function crawlAndProcess(urls: string[], options: SourceMapClonerOptions, result: CloneResult): Promise<void> {
  // Dynamic import for crawler (Node.js only)
  const Crawler = (await import("crawler")).default;
  const crawledUrls = new Set<string>();
  const promises: Promise<void>[] = [];

  return new Promise((resolve, reject) => {
    const crawler = new Crawler({
      maxConnections: 10,
      headers: options.headers,
      callback(error, res, done: any) {
        if (error || !res?.$) {
          done();
          return;
        }

        const baseUrl = options.baseUrl!;
        const anchorTags = res.$("a");
        const foundUrls = (Array.from(anchorTags) as any[])
          .map((tag) => tag.attribs?.href)
          .filter((href) => href && (href.startsWith(baseUrl.href) || href.startsWith("/")));

        const uniqueUrls = [
          ...new Set(
            foundUrls.map((href) => {
              const url = new URL(href.startsWith("/") ? `${baseUrl.origin}${href}` : href);
              url.hash = "";
              url.search = "";
              return url.href;
            }),
          ),
        ];

        uniqueUrls.forEach((url) => {
          if (!crawledUrls.has(url)) {
            crawledUrls.add(url);
            promises.push(fetchAndWriteSourcesForUrl(url, options, result));
            crawler.add(url);
          }
        });

        // Also process the current page
        for (const uri of [res?.options?.uri, res?.options?.url]) {
          if (uri && !crawledUrls.has(uri)) {
            crawledUrls.add(uri);
            promises.push(fetchAndWriteSourcesForUrl(uri, options, result));
          }
        }

        done();
      },
    });

    crawler.on("drain", async () => {
      try {
        await Promise.all(promises);
        if (options.verbose) {
          options.logger.info(`Finished crawling ${options.baseUrl}`);
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });

    // Start crawling from initial URLs
    for (const url of urls) {
      crawler.add(url);
    }
  });
}

// Re-export types for convenience
export type { CloneOptions, CloneResult, SourceMapClonerOptions, SourceFile, FetchFunction } from "./types";

export { createBrowserFetch };
export default cloneSourceMaps;
