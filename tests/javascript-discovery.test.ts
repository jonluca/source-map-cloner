import assert from "node:assert/strict";
import test from "node:test";
import type { FetchFunction, Logger, SourceMapClonerOptions } from "../src/core/types.js";
import {
  discoverJavaScriptFiles,
  extractJsFromBuildManifest,
  extractReferencedJavaScriptUrls,
  extractJsUrlsFromHtml,
  extractJsUrlsFromText,
  getFallbackSourceMapUrl,
} from "../src/parsers/javascript.js";

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function options(fetch: FetchFunction): SourceMapClonerOptions {
  return { fetch, logger, headers: {} };
}

test("text discovery recognizes js, mjs, and cjs assets", () => {
  assert.deepEqual(
    extractJsUrlsFromText(
      `["/app.js", "./module.mjs?v=2", "https://cdn.example.com/legacy.cjs#v1", "/data.json"]`,
      "https://example.com/nested/page",
    ),
    [
      "https://example.com/app.js",
      "https://example.com/nested/module.mjs?v=2",
      "https://cdn.example.com/legacy.cjs#v1",
    ],
  );
});

test("HTML discovery honors base elements and script URLs without extensions", () => {
  const urls = extractJsUrlsFromHtml(
    '<base href="https://cdn.example.com/assets/"><script src="entry"></script><link href="styles.css">',
    "https://example.com/page",
    options(async () => {
      throw new Error("not used");
    }),
  );

  assert.deepEqual(urls, ["https://cdn.example.com/assets/entry"]);
});

test("document redirects become the base for relative JavaScript URLs", async () => {
  const urls = await discoverJavaScriptFiles(
    "https://example.com/start",
    options(async () => ({
      body: '<script src="chunks/app.js"></script>',
      statusCode: 200,
      requestUrl: "https://example.com/redirected/page/",
    })),
  );

  assert.deepEqual(urls, ["https://example.com/redirected/page/chunks/app.js"]);
});

test("build manifests are traversed recursively and preserve module query strings", async () => {
  const manifest = `self.__BUILD_MANIFEST = {
    nested: { routes: ["static/chunks/page.mjs?v=1", "static/chunks/legacy.cjs"] },
    ignored: "asset.css"
  };`;

  const urls = await extractJsFromBuildManifest(
    "https://example.com/_next/static/build-id/_buildManifest.js?cache=1",
    options(async (url) => ({ body: manifest, statusCode: 200, requestUrl: url })),
  );

  assert.deepEqual(urls.toSorted(), [
    "https://example.com/_next/static/chunks/legacy.cjs",
    "https://example.com/_next/static/chunks/page.mjs?v=1",
  ]);
});

test("build manifest text matching still works when execution fails", async () => {
  const urls = await extractJsFromBuildManifest(
    "https://example.com/_next/static/build-id/_buildManifest.js",
    options(async (url) => ({
      body: 'this is not valid JavaScript; "static/chunks/recovered.js"',
      statusCode: 200,
      requestUrl: url,
    })),
  );

  assert.deepEqual(urls, ["https://example.com/_next/static/chunks/recovered.js"]);
});

test("fallback map URLs support all JavaScript module extensions", () => {
  assert.equal(getFallbackSourceMapUrl("https://example.com/app.mjs?v=1"), "https://example.com/app.mjs.map?v=1");
  assert.equal(getFallbackSourceMapUrl("https://example.com/app.cjs#x"), "https://example.com/app.cjs.map#x");
  assert.equal(getFallbackSourceMapUrl("https://example.com/app.css"), null);
});

test("Next App Router Flight payload chunks resolve from the _next asset root", async () => {
  const html = `
    <script src="/_next/static/chunks/main-app.js"></script>
    <script>
      self.__next_f = self.__next_f || [];
      self.__next_f.push([1, '4:I[\\"module\\",[\\"app/page\\",\\"static/chunks/app/page-abc.js\\"],\\"default\\"]']);
    </script>
  `;

  const urls = await discoverJavaScriptFiles(
    "https://example.com/dashboard",
    options(async (url) => ({ body: html, statusCode: 200, requestUrl: url })),
  );

  assert.deepEqual(urls.toSorted(), [
    "https://example.com/_next/static/chunks/app/page-abc.js",
    "https://example.com/_next/static/chunks/main-app.js",
  ]);
});

test("Next asset prefixes on a CDN are retained for Flight payload chunks", async () => {
  const html = `
    <script src="https://cdn.example.com/site/_next/static/chunks/main-app.js"></script>
    <script>self.__next_f.push([1, '\\"static/chunks/app/page.js\\"'])</script>
  `;

  const urls = await discoverJavaScriptFiles(
    "https://example.com/dashboard",
    options(async (url) => ({ body: html, statusCode: 200, requestUrl: url })),
  );

  assert.deepEqual(urls.toSorted(), [
    "https://cdn.example.com/site/_next/static/chunks/app/page.js",
    "https://cdn.example.com/site/_next/static/chunks/main-app.js",
  ]);
});

test("bundle references cover common framework asset layouts", () => {
  const content = `
    import("./chunks/vite.js");
    const frameworkAssets = [
      "/_nuxt/nuxt.js",
      "/_app/immutable/nodes/sveltekit.js",
      "/assets/remix-route.js",
      "/_astro/astro-page.js",
      "/chunks/angular-lazy.js"
    ];
  `;

  assert.deepEqual(extractReferencedJavaScriptUrls(content, "https://example.com/assets/entry.js"), [
    "https://example.com/assets/chunks/vite.js",
    "https://example.com/_nuxt/nuxt.js",
    "https://example.com/_app/immutable/nodes/sveltekit.js",
    "https://example.com/assets/remix-route.js",
    "https://example.com/_astro/astro-page.js",
    "https://example.com/chunks/angular-lazy.js",
  ]);
});

test("Next bundles resolve static chunk strings from their asset root", () => {
  assert.deepEqual(
    extractReferencedJavaScriptUrls(
      'const chunks = ["static/chunks/app/lazy.js"]; import("./relative.js")',
      "https://cdn.example.com/prefix/_next/static/chunks/app/page.js",
    ).toSorted(),
    [
      "https://cdn.example.com/prefix/_next/static/chunks/app/relative.js",
      "https://cdn.example.com/prefix/_next/static/chunks/app/lazy.js",
    ].toSorted(),
  );
});

test("bundle discovery ignores concatenated fragments, source catalogs, and error-message filenames", () => {
  const content = `
    analytics.src = protocol + '.google-analytics.com/ga.js';
    const samples = ["./creating-an-editor/hello-world/sample.js"];
    throw new Error("mobx.map requires a polyfill from core-js/es6/map.js");
    import("./real-lazy.js");
    const chunks = ["route.abc12345.js"];
  `;

  assert.deepEqual(extractReferencedJavaScriptUrls(content, "https://example.com/assets/app.js").toSorted(), [
    "https://example.com/assets/real-lazy.js",
    "https://example.com/assets/route.abc12345.js",
  ]);
});
