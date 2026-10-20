import assert from "node:assert/strict";
import test from "node:test";
import { fetchTopDomains } from "../scripts/top-domains.js";

const listId = "GQG5K";
const idUrl = "https://tranco-list.eu/top-1m-id";
const csvUrl = `https://tranco-list.eu/download/${listId}/1000`;
const domains = Array.from({ length: 1000 }, (_, index) => `site-${index + 1}.example`);
const rows = domains.map((domain, index) => `${index + 1},${domain}`);

function createFetcher(responses: Response[]) {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    requests.push(input instanceof Request ? input.url : String(input));
    const response = responses.shift();
    assert.ok(response, "Unexpected additional fetch");
    return response;
  };
  return { fetcher, requests };
}

test("loads a complete ranked list and retains the exact Tranco source", async () => {
  const { fetcher, requests } = createFetcher([
    new Response(`${listId}\n`),
    new Response(`\uFEFF${rows.join("\r\n")}\r\n`),
  ]);

  assert.deepEqual(await fetchTopDomains(fetcher), { listId, sourceUrl: csvUrl, domains });
  assert.deepEqual(requests, [idUrl, csvUrl]);
});

test("resolves the latest list on each call instead of reusing a stale list", async () => {
  const nextId = "L3W4Q";
  const { fetcher, requests } = createFetcher([
    new Response(listId),
    new Response(rows.join("\n")),
    new Response(nextId),
    new Response(rows.join("\n")),
  ]);

  assert.equal((await fetchTopDomains(fetcher)).listId, listId);
  assert.equal((await fetchTopDomains(fetcher)).listId, nextId);
  assert.deepEqual(requests, [idUrl, csvUrl, idUrl, `https://tranco-list.eu/download/${nextId}/1000`]);
});

const invalidLists: [string, string][] = [
  ["the retired Alexa placeholder", "poc by @gopal_ethical\n"],
  ["an HTTP 200 HTML error page", "<!doctype html><html><body>Unavailable</body></html>"],
  ["an empty response", ""],
  ["a truncated list", rows.slice(0, 999).join("\n")],
  ["an oversized list", [...rows, "1001,extra.example"].join("\n")],
  ["an unexpected CSV header", ["rank,domain", ...rows].join("\n")],
  ["a duplicate domain", [rows[0], "2,site-1.example", ...rows.slice(2)].join("\n")],
  ["nonsequential ranks", ["2,site-1.example", ...rows.slice(1)].join("\n")],
  ["a missing domain", ["1,", ...rows.slice(1)].join("\n")],
  ["an extra CSV column", ["1,site-1.example,unexpected", ...rows.slice(1)].join("\n")],
];

for (const [description, csv] of invalidLists) {
  test(`rejects ${description} before returning domains`, async () => {
    const { fetcher, requests } = createFetcher([new Response(listId), new Response(csv)]);
    await assert.rejects(fetchTopDomains(fetcher));
    assert.deepEqual(requests, [idUrl, csvUrl]);
  });
}

for (const domain of ["https://example.com", "example.com/path", "-bad.example", "bad_.example", "example..com"]) {
  test(`rejects invalid hostname ${JSON.stringify(domain)}`, async () => {
    const csv = [`1,${domain}`, ...rows.slice(1)].join("\n");
    const { fetcher } = createFetcher([new Response(listId), new Response(csv)]);
    await assert.rejects(fetchTopDomains(fetcher));
  });
}

for (const invalidId of ["", "../other", "GQG5K?redirect=1", "<html>Unavailable</html>"]) {
  test(`rejects invalid list ID ${JSON.stringify(invalidId)} without fetching CSV`, async () => {
    const { fetcher, requests } = createFetcher([new Response(invalidId)]);
    await assert.rejects(fetchTopDomains(fetcher));
    assert.deepEqual(requests, [idUrl]);
  });
}

test("rejects a failed list-ID request before downloading CSV", async () => {
  const { fetcher, requests } = createFetcher([new Response(listId, { status: 503 })]);
  await assert.rejects(fetchTopDomains(fetcher));
  assert.deepEqual(requests, [idUrl]);
});

test("rejects a failed CSV request even when its body looks valid", async () => {
  const { fetcher, requests } = createFetcher([new Response(listId), new Response(rows.join("\n"), { status: 403 })]);
  await assert.rejects(fetchTopDomains(fetcher));
  assert.deepEqual(requests, [idUrl, csvUrl]);
});

test("propagates network failures instead of returning an empty successful list", async () => {
  const error = new Error("connection reset");
  const fetcher: typeof fetch = async () => {
    throw error;
  };
  await assert.rejects(fetchTopDomains(fetcher), { message: error.message });
});
