import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { writeSourceFile } from "../src/cli/write-source-file.js";

const repositoryDirectory = fileURLToPath(new URL("..", import.meta.url));

test("CLI output writes nested UTF-8 sources and replaces previous files", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "source-map-cloner-output-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await writeSourceFile(directory, "src/app.ts", "old content");
  await writeSourceFile(directory, "src/app.ts", "export const greeting = '👋 café';");

  assert.equal(await fs.readFile(path.join(directory, "src/app.ts"), "utf8"), "export const greeting = '👋 café';");
  assert.deepEqual(await fs.readdir(path.join(directory, "src")), ["app.ts"]);
});

test("CLI output refuses traversal and symlinked parent directories", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "source-map-cloner-output-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "output");
  const outside = path.join(directory, "outside");
  await fs.mkdir(output);
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(output, "src"), "dir");

  await assert.rejects(writeSourceFile(output, "../escaped.ts", "bad"), /escapes the output directory/);
  await assert.rejects(writeSourceFile(output, "src/nested/app.ts", "bad"), /symbolic link/);

  assert.deepEqual(await fs.readdir(outside), []);
  assert.deepEqual(await fs.readdir(directory), ["output", "outside"]);
});

test("CLI output replaces file links without modifying their external targets", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "source-map-cloner-output-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "output");
  const externalFile = path.join(directory, "external.ts");
  await fs.mkdir(output);
  await fs.writeFile(externalFile, "keep this content");
  await fs.symlink(externalFile, path.join(output, "symlink.ts"));
  await fs.link(externalFile, path.join(output, "hardlink.ts"));

  await writeSourceFile(output, "symlink.ts", "symlink replacement");
  await writeSourceFile(output, "hardlink.ts", "hardlink replacement");

  assert.equal(await fs.readFile(externalFile, "utf8"), "keep this content");
  assert.equal(await fs.readFile(path.join(output, "symlink.ts"), "utf8"), "symlink replacement");
  assert.equal(await fs.readFile(path.join(output, "hardlink.ts"), "utf8"), "hardlink replacement");
  assert.equal((await fs.lstat(path.join(output, "symlink.ts"))).isSymbolicLink(), false);
});

test("CLI reports failed disk writes with a nonzero exit status while dry-run remains read-only", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "source-map-cloner-cli-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const blockedOutput = path.join(directory, "output");
  await fs.writeFile(blockedOutput, "existing file");
  const sourceMap = JSON.stringify({
    version: 3,
    sources: ["src/app.ts"],
    sourcesContent: ["export const app = true;"],
    names: [],
    mappings: "",
  });
  const server = createServer((request, response) => {
    if (request.url === "/app.js") {
      response.setHeader("content-type", "application/javascript");
      response.end("//# sourceMappingURL=app.js.map");
    } else if (request.url === "/app.js.map") {
      response.setHeader("content-type", "application/json");
      response.end(sourceMap);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const run = (extraArguments: string[] = []) =>
    new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli/index.ts",
          "-u",
          `http://127.0.0.1:${address.port}/app.js`,
          "-d",
          blockedOutput,
          "--no-discover-referenced-scripts",
          ...extraArguments,
        ],
        { cwd: repositoryDirectory, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, output }));
    });

  const failed = await run();
  assert.equal(failed.code, 1, failed.output);
  assert.match(failed.output, /Failed to write/);
  assert.doesNotMatch(failed.output, /Output saved to:/);

  const dryRun = await run(["--dry-run"]);
  assert.equal(dryRun.code, 0, dryRun.output);
  assert.match(dryRun.output, /Would write 1 files/);
  assert.equal(await fs.readFile(blockedOutput, "utf8"), "existing file");
});
