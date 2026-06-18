import assert from "node:assert/strict";
import test from "node:test";
import { cloneSourceMaps, getCrawlUrls } from "../src/core/processor.js";
import type { FetchFunction, Logger } from "../src/core/types.js";

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const successfulFetch: FetchFunction = async (url) => ({ body: "", statusCode: 200, requestUrl: url });

const createChunkGraphFetch =
  (requests: string[]): FetchFunction =>
  async (url) => {
    requests.push(url);
    const bodies: Record<string, string> = {
      "https://example.com": '<script src="/entry.js"></script>',
      "https://example.com/entry.js": 'import("./lazy.js")',
      "https://example.com/lazy.js": 'import("./deep.js")',
      "https://example.com/deep.js": "compiled",
    };
    const body = bodies[url];
    if (body === undefined) {
      throw new Error(`Unavailable: ${url}`);
    }
    return { body, statusCode: 200, requestUrl: url };
  };

test("failed page and JavaScript requests are included in result errors", async () => {
  const pageFailure = await cloneSourceMaps({
    urls: "https://example.com",
    fetch: async () => {
      throw new Error("page unavailable");
    },
    logger,
  });

  assert.equal(pageFailure.errors.length, 1);
  assert.match(pageFailure.errors[0]?.error ?? "", /page unavailable/);

  const jsFailure = await cloneSourceMaps({
    urls: "https://example.com",
    fetch: async (url) => {
      if (url === "https://example.com") {
        return { body: '<script src="/app.js"></script>', statusCode: 200, requestUrl: url };
      }
      throw new Error("script unavailable");
    },
    logger,
  });

  assert.equal(jsFailure.errors.length, 1);
  assert.equal(jsFailure.errors[0]?.file, "https://example.com/app.js");
});

test("an explicit fallback map URL is fetched only once", async () => {
  const requests: string[] = [];
  const map = JSON.stringify({
    version: 3,
    sources: ["src/app.ts"],
    sourcesContent: ["hello"],
    names: [],
    mappings: "",
  });
  const fetch: FetchFunction = async (url) => {
    requests.push(url);
    const bodies: Record<string, string> = {
      "https://example.com": '<script src="/app.js"></script>',
      "https://example.com/app.js": "//# sourceMappingURL=app.js.map",
      "https://example.com/app.js.map": map,
    };
    return { body: bodies[url] ?? "", statusCode: 200, requestUrl: url };
  };

  await cloneSourceMaps({ urls: "https://example.com", fetch, logger });
  assert.equal(requests.filter((url) => url === "https://example.com/app.js.map").length, 1);
});

test("a malformed explicit source map URL does not prevent fallback discovery", async () => {
  const responses: Record<string, string> = {
    "https://example.com": '<script src="/app.js"></script>',
    "https://example.com/app.js": "//# sourceMappingURL=http://[",
    "https://example.com/app.js.map": JSON.stringify({
      version: 3,
      sources: ["src/app.ts"],
      sourcesContent: ["fallback worked"],
      names: [],
      mappings: "",
    }),
  };

  const result = await cloneSourceMaps({
    urls: "https://example.com",
    fetch: async (url) => {
      const body = responses[url];
      if (body === undefined) {
        throw new Error(`Unavailable: ${url}`);
      }
      return { body, statusCode: 200, requestUrl: url };
    },
    logger,
  });

  assert.equal(result.files.get("src/app.ts"), "fallback worked");
});

test("totalSize reports UTF-8 bytes rather than UTF-16 code units", async () => {
  const content = "const greeting = '👋 café';";
  const responses: Record<string, string> = {
    "https://example.com": '<script src="/app.js"></script>',
    "https://example.com/app.js": "compiled",
    "https://example.com/app.js.map": JSON.stringify({
      version: 3,
      sources: ["src/app.ts"],
      sourcesContent: [content],
      names: [],
      mappings: "",
    }),
  };

  const result = await cloneSourceMaps({
    urls: "https://example.com",
    fetch: async (url) => ({ body: responses[url] ?? "", statusCode: 200, requestUrl: url }),
    logger,
  });

  assert.equal(result.stats.totalSize, Buffer.byteLength(content, "utf8"));
});

test("crawl URL resolution includes relative links and filters other origins", () => {
  const urls = getCrawlUrls(
    ["child", "/root?q=1#section", "https://example.com/absolute", "mailto:test@example.com", "https://other.test/"],
    "https://example.com/docs/page/",
    new Set(["https://example.com"]),
  );

  assert.deepEqual(urls, [
    "https://example.com/docs/page/child",
    "https://example.com/root?q=1",
    "https://example.com/absolute",
  ]);
});

test("all input URLs and concurrency are validated before fetching", async () => {
  await assert.rejects(
    cloneSourceMaps({ urls: ["https://example.com", "not a url"], fetch: successfulFetch, logger }),
    /Invalid URL/,
  );
  await assert.rejects(
    cloneSourceMaps({ urls: "https://example.com", fetch: successfulFetch, logger, concurrency: 0 }),
    /Concurrency/,
  );
  await assert.rejects(
    cloneSourceMaps({ urls: "https://example.com", fetch: successfulFetch, logger, maxScriptDepth: -1 }),
    /script depth/i,
  );
});

test("referenced JavaScript chunks are followed recursively", async () => {
  const requests: string[] = [];
  const responses: Record<string, string> = {
    "https://example.com": '<script type="module" src="/assets/entry.js"></script>',
    "https://example.com/assets/entry.js": 'import("./chunks/lazy.js")',
    "https://example.com/assets/chunks/lazy.js": 'import("../shared.mjs")',
    "https://example.com/assets/shared.mjs": "compiled shared chunk",
    "https://example.com/assets/shared.mjs.map": JSON.stringify({
      version: 3,
      sources: ["src/shared.ts"],
      sourcesContent: ["export const shared = true;"],
      names: [],
      mappings: "",
    }),
  };

  const result = await cloneSourceMaps({
    urls: "https://example.com",
    fetch: async (url) => {
      requests.push(url);
      const body = responses[url];
      if (body === undefined) {
        throw new Error(`Unavailable: ${url}`);
      }
      return { body, statusCode: 200, requestUrl: url };
    },
    logger,
  });

  assert.equal(result.files.get("src/shared.ts"), "export const shared = true;");
  assert.ok(requests.includes("https://example.com/assets/chunks/lazy.js"));
  assert.ok(requests.includes("https://example.com/assets/shared.mjs"));
});

test("referenced chunk discovery respects depth and disable controls", async () => {
  const depthLimitedRequests: string[] = [];
  await cloneSourceMaps({
    urls: "https://example.com",
    fetch: createChunkGraphFetch(depthLimitedRequests),
    logger,
    maxScriptDepth: 1,
  });
  assert.ok(depthLimitedRequests.includes("https://example.com/lazy.js"));
  assert.equal(depthLimitedRequests.includes("https://example.com/deep.js"), false);

  const disabledRequests: string[] = [];
  await cloneSourceMaps({
    urls: "https://example.com",
    fetch: createChunkGraphFetch(disabledRequests),
    logger,
    discoverReferencedScripts: false,
  });
  assert.equal(disabledRequests.includes("https://example.com/lazy.js"), false);
});

test("redirected JavaScript resolves referenced chunks and maps from its final URL", async () => {
  const requests: string[] = [];
  const fetch: FetchFunction = async (url) => {
    requests.push(url);
    if (url === "https://example.com") {
      return { body: '<script src="/entry.js"></script>', statusCode: 200, requestUrl: url };
    }
    if (url === "https://example.com/entry.js") {
      return {
        body: 'import("./lazy.js"); //# sourceMappingURL=entry.js.map',
        statusCode: 200,
        requestUrl: "https://cdn.example.com/build/entry.js",
      };
    }
    if (url === "https://cdn.example.com/build/entry.js.map") {
      return {
        body: JSON.stringify({
          version: 3,
          sources: ["src/entry.ts"],
          sourcesContent: ["export const entry = true;"],
          names: [],
          mappings: "",
        }),
        statusCode: 200,
        requestUrl: url,
      };
    }
    if (url === "https://cdn.example.com/build/lazy.js") {
      return { body: "compiled", statusCode: 200, requestUrl: url };
    }
    throw new Error(`Unavailable: ${url}`);
  };

  const result = await cloneSourceMaps({ urls: "https://example.com", fetch, logger });

  assert.equal(result.files.get("src/entry.ts"), "export const entry = true;");
  assert.ok(requests.includes("https://cdn.example.com/build/lazy.js"));
});

test("unavailable recursively discovered chunks are non-fatal warnings", async () => {
  const result = await cloneSourceMaps({
    urls: "https://example.com",
    fetch: async (url) => {
      if (url === "https://example.com") {
        return { body: '<script src="/entry.js"></script>', statusCode: 200, requestUrl: url };
      }
      if (url === "https://example.com/entry.js") {
        return { body: 'import("./optional.js")', statusCode: 200, requestUrl: url };
      }
      throw new Error(`Unavailable: ${url}`);
    },
    logger,
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]?.file, "https://example.com/optional.js");
});
