import assert from "node:assert/strict";
import test from "node:test";
import { cloneSourceMaps } from "../src/core/processor.js";
import type { FetchFunction, Logger } from "../src/core/types.js";
import { getSourceMappingURL } from "../src/core/source-map-utils.js";
import { extractJsUrlsFromText, getFallbackSourceMapUrl } from "../src/parsers/javascript.js";
import { processSourceMap } from "../src/parsers/source-map.js";

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

test("processSourceMap reconciles sourceRoot paths and preserves empty sources", async () => {
  const files = await processSourceMap(
    {
      version: 3,
      sourceRoot: "webpack://app/",
      sources: ["./src/app.ts", "webpack://_N_E/./pages/index.tsx", "webpack:///./src/empty.ts", "[synthetic:base64]"],
      sourcesContent: ["export const app = true;", "export default function Page() {}", "", "ignored"],
      mappings: "",
    },
    "https://example.com/_next/static/chunks/app.js",
    {
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
      logger,
      headers: {},
    },
  );

  assert.deepEqual(files, [
    { path: "src/app.ts", content: "export const app = true;" },
    { path: "pages/index.tsx", content: "export default function Page() {}" },
    { path: "src/empty.ts", content: "" },
  ]);
});

test("cloneSourceMaps reconciles duplicate source paths by keeping best content", async () => {
  const responses = new Map<string, string>([
    ["https://example.com/page", '<script src="/assets/app.js"></script>'],
    ["https://example.com/assets/app.js", "console.log('minified');"],
    [
      "https://example.com/assets/app.js.map",
      JSON.stringify({
        version: 3,
        sources: [
          "webpack://app/./src/file.ts",
          "webpack:///./src/file.ts",
          "webpack://app/./src/conflict.ts",
          "webpack:///./src/conflict.ts",
          "webpack://third/./src/conflict.ts",
          "webpack://app/./src/same.ts",
          "webpack:///./src/same.ts",
          "webpack:///./src/exact.ts",
          "webpack:///./src/exact.ts",
        ],
        sourcesContent: ["", "export const value = 1;", "one", "two", "two", "same", "same", "first", "second"],
        mappings: "",
      }),
    ],
  ]);

  const fetch: FetchFunction = async (url) => {
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

  assert.equal(result.files.get("src/file.ts"), "export const value = 1;");
  assert.equal(result.files.get("src/conflict.ts"), "one");
  assert.equal(result.files.get("src/conflict.conflict-2.ts"), "two");
  assert.equal(result.files.has("src/conflict.conflict-3.ts"), false);
  assert.equal(result.files.get("src/same.ts"), "same");
  assert.equal(result.files.get("src/exact.ts"), "first");
  assert.equal(result.files.get("src/exact.conflict-2.ts"), "second");
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.warnings[0]?.file, "src/conflict.conflict-2.ts");
  assert.equal(result.warnings[1]?.file, "src/exact.conflict-2.ts");
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
