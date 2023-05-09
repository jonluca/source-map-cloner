#! /usr/bin/env node
import jsdom from "jsdom";
import path from "path";
import fs from "fs/promises";
import type { RawSourceMap } from "source-map-js";
import sourceMap from "source-map-consumer";
import { fetchFromURL, getSourceMappingURL } from "./utils.js";
import { axiosClient } from "./axiosClient.js";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import Crawler from "crawler";
import { mkdirp } from "mkdirp";
import UserAgent from "user-agents";
import { VM } from "vm2";
import logger from "./logger.js";
import pMap from "p-map";

const userAgent = new UserAgent({ deviceCategory: "desktop" });
const { JSDOM } = jsdom;
const { SourceMapConsumer } = sourceMap;

const fileExists = async (path: string) => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
};
const args = yargs(hideBin(process.argv))
  .options({
    url: { type: "string", alias: "u", demandOption: true },
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
      description:
        'HTTP Headers to send, in the format "HeaderName: HeaderValue"',
    },
    verbose: { type: "boolean", alias: "v", default: false },
  })
  .parseSync();
const headers = {
  "accept-language": "en",
  "cache-control": "max-age=0",
  "sec-ch-ua":
    '"Chromium";v="110", "Not A(Brand";v="24", "Google Chrome";v="110"',
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
const BASE_URL = args.url;
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
  urlPathBasedSaving: boolean | undefined
) => {
  try {
    const parsed = (await new SourceMapConsumer(
      typeof sourceMap === "string" ? JSON.parse(sourceMap) : sourceMap
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
          "Warning, saved output escapes directory, modifying output to save in correct directory"
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
      if (args.verbose && (await fileExists(joined))) {
        logger.warn(`${joined} path exists, overwriting`);
      }
      const sourceCode = parsed.sourcesContent?.[index] || "";
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
    logger.error(`Error parsing source map for ${guessedUrl}`);
    logger.error(e);
  }
};

const getJsFilesFromManifest = async (url: string) => {
  try {
    const resp = await axiosClient.get(url, {
      baseURL: baseUrl.origin,
      headers,
    });
    const { data, request } = resp;
    const newVm = new VM({ eval: false, wasm: false, allowAsync: false });
    newVm.run(`const self = {};`);
    newVm.run(data);
    const manifest = JSON.parse(
      newVm.run("JSON.stringify(self.__BUILD_MANIFEST)")
    );
    const values = Object.values(manifest).flat() as (string | object)[];
    const strValues = values.filter((v) => typeof v === "string") as string[];
    const jsFiles = strValues.filter((v) => v.endsWith(".js"));
    const uniqueFiles = [...new Set(jsFiles)];
    const parsedUrl = new URL(request.path, BASE_URL);
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
  const { data } = await axiosClient.get(url, { headers });
  const { sourceMappingURL } = getSourceMappingURL(data);
  if (args.verbose && sourceMappingURL) {
    logger.info(`Found source map url: ${sourceMappingURL}`);
  }
  const urlWithFallback = sourceMappingURL || getFallbackUrl(url);
  if (urlWithFallback) {
    const { sourceContent } = await fetchFromURL(urlWithFallback, url, headers);
    if (sourceContent && sourceContent[0] !== "<") {
      args.verbose &&
        logger.info(`Found source map content: ${urlWithFallback}`);
      await parseSourceMap(sourceContent, url, args.urlPathBasedSaving);
      return;
    }
    args.verbose &&
      logger.info(`No source map content for: ${urlWithFallback}`);
  }
};
const sourcesSeen = new Set<string>();
const run = async (baseUrl: string) => {
  const srcList: string[] = [];
  const parsedUrl = new URL(baseUrl);
  if (baseUrl.endsWith(".js")) {
    srcList.push(baseUrl);
  } else {
    const { data, request } = await axiosClient.get(baseUrl, { headers });
    const dom = new JSDOM(data);
    if (!dom) {
      logger.error("Invalid DOM");
    } else {
      const links = dom.window.document.querySelectorAll("script");
      links.forEach((l) => {
        const src = l.src;
        if (src) {
          if (src.startsWith("//")) {
            srcList.push(`${request?.protocol || "https:"}${src}`);
          } else {
            srcList.push(src);
          }
        }
      });

      const hrefs = dom.window.document.querySelectorAll("[href]");
      hrefs.forEach((l) => {
        const href = l.href;
        if (href) {
          const url = new URL(href, baseUrl);
          if (url.pathname.endsWith(".js")) {
            if (href.startsWith("//")) {
              srcList.push(`${request?.protocol || "https:"}${href}`);
            } else {
              srcList.push(href);
            }
          }
        }
      });
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
  if (!unseenSrcList.length) {
    return;
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
    { concurrency: 20 }
  );

  logger.info(`Finished ${baseUrl}`);
};

logger.info(`Starting cloning source maps of ${BASE_URL}`);
if (args.crawl) {
  logger.info(`Crawling ${BASE_URL}`);

  const urls = new Set<string>();
  const promises: Promise<any>[] = [];
  const c = new Crawler({
    maxConnections: 10,
    headers,
    // This will be called for each crawled page
    callback(error, res, done) {
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
              l?.startsWith("/") ? `${base.origin}${l}` : l
            );
            parsed.hash = "";
            parsed.search = "";
            return parsed.href;
          })
        ),
      ];
      unique.forEach((u) => {
        if (!urls.has(u)) {
          urls.add(u);
          promises.push(run(u));
          c.queue(u);
        }
      });
      const uri = res?.options?.uri;
      if (uri && !urls.has(uri)) {
        urls.add(uri);
        promises.push(run(uri));
      }
      done();
    },
  });

  c.on("drain", async () => {
    await Promise.all(promises);
  });

  // Queue just one URL, with default callback
  c.queue(BASE_URL);
} else {
  run(BASE_URL);
}
