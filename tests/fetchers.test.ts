import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createSecureServer, type ServerHttp2Session } from "node:http2";
import type { AddressInfo, Socket } from "node:net";
import test from "node:test";
import { cloneSourceMaps } from "../src/core/processor.js";
import { createNodeFetch } from "../src/fetchers/node.js";
import { fetchFromURL } from "../src/fetchers/utils.js";

test("the configured Node fetcher negotiates HTTP/2 over IPv4 with its TLS settings", async (t) => {
  // Public, self-signed fixtures generated solely for this local test; never use them in production.
  const server = createSecureServer(
    {
      key: readFileSync(new URL("./fixtures/localhost-test-key.pem", import.meta.url)),
      cert: readFileSync(new URL("./fixtures/localhost-test-cert.pem", import.meta.url)),
      allowHTTP1: true,
    },
    (request, response) => {
      response.end(JSON.stringify({ protocol: request.httpVersion, addressFamily: request.socket.remoteFamily }));
    },
  );
  const sessions = new Set<ServerHttp2Session>();
  const sockets = new Set<Socket>();
  server.on("session", (session) => {
    sessions.add(session);
    session.once("close", () => sessions.delete(session));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  t.after(() => {
    const closed = new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    for (const session of sessions) {
      session.destroy();
    }
    for (const socket of sockets) {
      socket.destroy();
    }
    return closed;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `https://localhost:${(server.address() as AddressInfo).port}/protocol`;

  const response = await createNodeFetch()(url);
  assert.equal(response.statusCode, 200);
  assert.equal(response.requestUrl, url);
  assert.deepEqual(JSON.parse(response.body), { protocol: "2.0", addressFamily: "IPv4" });
});

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
