import assert from "node:assert/strict";
import test from "node:test";
import { getOutputPath, normalizeSourcePath, sanitizePath } from "../src/utils/paths.js";

test("bundler and URL source paths normalize into stable relative paths", () => {
  assert.equal(normalizeSourcePath("webpack://app/./src/index.ts"), "src/index.ts");
  assert.equal(normalizeSourcePath("https://cdn.example.com/assets/app.ts?v=1"), "cdn.example.com/assets/app.ts");
  assert.equal(normalizeSourcePath("file:///Users/dev/project/src/app.ts"), "Users/dev/project/src/app.ts");
});

test("path normalization contains traversal at the output root", () => {
  assert.equal(sanitizePath("output", "../../../../src/app.ts"), "output/src/app.ts");
  assert.equal(getOutputPath("webpack:///../../src/app.ts", {}), "src/app.ts");
});

test("output paths are usable on Windows as well as POSIX", () => {
  assert.equal(normalizeSourcePath("C:\\project\\src\\app.ts"), "C_/project/src/app.ts");
  assert.equal(normalizeSourcePath("webpack:///src/CON/file<name>.ts"), "src/_CON/file_name_.ts");
  assert.equal(normalizeSourcePath("webpack:///src/trailing. /app.ts"), "src/trailing/app.ts");
});

test("empty normalized source paths are rejected", () => {
  assert.throws(() => getOutputPath("../../", {}), /Empty source path/);
});
