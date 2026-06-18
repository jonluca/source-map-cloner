import pMap from "p-map";
import { processSourceMap } from "../parsers/source-map.js";
import {
  discoverJavaScriptFiles,
  extractReferencedJavaScriptUrls,
  getFallbackSourceMapUrl,
} from "../parsers/javascript.js";
import { getSourceMappingURL } from "./source-map-utils.js";
import { fetchFromURL } from "../fetchers/utils.js";
import { InvalidURLError } from "../utils/errors.js";
import { noopLogger } from "../utils/default-logger.js";
import type { CloneOptions, CloneResult, SourceMapClonerOptions, SourceFile } from "./types.js";
import { createBrowserFetch } from "../fetchers/browser.js";
import userAgents from "top-user-agents";
import { getUtf8ByteLength } from "../utils/bytes.js";

/**
 * Fetch and parse a JavaScript file for source maps
 */
interface ProcessedJavaScriptFile {
  files: SourceFile[];
  referencedScripts: string[];
  sourceMapFound: boolean;
  diagnostics: { file: string; warning: string }[];
}

async function fetchAndParseJsFile(url: string, options: SourceMapClonerOptions): Promise<ProcessedJavaScriptFile> {
  const { verbose, headers, fetch } = options;
  const { body: data, requestUrl } = await fetch(url, { headers });
  const bundleUrl = new URL(requestUrl, url).href;
  const { sourceMappingURL } = getSourceMappingURL(data);
  const referencedScripts = options.discoverReferencedScripts
    ? extractReferencedJavaScriptUrls(data, bundleUrl).filter(
        (referencedUrl) =>
          options.followCrossOriginScripts || new URL(referencedUrl).origin === new URL(bundleUrl).origin,
      )
    : [];
  let sourceMapFound = false;
  const diagnostics: { file: string; warning: string }[] = [];

  if (verbose && sourceMappingURL) {
    options.logger.info(`Found source map url: ${sourceMappingURL}`);
  }

  // Try both the source map URL and fallback .map URL.
  const urlsToCheck = [sourceMappingURL, getFallbackSourceMapUrl(bundleUrl)].filter(Boolean) as string[];
  const checkedSourceMapUrls = new Set<string>();

  for (const sourceMapUrl of urlsToCheck) {
    let canonicalUrl = sourceMapUrl;
    if (!sourceMapUrl.startsWith("data:")) {
      try {
        canonicalUrl = new URL(sourceMapUrl, bundleUrl).href;
      } catch {
        // Keep the raw value for deduplication; fetchFromURL will report the
        // malformed candidate and the fallback map can still be attempted.
      }
    }
    if (checkedSourceMapUrls.has(canonicalUrl)) {
      continue;
    }
    checkedSourceMapUrls.add(canonicalUrl);

    try {
      const { sourceContent, sourceUrl } = await fetchFromURL(sourceMapUrl, bundleUrl, headers || {}, fetch);

      if (sourceContent && !sourceContent.trimStart().startsWith("<")) {
        sourceMapFound = true;
        if (verbose) {
          options.logger.info(`Found source map content: ${sourceMapUrl}`);
        }
        const files = await processSourceMap(sourceContent, sourceUrl, options);
        if (files.length > 0) {
          return { files, referencedScripts, sourceMapFound, diagnostics: [] };
        }
        diagnostics.push({
          file: sourceUrl,
          warning: "Source map was found but contained no extractable source content",
        });
      } else if (verbose) {
        options.logger.info(`No source map content for: ${sourceMapUrl}`);
      }
    } catch (error) {
      if (verbose) {
        options.logger.warn(`Failed to fetch source map from ${sourceMapUrl}: ${error}`);
      }
    }
  }

  return { files: [], referencedScripts, sourceMapFound, diagnostics };
}

function addSourceFileToResult(file: SourceFile, options: SourceMapClonerOptions, result: CloneResult): void {
  if (!result.files.has(file.path)) {
    result.files.set(file.path, file.content);
    result.stats.totalSize += getUtf8ByteLength(file.content);
    return;
  }

  const existingContent = result.files.get(file.path)!;

  if (existingContent === file.content) {
    if (options.verbose) {
      options.logger.warn(`Duplicate file skipped: ${file.path}`);
    }
    return;
  }

  if (existingContent.length === 0 && file.content.length > 0) {
    result.files.set(file.path, file.content);
    result.stats.totalSize += getUtf8ByteLength(file.content) - getUtf8ByteLength(existingContent);

    if (options.verbose) {
      options.logger.info(`Replaced empty duplicate source: ${file.path}`);
    }
    return;
  }

  if (file.content.length === 0) {
    if (options.verbose) {
      options.logger.warn(`Empty duplicate source skipped: ${file.path}`);
    }
    return;
  }

  const lastSlash = file.path.lastIndexOf("/");
  const directory = lastSlash >= 0 ? file.path.slice(0, lastSlash + 1) : "";
  const filename = lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path;
  const lastDot = filename.lastIndexOf(".");
  const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const extension = lastDot > 0 ? filename.slice(lastDot) : "";
  let conflictNumber = 2;
  let conflictPath = `${directory}${stem}.conflict-${conflictNumber}${extension}`;

  while (result.files.has(conflictPath)) {
    if (result.files.get(conflictPath) === file.content) {
      if (options.verbose) {
        options.logger.warn(`Duplicate conflict file skipped: ${conflictPath}`);
      }
      return;
    }
    conflictNumber += 1;
    conflictPath = `${directory}${stem}.conflict-${conflictNumber}${extension}`;
  }

  result.files.set(conflictPath, file.content);
  result.stats.totalSize += getUtf8ByteLength(file.content);

  const message = `Conflicting duplicate source preserved as ${conflictPath} (original path: ${file.path})`;
  result.warnings.push({
    file: conflictPath,
    warning: message,
  });
  options.logger.warn(message);
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

    let pendingFiles = jsFiles.map((file) => ({ url: file, depth: 0 }));
    const maxScriptDepth = options.maxScriptDepth ?? 3;
    const maxScripts = options.maxScripts ?? 500;

    while (pendingFiles.length > 0) {
      const batchUrls = new Set<string>();
      const unseenCandidates = pendingFiles.filter((file) => {
        if (seenSources.has(file.url) || batchUrls.has(file.url)) {
          return false;
        }
        batchUrls.add(file.url);
        return true;
      });
      const remainingScriptCapacity = Math.max(0, maxScripts - seenSources.size);
      const unseenFiles = unseenCandidates.slice(0, remainingScriptCapacity);

      if (
        unseenCandidates.length > unseenFiles.length &&
        !result.warnings.some((warning) => warning.warning.startsWith("JavaScript discovery limit reached"))
      ) {
        result.warnings.push({
          warning: `JavaScript discovery limit reached (${maxScripts}); additional referenced chunks were skipped`,
        });
      }

      unseenFiles.forEach((file) => seenSources.add(file.url));

      if (options.verbose && unseenFiles.length > 0) {
        options.logger.info(
          `Found ${unseenFiles.length} new JavaScript files at discovery depth ${unseenFiles[0]!.depth}`,
        );
      }

      const processedFiles = await pMap(
        unseenFiles,
        async (jsFile) => {
          try {
            return await fetchAndParseJsFile(jsFile.url, options);
          } catch (error) {
            if (jsFile.depth === 0) {
              result.errors.push({
                file: jsFile.url,
                error: String(error),
              });
            } else {
              result.warnings.push({
                file: jsFile.url,
                warning: `Failed to fetch referenced JavaScript: ${error}`,
              });
            }
            if (options.verbose) {
              console.error(error);
            }
            return { files: [], referencedScripts: [], sourceMapFound: false, diagnostics: [] };
          }
        },
        { concurrency: options.concurrency ?? 20 },
      );

      for (const processedFile of processedFiles) {
        result.stats.scriptsProcessed += 1;
        if (processedFile.sourceMapFound) {
          result.stats.sourceMapsFound += 1;
        }
        result.warnings.push(...processedFile.diagnostics);

        for (const file of processedFile.files) {
          addSourceFileToResult(file, options, result);
        }
      }

      pendingFiles = processedFiles.flatMap((processedFile, index) => {
        const parent = unseenFiles[index];
        if (!parent || parent.depth >= maxScriptDepth) {
          return [];
        }

        return processedFile.referencedScripts.map((referencedUrl) => ({
          url: referencedUrl,
          depth: parent.depth + 1,
        }));
      });
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

// Build default headers - always use the most popular user agent
const userAgent = userAgents[0];

const defaultHeaders = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "en",
  priority: "u=0, i",
  "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
  "sec-ch-ua-mobile": "?0",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "user-agent": userAgent!,
} satisfies Record<string, string>;

function mergeHeaders(
  defaults: Record<string, string>,
  overrides: Record<string, string> | undefined,
): Record<string, string> {
  const merged = { ...defaults };

  for (const [key, value] of Object.entries(overrides ?? {})) {
    const existingKey = Object.keys(merged).find((header) => header.toLowerCase() === key.toLowerCase());

    if (existingKey && existingKey !== key) {
      delete merged[existingKey];
    }

    merged[key] = value;
  }

  return merged;
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

  const parsedUrls = urls.map((url) => {
    try {
      return new URL(url);
    } catch (error) {
      throw new InvalidURLError(url, error);
    }
  });
  const baseUrl = parsedUrls[0]!;

  if (options.concurrency !== undefined && (!Number.isInteger(options.concurrency) || options.concurrency < 1)) {
    throw new Error(`Concurrency must be a positive integer, received: ${options.concurrency}`);
  }
  if (
    options.maxScriptDepth !== undefined &&
    (!Number.isInteger(options.maxScriptDepth) || options.maxScriptDepth < 0)
  ) {
    throw new Error(`Maximum script depth must be a non-negative integer, received: ${options.maxScriptDepth}`);
  }
  if (options.maxScripts !== undefined && (!Number.isInteger(options.maxScripts) || options.maxScripts < 1)) {
    throw new Error(`Maximum scripts must be a positive integer, received: ${options.maxScripts}`);
  }

  const result: CloneResult = {
    files: new Map<string, string>(),
    stats: {
      totalFiles: 0,
      totalSize: 0,
      scriptsProcessed: 0,
      sourceMapsFound: 0,
      urls,
    },
    errors: [],
    warnings: [],
  };

  const clonerOptions: SourceMapClonerOptions = {
    fetch: options.fetch,
    logger: options.logger || noopLogger,
    verbose: options.verbose || false,
    headers: mergeHeaders(defaultHeaders, options.headers),
    baseUrl,
    seenSources: new Set<string>(),
    concurrency: options.concurrency ?? 20,
    fetchMissingSources: options.fetchMissingSources ?? true,
    discoverReferencedScripts: options.discoverReferencedScripts ?? true,
    maxScriptDepth: options.maxScriptDepth ?? 3,
    maxScripts: options.maxScripts ?? 500,
    followCrossOriginScripts: options.followCrossOriginScripts ?? false,
  };

  if (options.crawl) {
    await crawlAndProcess(urls, clonerOptions, result);
  } else {
    // Process each URL sequentially
    for (const url of urls) {
      await fetchAndWriteSourcesForUrl(url, clonerOptions, result);
    }
  }

  if (options.cleanupKnownInvalidFiles) {
    // we want to remove root files that start with a question mark, which are likely invalid
    // and remove all webpack/runtime files and webpack/bootstrap
    for (const [filePath, content] of result.files.entries()) {
      if (filePath.startsWith("?") && result.files.delete(filePath)) {
        result.stats.totalSize -= getUtf8ByteLength(content);
      }
      if (
        (filePath.includes("webpack/runtime") || filePath.includes("webpack/bootstrap")) &&
        result.files.delete(filePath)
      ) {
        result.stats.totalSize -= getUtf8ByteLength(content);
      }
    }
  }

  // Update final stats
  result.stats.totalFiles = result.files.size;
  result.stats.duration = Date.now() - startTime;

  return result;
}

/** Resolve and filter links discovered while crawling. */
export function getCrawlUrls(hrefs: Iterable<string>, pageUrl: string, allowedOrigins: Set<string>): string[] {
  const urls = new Set<string>();

  for (const href of hrefs) {
    try {
      const url = new URL(href, pageUrl);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || !allowedOrigins.has(url.origin)) {
        continue;
      }

      url.hash = "";
      urls.add(url.href);
    } catch {
      // Ignore malformed links and continue crawling the rest of the page.
    }
  }

  return [...urls];
}

/**
 * Crawl websites and process discovered pages
 */
async function crawlAndProcess(urls: string[], options: SourceMapClonerOptions, result: CloneResult): Promise<void> {
  // Dynamic import for crawler (Node.js only)
  const Crawler = (await import("crawler")).default;
  const crawledUrls = new Set<string>();
  const promises: Promise<void>[] = [];
  const allowedOrigins = new Set(urls.map((url) => new URL(url).origin));

  return new Promise((resolve, reject) => {
    const crawler = new Crawler({
      maxConnections: 10,
      headers: options.headers,
      callback(error, res, done) {
        if (error) {
          result.errors.push({
            url: String(res?.options?.uri ?? res?.options?.url ?? ""),
            error: String(error),
          });
          // @ts-ignore
          done();
          return;
        }

        if (!res?.$) {
          result.errors.push({
            url: String(res?.options?.uri ?? res?.options?.url ?? ""),
            error: "Crawler response did not contain a parseable document",
          });
          // @ts-ignore
          done();
          return;
        }

        const anchorTags = res.$("a");
        const foundHrefs = Array.from(anchorTags)
          // @ts-ignore
          .map((tag) => tag.attribs?.href)
          .filter((href): href is string => typeof href === "string");
        const currentPageUrl = String(res.options?.uri ?? res.options?.url ?? options.baseUrl);
        const uniqueUrls = getCrawlUrls(foundHrefs, currentPageUrl, allowedOrigins);

        uniqueUrls.forEach((url) => {
          if (!crawledUrls.has(url)) {
            crawledUrls.add(url);
            promises.push(fetchAndWriteSourcesForUrl(url, options, result));
            crawler.add(url);
          }
        });

        // Also process the current page

        for (const rawUri of [res?.options?.uri, res?.options?.url]) {
          const uri = rawUri ? String(rawUri) : "";
          if (uri && !crawledUrls.has(uri)) {
            crawledUrls.add(uri);
            promises.push(fetchAndWriteSourcesForUrl(uri, options, result));
          }
        }

        // @ts-ignore
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
export type { CloneOptions, CloneResult, SourceMapClonerOptions, SourceFile, FetchFunction } from "./types.js";

export { createBrowserFetch };
