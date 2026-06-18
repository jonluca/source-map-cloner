import jsdom from "jsdom";
import { VM } from "vm2";
import type { SourceMapClonerOptions } from "../core/types.js";

const { JSDOM } = jsdom;

// Regex patterns for finding JavaScript files
const JS_FILE_REGEX = /["']([^"'<>]+?\.(?:js|mjs|cjs)(?:[?#][^"'<>]*)?)["']/gi;
const ESCAPED_JS_FILE_REGEX = /\\["']([^"'<>\\]+?\.(?:js|mjs|cjs)(?:[?#][^"'<>\\]*)?)\\["']/gi;
const DYNAMIC_IMPORT_REGEX = /\bimport\s*\(\s*["']([^"']+\.(?:js|mjs|cjs)(?:[?#][^"']*)?)["']/gi;
const STATIC_IMPORT_REGEX =
  /\b(?:import|export)\s+(?:[^"']*?\s+from\s*)?["']([^"']+\.(?:js|mjs|cjs)(?:[?#][^"']*)?)["']/gi;
const URL_CONSTRUCTOR_REGEX = /\bnew\s+URL\s*\(\s*["']([^"']+\.(?:js|mjs|cjs)(?:[?#][^"']*)?)["']\s*,/gi;

function isJavaScriptUrl(url: string): boolean {
  try {
    return /\.(?:js|mjs|cjs)$/i.test(new URL(url).pathname);
  } catch {
    const [pathname] = url.split(/[?#]/);
    return /\.(?:js|mjs|cjs)$/i.test(pathname ?? "");
  }
}

/**
 * Extract JavaScript URLs from HTML content
 */
export function extractJsUrlsFromHtml(
  html: string,
  baseUrl: string,
  options: SourceMapClonerOptions,
  protocol = "https:",
): string[] {
  const urls: string[] = [];

  try {
    const virtualConsole = new jsdom.VirtualConsole();
    // Suppress console errors from JSDOM
    virtualConsole.on("error", () => undefined);
    virtualConsole.on("warn", () => undefined);

    const dom = new JSDOM(html, {
      runScripts: "dangerously",
      resources: { userAgent: "Mozilla/5.0" },
      url: baseUrl,
      pretendToBeVisual: true,
      virtualConsole,
    });

    if (!dom?.window?.document) {
      options.logger.warn("Failed to parse DOM");
      return urls;
    }

    // Extract from script tags
    const scripts = dom.window.document.querySelectorAll("script");
    scripts.forEach((script) => {
      const src = script.src;
      if (src) {
        if (src.startsWith("//")) {
          urls.push(`${protocol}${src}`);
        } else {
          urls.push(src);
        }
      }
    });

    // Extract from link tags with JS files
    const links = dom.window.document.querySelectorAll("[href]");
    links.forEach((link) => {
      const href = "href" in link && (link.href as string);
      if (href) {
        try {
          const url = new URL(href, baseUrl);
          if (url.pathname.endsWith(".js")) {
            if (href.startsWith("//")) {
              urls.push(`${protocol}${href}`);
            } else {
              urls.push(href);
            }
          }
        } catch {
          // Invalid URL, skip
        }
      }
    });

    // Clean up DOM
    dom.window.close();
  } catch (error) {
    options.logger.error(`Error parsing HTML DOM: ${error}`);
  }

  return urls;
}

/**
 * Extract JavaScript URLs from content using regex
 */
export function extractJsUrlsFromText(content: string, baseUrl: string, frameworkAssetBase?: string): string[] {
  const urls: string[] = [];
  const matches = extractJsPathsFromText(content);

  for (const jsUrl of matches) {
    try {
      const resolutionBase = frameworkAssetBase && jsUrl.startsWith("static/") ? frameworkAssetBase : baseUrl;
      const url = new URL(jsUrl, resolutionBase);
      urls.push(url.href);
    } catch {
      // Invalid URL, skip
    }
  }

  return urls;
}

function getNextAssetBase(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const staticIndex = parsedUrl.pathname.indexOf("/_next/static/");
    if (staticIndex < 0) {
      return null;
    }

    parsedUrl.pathname = `${parsedUrl.pathname.slice(0, staticIndex)}/_next/`;
    parsedUrl.search = "";
    parsedUrl.hash = "";
    return parsedUrl.href;
  } catch {
    return null;
  }
}

function findNextAssetBase(urls: Iterable<string>): string | undefined {
  for (const url of urls) {
    const assetBase = getNextAssetBase(url);
    if (assetBase) {
      return assetBase;
    }
  }

  return undefined;
}

/**
 * Find JavaScript assets referenced by a fetched bundle. This catches native
 * ESM imports, dynamic imports, and string-based chunk manifests emitted by
 * common bundlers.
 */
export function extractReferencedJavaScriptUrls(content: string, bundleUrl: string): string[] {
  return extractReferencedJavaScriptUrlsWithBase(content, bundleUrl, findNextAssetBase([bundleUrl]));
}

function extractReferencedJavaScriptUrlsWithBase(
  content: string,
  bundleUrl: string,
  frameworkAssetBase?: string,
): string[] {
  const syntaxReferences = [DYNAMIC_IMPORT_REGEX, STATIC_IMPORT_REGEX, URL_CONSTRUCTOR_REGEX].flatMap((regex) =>
    [...content.matchAll(regex)].flatMap((match) => (match[1] ? [match[1]] : [])),
  );
  const manifestReferences = extractJsPathMatches(content)
    .filter((match) => isStandaloneStringReference(content, match))
    .map((match) => match.path)
    .filter(isLikelyManifestReference);

  return [
    ...new Set(
      [...syntaxReferences, ...manifestReferences].flatMap((reference) => {
        try {
          const resolutionBase = frameworkAssetBase && reference.startsWith("static/") ? frameworkAssetBase : bundleUrl;
          return [new URL(reference, resolutionBase).href];
        } catch {
          return [];
        }
      }),
    ),
  ];
}

interface JavaScriptPathMatch {
  path: string;
  start: number;
  end: number;
}

function extractJsPathMatches(content: string): JavaScriptPathMatch[] {
  return [JS_FILE_REGEX, ESCAPED_JS_FILE_REGEX].flatMap((regex) =>
    [...content.matchAll(regex)].flatMap((match) =>
      match[1] === undefined || match.index === undefined
        ? []
        : [{ path: match[1], start: match.index, end: match.index + match[0].length }],
    ),
  );
}

function isStandaloneStringReference(content: string, match: JavaScriptPathMatch): boolean {
  const previousCharacter = content
    .slice(0, match.start)
    .match(/\S\s*$/)?.[0]
    ?.trim();
  const nextCharacter = content
    .slice(match.end)
    .match(/^\s*\S/)?.[0]
    ?.trim();
  return previousCharacter !== "+" && nextCharacter !== "+";
}

function isLikelyManifestReference(reference: string): boolean {
  if (
    /\s/.test(reference) ||
    (reference.startsWith(".") && !reference.startsWith("./") && !reference.startsWith("../"))
  ) {
    return false;
  }

  if (
    reference.startsWith("http://") ||
    reference.startsWith("https://") ||
    reference.startsWith("//") ||
    reference.startsWith("/_next/") ||
    reference.startsWith("/_nuxt/") ||
    reference.startsWith("/_app/") ||
    reference.startsWith("/_astro/") ||
    reference.startsWith("/assets/") ||
    reference.startsWith("/build/") ||
    reference.startsWith("/chunks/") ||
    reference.startsWith("/static/") ||
    reference.startsWith("static/chunks/") ||
    reference.startsWith("assets/")
  ) {
    return true;
  }

  // Bundler chunk tables commonly contain only a hashed filename rather than
  // an import expression. Requiring a substantial hash avoids treating source
  // filenames and documentation samples as network assets.
  return /(?:^|\/)[^/]*[.-][A-Za-z0-9_-]{6,}\.(?:js|mjs|cjs)(?:[?#].*)?$/i.test(reference);
}

function extractJsPathsFromText(content: string): string[] {
  const paths = extractJsPathMatches(content).map((match) => match.path);
  return [...new Set(paths)];
}

function collectJavaScriptPaths(value: unknown, paths: string[]): void {
  if (typeof value === "string") {
    if (isJavaScriptUrl(value)) {
      paths.push(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectJavaScriptPaths(item, paths);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectJavaScriptPaths(item, paths);
    }
  }
}

function resolveManifestFile(file: string, manifestUrl: string): string {
  const parsedUrl = new URL(manifestUrl);

  if (file.startsWith("/")) {
    return new URL(file, parsedUrl.origin).href;
  }

  const manifestSegments = parsedUrl.pathname.split("/");
  const firstFileSegment = file.split("/")[0];
  const sharedSegmentIndex = firstFileSegment
    ? manifestSegments.findLastIndex((part) => part === firstFileSegment)
    : -1;

  if (sharedSegmentIndex >= 0) {
    const pathname = [...manifestSegments.slice(0, sharedSegmentIndex), file].join("/");
    return new URL(pathname, parsedUrl.origin).href;
  }

  return new URL(file, parsedUrl).href;
}

/**
 * Parse Next.js build manifest to extract JS files
 */
export async function extractJsFromBuildManifest(
  manifestUrl: string,
  options: SourceMapClonerOptions,
): Promise<string[]> {
  const jsFiles: string[] = [];

  try {
    const newUrl = new URL(manifestUrl, options.baseUrl?.origin || manifestUrl);
    const resp = await options.fetch(newUrl.href, {
      headers: options.headers || {},
    });

    const { body: data, requestUrl } = resp;
    const files = extractJsPathsFromText(data);

    try {
      // Next.js manifests can contain functions and computed object values, so
      // executing them recovers more entries than text matching alone.
      const vm = new VM({
        eval: false,
        wasm: false,
        allowAsync: false,
        timeout: 1000,
      });

      vm.run("const self = {};");
      vm.run(data);

      const serializedManifest = vm.run("JSON.stringify(self.__BUILD_MANIFEST)");
      if (typeof serializedManifest === "string") {
        collectJavaScriptPaths(JSON.parse(serializedManifest), files);
      }
    } catch (error) {
      if (options.verbose) {
        options.logger.warn(`Falling back to text parsing for build manifest ${requestUrl}: ${error}`);
      }
    }

    for (const file of new Set(files)) {
      jsFiles.push(resolveManifestFile(file, requestUrl));
    }
  } catch (error) {
    options.logger.error(`Error parsing build manifest: ${error}`);
    if (options.verbose) {
      console.error(error);
    }
  }

  return jsFiles;
}

/**
 * Discover all JavaScript files from a URL
 */
export async function discoverJavaScriptFiles(url: string, options: SourceMapClonerOptions): Promise<string[]> {
  const jsFiles: string[] = [];

  // If the URL is already a JS file, return it
  if (isJavaScriptUrl(url)) {
    return [url];
  }

  try {
    // Fetch the HTML content
    const resp = await options.fetch(url, {
      headers: options.headers || {},
    });

    const { body: html, requestUrl } = resp;
    const documentUrl = new URL(requestUrl, url).href;
    const protocol = new URL(documentUrl).protocol || "https:";

    // Extract JS URLs from HTML
    const htmlUrls = extractJsUrlsFromHtml(html, documentUrl, options, protocol);
    jsFiles.push(...htmlUrls);

    // Extract JS URLs using regex. App Router Flight payloads use paths such
    // as "static/chunks/app/page.js", relative to the _next asset root rather
    // than to the current document.
    const textUrls = extractReferencedJavaScriptUrlsWithBase(html, documentUrl, findNextAssetBase(htmlUrls));
    jsFiles.push(...textUrls);

    // Convert to absolute URLs
    const absoluteUrls = jsFiles.map((jsUrl) => {
      try {
        return new URL(jsUrl, documentUrl).href;
      } catch {
        return jsUrl;
      }
    });

    // Remove duplicates
    const uniqueUrls = [...new Set(absoluteUrls)];

    // Check for Next.js build manifest
    const manifestUrl = uniqueUrls.find((candidate) => {
      try {
        return new URL(candidate).pathname.endsWith("_buildManifest.js");
      } catch {
        return false;
      }
    });
    if (manifestUrl) {
      const manifestFiles = await extractJsFromBuildManifest(manifestUrl, options);
      uniqueUrls.push(...manifestFiles);
    }

    return [...new Set(uniqueUrls)];
  } catch (error) {
    options.logger.error(`Error discovering JavaScript files from ${url}: ${error}`);
    if (options.verbose) {
      console.error(error);
    }
    throw error;
  }
}

/**
 * Generate a fallback source map URL for a JS file
 */
export function getFallbackSourceMapUrl(jsUrl: string): string | null {
  try {
    const url = new URL(jsUrl);

    if (!/\.(?:js|mjs|cjs)$/i.test(url.pathname)) {
      return null;
    }

    url.pathname = url.pathname + ".map";
    return url.href;
  } catch {
    return null;
  }
}
