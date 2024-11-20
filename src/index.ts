#! /usr/bin/env node
import jsdom from "jsdom";
import path from "path";
import fs from "fs/promises";
import type { RawSourceMap } from "source-map-js";
import sourceMap from "source-map-consumer";
import { fetchFromURL, getSourceMappingURL } from "./utils.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import Crawler from "crawler";
import { mkdirp } from "mkdirp";
import UserAgent from "user-agents";
import { VM } from "vm2";
import logger from "./logger.js";
import pMap from "p-map";
import { agent, cookieJar, gotClient } from "./http";

const userAgent = new UserAgent({ deviceCategory: "desktop" });
const { JSDOM } = jsdom;
const { SourceMapConsumer } = sourceMap;

const doesFileExists = async (path: string) => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
};
const args = yargs(hideBin(process.argv))
  .options({
    url: {
      type: "string",
      alias: "u",
      demandOption: true,
      array: true,
      description:
        "URL(s) to process. Can be provided multiple times (-u url1 -u url2) or as an array",
    },
    dir: { type: "string", alias: "d" },
    urlPathBasedSaving: {
      type: "boolean",
      demandOption: false,
      alias: "p",
      description:
        "Include the path in the url in the directory structure (warning, might create duplicate files)",
    },
    crawl: { type: "boolean", alias: "c", default: false },
    headers: {
      type: "string",
      alias: "H",
      default: [],
      array: true,
      description:
        'HTTP Headers to send, in the format "HeaderName: HeaderValue"',
    },
    verbose: { type: "boolean", alias: "v", default: false },
  })
  .parseSync();
const headers = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "en",
  "cache-control": "max-age=0",
  priority: "u=0, i",
  referer: "https://www.google.com/",
  "sec-ch-ua":
    '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "user-agent": userAgent.toString(),
};
if (args.headers) {
  for (const header of args.headers) {
    const [key, value] = header.split(": ");
    headers[key] = value;
  }
}
const BASE_URL = args.url[0];
try {
  new URL(BASE_URL);
} catch (e) {
  logger.error("Invalid URL");
  process.exit(1);
}
const baseUrl = new URL(BASE_URL);
const OUT_DIR = args.dir || baseUrl.hostname;

const CWD = process.cwd();
const parseSourceMap = async (
  sourceMap,
  guessedUrl: string,
  urlPathBasedSaving: boolean | undefined,
) => {
  try {
    const parsed = (await new SourceMapConsumer(
      typeof sourceMap === "string" ? JSON.parse(sourceMap) : sourceMap,
    )) as unknown as RawSourceMap;
    const url = new URL(guessedUrl);
    const pathname = url.pathname;
    const dirname = path.parse(pathname).dir;
    const DIR_TO_SAVE = path.join(CWD, OUT_DIR);
    for (const source of parsed.sources) {
      // skip synthetic sources
      if (source.startsWith("[synthetic:")) {
        continue;
      }
      const index = parsed.sources.indexOf(source);
      let value = source
        .replace(/^webpack:\/\/_N_E\//, "")
        .replace(/^(.*?):\/\//, "");
      if (!value) {
        // theres a weird thing where the source map is missing a source and its a directory?
        continue;
      }
      let joined = path.join(DIR_TO_SAVE, value);
      if (urlPathBasedSaving) {
        const paths = value.startsWith("/") ? pathname : dirname;
        const numDirs = paths.split("/").length - 1;
        const numPathsUp = value.split("../").length - 1;
        if (numPathsUp > numDirs) {
          const numDots = "../".repeat(numDirs);
          value = numDots + value.split("../").pop();
        }
        joined = path.join(DIR_TO_SAVE, paths, value);
      }
      if (joined.endsWith("/")) {
        joined = joined.slice(0, -1);
      }
      let pathParsed = path.parse(joined);

      if (args.verbose && !pathParsed.dir.startsWith(DIR_TO_SAVE)) {
        logger.warn(
          "Warning, saved output escapes directory, modifying output to save in correct directory",
        );
      }
      let newJoined = value;
      const maxCount = 100;
      let count = 0;
      while (!pathParsed.dir.startsWith(DIR_TO_SAVE) && count < maxCount) {
        newJoined = newJoined.replace("../", "");
        joined = path.join(DIR_TO_SAVE, newJoined);
        pathParsed = path.parse(joined);
        count++;
      }

      if (count >= maxCount) {
        logger.error("Error, too many ../ in path");
        continue;
      }
      if (pathParsed.dir) {
        mkdirp.sync(pathParsed.dir);
      }

      const sourceCode = parsed.sourcesContent?.[index] || "";

      // Check if file exists first
      const fileExists = await doesFileExists(joined);

      if (fileExists) {
        const contents = await fs.readFile(joined, "utf-8");
        if (sourceCode === contents) {
          continue;
        }
        if (args.verbose) {
          logger.warn(
            `${joined} path exists but with different content overwriting`,
          );
        }
      }

      if (args.verbose && !sourceCode) {
        logger.warn(`No source code for ${value}`);
      }
      try {
        await fs.writeFile(joined, sourceCode);
      } catch (e) {
        logger.error(`Error writing ${joined} - ${e}`);
      }
      if (args.verbose) {
        logger.info(`Wrote ${joined}`);
      }
    }
  } catch (e) {
    logger.error(`Error parsing source map for ${guessedUrl}: ${e}`);
  }
};

const getJsFilesFromManifest = async (url: string) => {
  try {
    const newUrl = new URL(url, baseUrl.origin);
    const resp = await gotClient(newUrl, {
      headers,
    });
    const { body: data, requestUrl } = resp;
    const newVm = new VM({ eval: false, wasm: false, allowAsync: false });
    newVm.run(`const self = {};`);
    newVm.run(data);
    const manifest = JSON.parse(
      newVm.run("JSON.stringify(self.__BUILD_MANIFEST)"),
    );
    const values = Object.values(manifest).flat() as (string | object)[];
    const strValues = values.filter((v) => typeof v === "string") as string[];
    const jsFiles = strValues.filter((v) => v.endsWith(".js"));
    const uniqueFiles = [...new Set(jsFiles)];
    const parsedUrl = new URL(requestUrl, BASE_URL);
    const splitPath = parsedUrl.pathname.split("/");
    return uniqueFiles.map((l) => {
      if (l.startsWith("/")) {
        return new URL(l, url).href;
      }
      const split = l.split("/");
      // check first part of path, and join at that point
      const index = splitPath.findLastIndex((p) => p === split[0]);
      if (index === -1) {
        return new URL(l, url).href;
      }
      const urlPath = path.join(...splitPath.slice(0, index), l);
      const fullUrl = new URL(urlPath, parsedUrl.origin).href;
      return fullUrl;
    });
  } catch (e) {
    logger.error(e);
    return [];
  }
};

const getFallbackUrl = (url: string) => {
  const parsedUrl = new URL(url);
  if (!parsedUrl.pathname.endsWith(".js")) {
    return null;
  }
  parsedUrl.pathname = parsedUrl.pathname + ".map";
  return parsedUrl.href;
};
const fetchAndParseJsFile = async (url: string) => {
  const { body: data } = await gotClient(url, { headers, agent });
  const { sourceMappingURL } = getSourceMappingURL(data);
  if (args.verbose && sourceMappingURL) {
    logger.info(`Found source map url: ${sourceMappingURL}`);
  }
  const toCheck = [...new Set([sourceMappingURL, getFallbackUrl(url)])].filter(
    Boolean,
  );
  for (const u of toCheck) {
    try {
      if (u) {
        const { sourceContent } = await fetchFromURL(u, url, headers);
        if (sourceContent && sourceContent[0] !== "<") {
          args.verbose && logger.info(`Found source map content: ${u}`);
          await parseSourceMap(sourceContent, url, args.urlPathBasedSaving);
        } else {
          args.verbose && logger.info(`No source map content for: ${u}`);
        }
      }
    } catch {
      // pass
    }
  }
};
const sourcesSeen = new Set<string>();
const jsRegex = /(?<=")([^"]+\.js)(?=")/gi;

const run = async (baseUrl: string) => {
  const srcList: string[] = [];
  const parsedUrl = new URL(baseUrl);
  if (baseUrl.endsWith(".js")) {
    srcList.push(baseUrl);
  } else {
    try {
      const resp = await gotClient(baseUrl, { headers, agent, http2: true });
      const { body: data, requestUrl } = resp;
      const virtualConsole = new jsdom.VirtualConsole();

      const dom = new JSDOM(data, {
        runScripts: "dangerously",
        resources: "usable",
        url: baseUrl,
        pretendToBeVisual: true,
        cookieJar,
        userAgent: headers["user-agent"],
        virtualConsole,
      });
      if (!dom) {
        logger.error("Invalid DOM");
      } else {
        const links = dom.window.document.querySelectorAll("script");
        const protocol = new URL(requestUrl).protocol || "https:";
        links.forEach((l) => {
          const src = l.src;
          if (src) {
            if (src.startsWith("//")) {
              srcList.push(`${protocol}${src}`);
            } else {
              srcList.push(src);
            }
          }
        });

        const hrefs = dom.window.document.querySelectorAll(
          "[href]",
        ) as NodeListOf<HTMLAnchorElement>;
        hrefs.forEach((l) => {
          const href = l.href;
          if (href) {
            const url = new URL(href, baseUrl);
            if (url.pathname.endsWith(".js")) {
              if (href.startsWith("//")) {
                srcList.push(`${protocol}${href}`);
              } else {
                srcList.push(href);
              }
            }
          }
        });
      }
      const regexMatched = data.match(jsRegex);
      if (regexMatched) {
        for (const match of regexMatched) {
          try {
            const url = new URL(match, baseUrl);
            srcList.push(url.href);
          } catch (e) {
            if (args.verbose) {
              logger.error(`Error parsing regex match ${match} - ${e}`);
            }
          }
        }
      }
    } catch (e) {
      logger.error(e);
    }
  }

  const absoluteSrcList = srcList.map((s) => new URL(s, baseUrl).href);

  const unseenSrcList = absoluteSrcList.filter((s) => !sourcesSeen.has(s));
  unseenSrcList.forEach((s) => sourcesSeen.add(s));
  const manifest = unseenSrcList.find((s) => s.endsWith("_buildManifest.js"));
  if (manifest) {
    const files = await getJsFilesFromManifest(manifest);
    for (const file of files) {
      const fullSrc = new URL(file, parsedUrl).href;
      if (!sourcesSeen.has(fullSrc)) {
        unseenSrcList.push(fullSrc);
        sourcesSeen.add(fullSrc);
      }
    }
  }

  await pMap(
    unseenSrcList,
    async (s) => {
      try {
        if (s.startsWith("http:") || s.startsWith("https:")) {
          await fetchAndParseJsFile(s);
        } else {
          const fullUrl = new URL(s, parsedUrl).href;
          await fetchAndParseJsFile(fullUrl);
        }
      } catch (e) {
        logger.error(`Error parsing source ${s}`);
        logger.error(e);
      }
    },
    { concurrency: 20 },
  );

  logger.info(`Finished ${baseUrl}`);
  if (!args.crawl) {
    process.exit(0);
  }
};

process.on("uncaughtException", function (err) {
  const isJsdomError =
    err.stack?.includes("jsdom") || err.stack?.includes("at https://");
  if (isJsdomError) {
    logger.error(err);
    return;
  }
  return;
});

logger.info(`Started cloning source maps of ${BASE_URL}`);
if (args.crawl) {
  logger.info(`Crawling ${BASE_URL}`);

  const urls = new Set<string>();
  const promises: Promise<any>[] = [];
  const c = new Crawler({
    maxConnections: 10,
    headers,
    // This will be called for each crawled page
    callback(error, res, done: any) {
      if (error) {
        return done();
      }
      if (!res.$) {
        return done();
      }
      const anchorTags = res.$("a");
      const urlsOnPage = (Array.from(anchorTags) as cheerio.TagElement[])
        .map((l) => l.attribs?.href)
        .filter((l) => l && (l.startsWith(BASE_URL) || l.startsWith("/")));
      const base = new URL(BASE_URL);
      const unique = [
        ...new Set(
          urlsOnPage.map((l) => {
            const parsed = new URL(
              l?.startsWith("/") ? `${base.origin}${l}` : l,
            );
            parsed.hash = "";
            parsed.search = "";
            return parsed.href;
          }),
        ),
      ];
      unique.forEach((u) => {
        if (!urls.has(u)) {
          urls.add(u);
          promises.push(run(u));
          c.add(u);
        }
      });
      const uri = res?.options?.uri;
      if (uri && !urls.has(uri)) {
        urls.add(uri);
        promises.push(run(uri));
      }
      const url = res?.options?.url;
      if (url && !urls.has(url)) {
        urls.add(url);
        promises.push(run(url));
      }
      done();
    },
  });

  c.on("drain", async () => {
    await Promise.all(promises);
    logger.info(`Finished crawling ${BASE_URL}`);
    process.exit(0);
  });

  // Queue just one URL, with default callback
  for (const url of args.url) {
    c.add(url);
  }
} else {
  for (const url of args.url) {
    await run(url);
  }
}
