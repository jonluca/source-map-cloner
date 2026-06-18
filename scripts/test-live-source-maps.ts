import assert from "node:assert/strict";
import { cloneSourceMaps } from "../src/index.js";
import { createNodeFetch } from "../src/fetchers/index.js";

interface ReconciliationCase {
  name: string;
  bundleUrl: string;
  expectedPath: string;
  publishedSourceUrl: string;
}

const reconciliationCases: ReconciliationCase[] = [
  {
    name: "Leaflet 1.9.4",
    bundleUrl: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    expectedPath: "src/core/Util.js",
    publishedSourceUrl: "https://unpkg.com/leaflet@1.9.4/src/core/Util.js",
  },
  {
    name: "Bootstrap 5.3.8",
    bundleUrl: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js",
    expectedPath: "js/src/dom/data.js",
    publishedSourceUrl: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/js/src/dom/data.js",
  },
  {
    name: "Axios 1.13.5",
    bundleUrl: "https://cdn.jsdelivr.net/npm/axios@1.13.5/dist/axios.min.js",
    expectedPath: "lib/core/AxiosError.js",
    publishedSourceUrl: "https://cdn.jsdelivr.net/npm/axios@1.13.5/lib/core/AxiosError.js",
  },
];

const fetch = createNodeFetch();

for (const testCase of reconciliationCases) {
  const result = await cloneSourceMaps({ urls: testCase.bundleUrl, fetch });
  const extractedSource = result.files.get(testCase.expectedPath);
  const publishedSource = (await fetch(testCase.publishedSourceUrl)).body;

  assert.equal(extractedSource, publishedSource, `${testCase.name} source content did not reconcile exactly`);
  assert.equal(result.errors.length, 0, `${testCase.name} returned errors`);
  assert.equal(result.warnings.length, 0, `${testCase.name} returned warnings`);
  console.log(`✓ ${testCase.name}: ${result.files.size} files, exact source match`);
}

const leafletSite = await cloneSourceMaps({ urls: "https://leafletjs.com/", fetch });
assert.ok(leafletSite.files.has("src/core/Util.js"));
assert.equal(leafletSite.errors.length, 0);
console.log(`✓ Leaflet website: ${leafletSite.files.size} files from ${leafletSite.stats.sourceMapsFound} map`);

const swaggerSite = await cloneSourceMaps({ urls: "https://petstore.swagger.io/", fetch });
assert.ok(swaggerSite.stats.sourceMapsFound >= 2);
assert.ok(swaggerSite.warnings.some((warning) => warning.warning.includes("no extractable source content")));
assert.equal(swaggerSite.errors.length, 0);
console.log(`✓ Swagger Petstore: ${swaggerSite.stats.sourceMapsFound} maps diagnosed without runaway discovery`);

const rxjs = await cloneSourceMaps({
  urls: "https://cdnjs.cloudflare.com/ajax/libs/rxjs/7.8.2/rxjs.umd.min.js",
  fetch,
});
assert.equal(rxjs.stats.sourceMapsFound, 1);
assert.equal(rxjs.files.size, 0);
assert.ok(rxjs.warnings.some((warning) => warning.warning.includes("no extractable source content")));
console.log("✓ RxJS 7.8.2: missing sourcesContent reported explicitly");
