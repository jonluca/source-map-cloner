import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { cloneSourceMaps } from "../src/core/processor.js";
import { createNodeFetch } from "../src/fetchers/node.js";
import { fetchFromURL } from "../src/fetchers/utils.js";

test("the Node fetcher resolves pages, bundles, and missing sources after redirects", async (t) => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url!;
    requests.push(path);
    const redirects: Record<string, string> = {
      "/start": "/site/index.html",
      "/site/entry.js": "/assets/entry.js",
      "/assets/entry.js.map": "/releases/maps/entry.js.map",
    };
    const location = redirects[path];
    if (location) {
      response.writeHead(302, { location }).end();
      return;
    }
    const bodies: Record<string, string> = {
      "/site/index.html": '<script src="entry.js"></script>',
      "/assets/entry.js": 'import("./lazy.js");\n//# sourceMappingURL=entry.js.map',
      "/assets/lazy.js": "compiled lazy chunk",
      "/releases/maps/entry.js.map": JSON.stringify({
        version: 3,
        sources: ["../src/entry.ts"],
        names: [],
        mappings: "",
      }),
      "/releases/src/entry.ts": "export const redirected = true;",
    };
    const body = bodies[path];
    response.writeHead(body === undefined ? 404 : 200).end(body ?? "Not found");
  });
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fetch = createNodeFetch();

  const response = await fetch(`${baseUrl}/start`);
  assert.equal(response.requestUrl, `${baseUrl}/site/index.html`);

  const result = await cloneSourceMaps({ urls: `${baseUrl}/start`, fetch });
  assert.deepEqual(result.errors, []);
  assert.equal(result.files.get("src/entry.ts"), "export const redirected = true;");
  assert.ok(requests.includes("/assets/lazy.js"));
  assert.ok(requests.includes("/releases/src/entry.ts"));
});

test("mixed-case data source maps decode once without a network request", async () => {
  const content = 'export const literal = "%41";';
  const dataUrl = `DaTa:application/json,${encodeURIComponent(
    JSON.stringify({
      version: 3,
      sources: ["src/inline.ts"],
      sourcesContent: [content],
      names: [],
      mappings: "",
    }),
  )}`;
  const result = await cloneSourceMaps({
    urls: "https://example.com/app.js",
    fetch: async (url) => {
      assert.equal(url, "https://example.com/app.js");
      return { body: `//# sourceMappingURL=${dataUrl}`, statusCode: 200, requestUrl: url };
    },
  });
  assert.equal(result.files.get("src/inline.ts"), content);
});

test("failed map HTTP responses from custom fetchers are rejected", async () => {
  await assert.rejects(
    fetchFromURL("app.js.map", "https://example.com/app.js", {}, async (url) => ({
      body: "Unavailable",
      statusCode: 404,
      requestUrl: url,
    })),
    /HTTP 404/,
  );
});
