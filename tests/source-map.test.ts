import assert from "node:assert/strict";
import test from "node:test";
import type { FetchFunction, Logger, SourceMapClonerOptions } from "../src/core/types.js";
import { parseSourceMap, processSourceMap } from "../src/parsers/source-map.js";

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function options(fetch: FetchFunction, overrides: Partial<SourceMapClonerOptions> = {}): SourceMapClonerOptions {
  return { fetch, logger, headers: {}, ...overrides };
}

const minimalMap = {
  version: 3,
  sources: ["src/app.ts"],
  sourcesContent: ["export const app = true;"],
  names: [],
  mappings: "",
};

test("source maps tolerate a UTF-8 BOM and common JSON-hijacking prefixes", async () => {
  for (const prefix of ["\uFEFF", ")]}'\n", "while(1);", "for(;;);"]) {
    const parsed = await parseSourceMap(`${prefix}${JSON.stringify(minimalMap)}`, "https://example.com/app.js.map");
    assert.deepEqual(parsed.sourcesContent, ["export const app = true;"]);
  }
});

test("missing sourcesContent is recovered relative to the source map URL", async () => {
  const requested: string[] = [];
  const files = await processSourceMap(
    {
      version: 3,
      sources: ["../src/app.ts", "webpack:///src/generated.ts"],
      names: [],
      mappings: "",
    },
    "https://example.com/assets/maps/app.js.map",
    options(async (url) => {
      requested.push(url);
      return { body: "export const recovered = true;", statusCode: 200, requestUrl: url };
    }),
  );

  assert.deepEqual(requested, ["https://example.com/assets/src/app.ts"]);
  assert.deepEqual(files, [{ path: "src/app.ts", content: "export const recovered = true;" }]);
});

test("missing source fetching can be disabled", async () => {
  let requests = 0;
  const files = await processSourceMap(
    { version: 3, sources: ["src/app.ts"], names: [], mappings: "" },
    "https://example.com/app.js.map",
    options(
      async (url) => {
        requests += 1;
        return { body: "unexpected", statusCode: 200, requestUrl: url };
      },
      { fetchMissingSources: false },
    ),
  );

  assert.equal(requests, 0);
  assert.deepEqual(files, []);
});

test("indexed source maps retain source content from every section", async () => {
  const parsed = await parseSourceMap(
    {
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: { ...minimalMap, sources: ["src/first.ts"], sourcesContent: ["first"] },
        },
        {
          offset: { line: 1, column: 0 },
          map: { ...minimalMap, sources: ["src/second.ts"], sourcesContent: ["second"] },
        },
      ],
    },
    "https://example.com/app.js.map",
  );

  assert.deepEqual(parsed.sources, ["src/first.ts", "src/second.ts"]);
  assert.deepEqual(parsed.sourcesContent, ["first", "second"]);
});
