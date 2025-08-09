import jsdom from "jsdom";
import { VM } from "vm2";
import type { SourceMapClonerOptions } from "../core/types.js";

const { JSDOM } = jsdom;

// Regex patterns for finding JavaScript files
const JS_FILE_REGEX = /(?<=")([^"]+\.js)(?=")/gi;

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
    virtualConsole.on("error", () => {});
    virtualConsole.on("warn", () => {});

    const dom = new JSDOM(html, {
      runScripts: "dangerously",
      resources: "usable",
      url: baseUrl,
      pretendToBeVisual: true,
      userAgent: "Mozilla/5.0",
      virtualConsole,
    });

    if (!dom || !dom.window || !dom.window.document) {
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
    const links = dom.window.document.querySelectorAll("[href]") as NodeListOf<HTMLAnchorElement>;
    links.forEach((link) => {
      const href = link.href;
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
export function extractJsUrlsFromText(content: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const matches = content.match(JS_FILE_REGEX);

  if (matches) {
    for (const match of matches) {
      try {
        const url = new URL(match, baseUrl);
        urls.push(url.href);
      } catch {
        // Invalid URL, skip
      }
    }
  }

  return urls;
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

    // Use VM to safely execute the manifest JavaScript
    const vm = new VM({
      eval: false,
      wasm: false,
      allowAsync: false,
      timeout: 1000, // 1 second timeout
    });

    vm.run(`const self = {};`);
    vm.run(data);

    const manifest = JSON.parse(vm.run("JSON.stringify(self.__BUILD_MANIFEST)"));

    // Extract JS files from manifest
    const values = Object.values(manifest).flat() as (string | object)[];
    const strValues = values.filter((v) => typeof v === "string") as string[];
    const files = strValues.filter((v) => v.endsWith(".js"));
    const uniqueFiles = [...new Set(files)];

    // Convert to absolute URLs
    const parsedUrl = new URL(requestUrl, options.baseUrl);
    const splitPath = parsedUrl.pathname.split("/");

    for (const file of uniqueFiles) {
      if (file.startsWith("/")) {
        jsFiles.push(new URL(file, manifestUrl).href);
      } else {
        const split = file.split("/");
        const index = splitPath.findLastIndex((p) => p === split[0]);

        if (index === -1) {
          jsFiles.push(new URL(file, manifestUrl).href);
        } else {
          const urlPath = [...splitPath.slice(0, index), file].join("/");
          const fullUrl = new URL(urlPath, parsedUrl.origin).href;
          jsFiles.push(fullUrl);
        }
      }
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
  if (url.endsWith(".js")) {
    return [url];
  }

  try {
    // Fetch the HTML content
    const resp = await options.fetch(url, {
      headers: options.headers || {},
    });

    const { body: html, requestUrl } = resp;
    const protocol = new URL(requestUrl).protocol || "https:";

    // Extract JS URLs from HTML
    const htmlUrls = extractJsUrlsFromHtml(html, url, options, protocol);
    jsFiles.push(...htmlUrls);

    // Extract JS URLs using regex
    const textUrls = extractJsUrlsFromText(html, url);
    jsFiles.push(...textUrls);

    // Convert to absolute URLs
    const absoluteUrls = jsFiles.map((jsUrl) => {
      try {
        return new URL(jsUrl, url).href;
      } catch {
        return jsUrl;
      }
    });

    // Remove duplicates
    const uniqueUrls = [...new Set(absoluteUrls)];

    // Check for Next.js build manifest
    const manifestUrl = uniqueUrls.find((u) => u.endsWith("_buildManifest.js"));
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
    return [];
  }
}

/**
 * Generate a fallback source map URL for a JS file
 */
export function getFallbackSourceMapUrl(jsUrl: string): string | null {
  if (!jsUrl.endsWith(".js")) {
    return null;
  }

  try {
    const url = new URL(jsUrl);
    url.pathname = url.pathname + ".map";
    return url.href;
  } catch {
    return null;
  }
}
