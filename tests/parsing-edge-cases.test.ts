import assert from "node:assert/strict";
import test from "node:test";
import { cloneSourceMaps } from "../src/core/processor.js";
import { getSourceMappingURL } from "../src/core/source-map-utils.js";
import type { FetchFunction, Logger } from "../src/core/types.js";
import { fetchFromURL } from "../src/fetchers/utils.js";

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

test("the final sourceMappingURL comment wins across line and block forms", () => {
  const code = [
    "//# sourceMappingURL=old.js.map",
    "console.log('compiled');",
    "/*# sourceMappingURL=final.js.map */",
  ].join("\n");

  assert.equal(getSourceMappingURL(code).sourceMappingURL, "final.js.map");
});

test("sourceMappingURL parsing tolerates legacy @ comments and encoded spaces", () => {
  assert.equal(
    getSourceMappingURL("//@ sourceMappingURL=maps/app%20bundle.map").sourceMappingURL,
    "maps/app bundle.map",
  );
});

test("percent-encoded data URLs honor their declared charset", async () => {
  const result = await fetchFromURL(
    "data:application/json;charset=iso-8859-1,%7B%22word%22%3A%22caf%E9%22%7D",
    "https://example.com/app.js",
    {},
    async () => {
      throw new Error("network fetch should not be used");
    },
  );

  assert.equal(result.sourceContent, '{"word":"café"}');
  assert.equal(result.sourceUrl, "https://example.com/app.js");
});

test("inline base64 source maps are extracted without a map request", async () => {
  const map = Buffer.from(
    JSON.stringify({
      version: 3,
      sources: ["src/inline.ts"],
      sourcesContent: ["export const inline = true;"],
      names: [],
      mappings: "",
    }),
  ).toString("base64");
  const requests: string[] = [];
  const fetch: FetchFunction = async (url) => {
    requests.push(url);
    if (url === "https://example.com") {
      return { body: '<script src="/app.js"></script>', statusCode: 200, requestUrl: url };
    }
    if (url === "https://example.com/app.js") {
      return {
        body: `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${map}`,
        statusCode: 200,
        requestUrl: url,
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await cloneSourceMaps({ urls: "https://example.com", fetch, logger });

  assert.equal(result.files.get("src/inline.ts"), "export const inline = true;");
  assert.deepEqual(requests, ["https://example.com", "https://example.com/app.js"]);
});

test("redirected source maps resolve missing source files from their final URL", async () => {
  const requests: string[] = [];
  const fetch: FetchFunction = async (url) => {
    requests.push(url);

    if (url === "https://example.com") {
      return { body: '<script src="/app.js"></script>', statusCode: 200, requestUrl: url };
    }
    if (url === "https://example.com/app.js") {
      return { body: "//# sourceMappingURL=/maps/app.js.map", statusCode: 200, requestUrl: url };
    }
    if (url === "https://example.com/maps/app.js.map") {
      return {
        body: JSON.stringify({ version: 3, sources: ["../src/app.ts"], names: [], mappings: "" }),
        statusCode: 200,
        requestUrl: "https://cdn.example.com/releases/maps/app.js.map",
      };
    }
    if (url === "https://cdn.example.com/releases/src/app.ts") {
      return { body: "export const redirected = true;", statusCode: 200, requestUrl: url };
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await cloneSourceMaps({ urls: "https://example.com", fetch, logger });

  assert.equal(result.files.get("src/app.ts"), "export const redirected = true;");
  assert.ok(requests.includes("https://cdn.example.com/releases/src/app.ts"));
});

test("invalid data source map URLs fail clearly", async () => {
  await assert.rejects(
    fetchFromURL("data:application/json", "https://example.com/app.js", {}, async () => {
      throw new Error("network fetch should not be used");
    }),
    /Failed to parse source map/,
  );
});
