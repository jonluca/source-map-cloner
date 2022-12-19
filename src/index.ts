import jsdom from "jsdom";
import * as path from "path";
import * as fs from "fs";
import type { RawSourceMap } from "source-map-js";
import sourceMap from "source-map-js";
import { fetchFromURL, getSourceMappingURL } from "./utils";
import { axiosClient } from "./axiosClient";
const { JSDOM } = jsdom;
const { SourceMapConsumer } = sourceMap;
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import Crawler from "crawler";

const args = yargs(hideBin(process.argv))
  .options({
    url: { type: "string", alias: "u", demandOption: true },
    dir: { type: "string", demandOption: true, alias: "d" },
    crawl: { type: "boolean", alias: "c", default: false },
    verbose: { type: "boolean", alias: "v", default: false },
  })
  .parseSync();

const BASE_URL = args.url;
const OUT_DIR = args.dir;

const CWD = process.cwd();
const parseSourceMap = async (sourceMap, guessedUrl: string) => {
  try {
    const parsed = (await new SourceMapConsumer(
      typeof sourceMap === "string" ? JSON.parse(sourceMap) : sourceMap
    )) as unknown as RawSourceMap;
    const url = new URL(guessedUrl);
    const pathname = url.pathname;
    const dirname = path.parse(pathname).dir;
    const DIR_TO_SAVE = path.join(CWD, OUT_DIR);
    parsed.sources.forEach(function (value, index) {
      const paths = value.startsWith("/") ? pathname : dirname;
      const numDirs = paths.split("/").length - 1;
      const numPathsUp = value.split("../").length - 1;
      if (numPathsUp > numDirs) {
        const numDots = "../".repeat(numDirs);
        value = numDots + value.split("../").pop();
      }
      const joined = path.join(DIR_TO_SAVE, paths, value);
      const pathParsed = path.parse(joined);

      if (args.verbose && !pathParsed.dir.startsWith(DIR_TO_SAVE)) {
        console.warn("Warning, saved output escapes directory");
      }
      if (pathParsed.dir) {
        fs.mkdirSync(pathParsed.dir, { recursive: true });
      }
      if (args.verbose && fs.existsSync(joined)) {
        console.warn(`${joined} path exists, overwriting`);
      }
      const sourceCode = parsed.sourcesContent?.[index] || "";
      if (args.verbose && !sourceCode) {
        console.warn(`No source code for ${value}`);
      }
      fs.writeFile(joined, sourceCode, (err) => err && console.log(value, err));
      console.log(`Wrote ${joined}`);
    });
  } catch (e) {
    console.error(`Error parsing source map for ${guessedUrl}`);
    console.error(e);
  }
};

const fetchAndParseJsFile = async (url: string) => {
  const { data } = await axiosClient.get(url);
  const { sourceMappingURL } = getSourceMappingURL(data);
  if (sourceMappingURL) {
    args.verbose && console.log(`Found source map url: ${sourceMappingURL}`);
    const { sourceContent } = await fetchFromURL(sourceMappingURL, url);
    if (sourceContent) {
      args.verbose &&
        console.log(`Found source map content: ${sourceMappingURL}`);
      await parseSourceMap(sourceContent, url);
      return;
    }
    args.verbose &&
      console.log(`No source map content for: ${sourceMappingURL}`);
  }
};

const run = async (baseUrl: string) => {
  if (!BASE_URL || !OUT_DIR) {
    console.error(
      "Must pass url as first argument and directory to save into as second"
    );
    process.exit(1);
  }
  const { data, request } = await axiosClient.get(baseUrl);
  const dom = new JSDOM(data);
  if (!dom) {
    console.error("Invalid DOM");
    process.exit(1);
  }
  const links = dom.window.document.querySelectorAll("script");
  const srcList: string[] = [];
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

  if (!srcList.length) {
    console.log("No sources found, bailing");
    process.exit(0);
  }

  for (const s of srcList) {
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
  const c = new Crawler({
    maxConnections: 10,
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
        .filter((l) => l && l.startsWith(BASE_URL));
      const unique = [
        ...new Set(
          urlsOnPage.map((l) => {
            const parsed = new URL(l);
            parsed.hash = "";
            parsed.search = "";
            return parsed.href;
          })
        ),
      ];
      unique.forEach((u) => {
        if (!urls.has(u)) {
          urls.add(u);
          c.queue(u);
        }
      });
      if (res?.options?.uri) {
        urls.add(res.options.uri);
      }
      done();
    },
  });

  c.on("drain", async () => {
    for (const url of urls) {
      await run(url);
    }
  });

  // Queue just one URL, with default callback
  c.queue(BASE_URL);
} else {
  run(BASE_URL);
}
