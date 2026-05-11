import assert from "node:assert/strict";
import test from "node:test";
import { cloneSourceMaps } from "../src/core/processor";
import type { FetchFunction, Logger } from "../src/core/types";
import { getSourceMappingURL } from "../src/core/source-map-utils";
import { extractJsUrlsFromText, getFallbackSourceMapUrl } from "../src/parsers/javascript";

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

test("extractJsUrlsFromText keeps query strings and hashes on JavaScript assets", () => {
  const urls = extractJsUrlsFromText(
    'self.__chunks=["/static/app.js?v=123","https://cdn.example.com/chunk.js#hash"];',
    "https://example.com/page",
  );

  assert.deepEqual(urls, ["https://example.com/static/app.js?v=123", "https://cdn.example.com/chunk.js#hash"]);
});

test("getFallbackSourceMapUrl handles JavaScript URLs with query strings", () => {
  assert.equal(
    getFallbackSourceMapUrl("https://example.com/assets/app.js?v=123#bundle"),
    "https://example.com/assets/app.js.map?v=123#bundle",
  );
});

test("getSourceMappingURL leaves malformed percent escapes intact", () => {
  assert.deepEqual(getSourceMappingURL("//# sourceMappingURL=%E0%A4%A"), {
    sourceMappingURL: "%E0%A4%A",
    replacementString: "//# sourceMappingURL=%E0%A4%A",
  });
});

test("cloneSourceMaps uses fallback source maps for query-string JavaScript files", async () => {
  const responses = new Map<string, string>([
    ["https://example.com/page", '<script src="/assets/app.js?v=123"></script>'],
    ["https://example.com/assets/app.js?v=123", "console.log('minified');"],
    [
      "https://example.com/assets/app.js.map?v=123",
      JSON.stringify({
        version: 3,
        sources: ["webpack://_N_E/./src/app.ts"],
        sourcesContent: ["export const value = 1;"],
        mappings: "",
      }),
    ],
  ]);

  const requestedUrls: string[] = [];
  const fetch: FetchFunction = async (url) => {
    requestedUrls.push(url);
    const body = responses.get(url);

    if (body === undefined) {
      throw new Error(`Unexpected URL: ${url}`);
    }

    return {
      body,
      statusCode: 200,
      requestUrl: url,
    };
  };

  const result = await cloneSourceMaps({
    urls: "https://example.com/page",
    fetch,
    logger,
    headers: {},
  });

  assert.equal(result.files.size, 1);
  assert.deepEqual([...result.files.values()], ["export const value = 1;"]);
  assert.ok(requestedUrls.includes("https://example.com/assets/app.js.map?v=123"));
});

test("cloneSourceMaps merges custom headers with default browser headers", async () => {
  const seenHeaders: Record<string, string>[] = [];
  const fetch: FetchFunction = async (url, options) => {
    seenHeaders.push(options?.headers ?? {});
    return {
      body: "",
      statusCode: 200,
      requestUrl: url,
    };
  };

  await cloneSourceMaps({
    urls: "https://example.com",
    fetch,
    logger,
    headers: {
      "x-test": "1",
    },
  });

  assert.equal(seenHeaders[0]?.["x-test"], "1");
  assert.equal(typeof seenHeaders[0]?.["user-agent"], "string");
  assert.notEqual(seenHeaders[0]?.["user-agent"], "");
});
