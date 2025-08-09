import got from "got";
import { JSDOM } from "jsdom";
import { SourceMapConsumer } from "source-map";
import pMap from "p-map";
import { VM } from "vm2";
import type { GotOptionsInit } from "got";
import { CookieJar } from "tough-cookie";

const httpClient = got.extend({
  cookieJar: new CookieJar(),
  http2: true,
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  },
});

interface SourceFile {
  path: string;
  content: string;
}

export async function fetchSourceMapFromUrl(url: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  const seenSources = new Set<string>();

  try {
    // Fetch the main HTML page
    const response = await httpClient.get(url);
    const html = response.body;

    // Parse HTML to find script tags
    const dom = new JSDOM(html, { url });
    const scripts = Array.from(dom.window.document.querySelectorAll("script[src]"));

    const scriptUrls = scripts
      .map((script) => {
        const src = script.getAttribute("src");
        if (!src) return null;
        try {
          return new URL(src, url).href;
        } catch {
          return null;
        }
      })
      .filter((u): u is string => u !== null);

    // Process each script to find source maps
    await pMap(
      scriptUrls,
      async (scriptUrl) => {
        try {
          const scriptResponse = await httpClient.get(scriptUrl);
          const scriptContent = scriptResponse.body;

          // Look for sourceMappingURL
          const sourceMapMatch = scriptContent.match(/\/\/# sourceMappingURL=(.+?)$/m);
          if (!sourceMapMatch) return;

          const sourceMapUrl = sourceMapMatch[1];
          let sourceMapContent: string;

          if (sourceMapUrl.startsWith("data:")) {
            // Inline source map
            const base64Content = sourceMapUrl.replace(/^data:application\/json;(charset=utf-8;)?base64,/, "");
            sourceMapContent = Buffer.from(base64Content, "base64").toString("utf-8");
          } else {
            // External source map
            const fullSourceMapUrl = new URL(sourceMapUrl, scriptUrl).href;
            const sourceMapResponse = await httpClient.get(fullSourceMapUrl);
            sourceMapContent = sourceMapResponse.body;
          }

          const sourceMap = JSON.parse(sourceMapContent);
          const consumer = await new SourceMapConsumer(sourceMap);

          consumer.sources.forEach((source, index) => {
            if (seenSources.has(source)) return;
            seenSources.add(source);

            const content = sourceMap.sourcesContent?.[index];
            if (!content) return;

            // Clean up the path
            let cleanPath = source
              .replace(/^webpack:\/\/\//, "")
              .replace(/^\//, "")
              .replace(/\?.*$/, "");

            // Skip node_modules and other unwanted files
            if (cleanPath.includes("node_modules") || cleanPath.startsWith(".")) {
              return;
            }

            files.push({
              path: cleanPath,
              content,
            });
          });

          consumer.destroy();
        } catch (error) {
          console.error(`Error processing script ${scriptUrl}:`, error);
        }
      },
      { concurrency: 5 },
    );
  } catch (error) {
    console.error("Error fetching source map:", error);
    throw error;
  }

  return files;
}
