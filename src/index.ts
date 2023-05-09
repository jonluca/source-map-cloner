#! /usr/bin/env node
import jsdom from "jsdom";
import path from "path";
import fs from "fs";
import type { RawSourceMap } from "source-map-js";
import sourceMap from "source-map-js";
import { fetchFromURL, getSourceMappingURL } from "./utils.js";
import { axiosClient } from "./axiosClient.js";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import Crawler from "crawler";
import { mkdirp } from "mkdirp";
import UserAgent from "user-agents";

const userAgent = new UserAgent();
const { JSDOM } = jsdom;
const { SourceMapConsumer } = sourceMap;

const args = yargs(hideBin(process.argv))
  .options({
    url: { type: "string", alias: "u", demandOption: true },
    dir: { type: "string", demandOption: true, alias: "d" },
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
const OUT_DIR = args.dir;

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
    parsed.sources.forEach(function (value, index) {
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
      const pathParsed = path.parse(joined);

      if (args.verbose && !pathParsed.dir.startsWith(DIR_TO_SAVE)) {
        console.warn("Warning, saved output escapes directory");
      }
      if (pathParsed.dir) {
        mkdirp.sync(pathParsed.dir);
      }
      if (args.verbose && fs.existsSync(joined)) {
        console.warn(`${joined} path exists, overwriting`);
      }
      const sourceCode = parsed.sourcesContent?.[index] || "";
      if (args.verbose && !sourceCode) {
        console.warn(`No source code for ${value}`);
      }
      fs.writeFile(joined, sourceCode, (err) => err && console.log(value, err));
      if (args.verbose) {
        console.log(`Wrote ${joined}`);
      }
    });
  } catch (e) {
    console.error(`Error parsing source map for ${guessedUrl}`);
    console.error(e);
  }
};

const fetchAndParseJsFile = async (url: string) => {
  const { data } = await axiosClient.get(url);
  const { sourceMappingURL } = getSourceMappingURL(data);
  if (args.verbose && sourceMappingURL) {
    console.log(`Found source map url: ${sourceMappingURL}`);
  }
  const urlWithFallback = sourceMappingURL || `${url}.map`;
  const { sourceContent } = await fetchFromURL(urlWithFallback, url, headers);
  if (sourceContent && sourceContent[0] !== "<") {
    args.verbose && console.log(`Found source map content: ${urlWithFallback}`);
    await parseSourceMap(sourceContent, url, args.urlPathBasedSaving);
    return;
  }
  args.verbose && console.log(`No source map content for: ${urlWithFallback}`);
};
const sourcesSeen = new Set<string>();
const run = async (baseUrl: string) => {
  if (!BASE_URL || !OUT_DIR) {
    console.error(
      "Must pass url as first argument and directory to save into as second"
    );
    process.exit(1);
  }

  const srcList: string[] = [];
  if (baseUrl.endsWith(".js")) {
    srcList.push(baseUrl);
  } else {
    const { data, request } = await axiosClient.get(baseUrl, { headers });
    const dom = new JSDOM(data);
    if (!dom) {
      console.error("Invalid DOM");
    } else {
      const links = dom.window.document.querySelectorAll("script");
      links.forEach((l) => {
        const src = l.src;
        if (src && request) {
          if (src.startsWith("//")) {
            srcList.push(`${request.protocol || "https:"}${src}`);
          } else {
            srcList.push(src);
          }
        }
      });
    }
  }

  const unseenSrcList = srcList.filter((s) => !sourcesSeen.has(s));
  unseenSrcList.forEach((s) => sourcesSeen.add(s));

  if (!unseenSrcList.length) {
    return;
  }

  for (const s of unseenSrcList) {
    sourcesSeen.add(s);
    try {
      if (s.startsWith("http:") || s.startsWith("https:")) {
        await fetchAndParseJsFile(s);
      } else {
        const parsedUrl = new URL(baseUrl);
        parsedUrl.pathname = s?.startsWith("/")
          ? s
          : path.join(parsedUrl.pathname, s);
        await fetchAndParseJsFile(parsedUrl.toString());
      }
    } catch (e) {
      console.error(`Error parsing source ${s}`);
      console.error(e);
    }
  }
  console.error(`Done`);
};
if (args.crawl) {
  console.log(`Crawling ${BASE_URL}`);

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
