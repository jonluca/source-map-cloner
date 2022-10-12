import jsdom from "jsdom";
import * as path from "path";
import * as fs from "fs";
import type { RawSourceMap } from "source-map-js";
import sourceMap from "source-map-js";
import { fetchFromURL, getSourceMappingURL } from "./utils";
import { axiosClient } from "./axiosClient";

const { JSDOM } = jsdom;
const { SourceMapConsumer } = sourceMap;

const BASE_URL = process.argv[process.argv.length - 2];
const OUT_DIR = process.argv[process.argv.length - 1];
const CWD = process.cwd();
const parseSourceMap = async (sourceMap, guessedUrl: string) => {
  try {
    const parsed = (await new SourceMapConsumer(
      typeof sourceMap === "string" ? JSON.parse(sourceMap) : sourceMap
    )) as unknown as RawSourceMap;
    const url = new URL(guessedUrl);
    const pathname = url.pathname;
    const dirname = path.parse(pathname).dir;
    parsed.sources.forEach(function (value, index) {
      const joined = path.join(
        CWD,
        OUT_DIR,
        value.startsWith("/") ? pathname : dirname,
        value
      );
      const pathParsed = path.parse(joined);

      if (!pathParsed.dir.startsWith(CWD)) {
        console.warn("Warning, saved output escapes directory");
      }
      if (pathParsed.dir) {
        fs.mkdirSync(pathParsed.dir, { recursive: true });
      }
      if (fs.existsSync(joined)) {
        console.warn(`${joined} path exists, overwriting`);
      }
      const sourceCode = parsed.sourcesContent?.[index] || "";
      if (!sourceCode) {
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
    console.log(`Found source map url: ${sourceMappingURL}`);
    const { sourceContent } = await fetchFromURL(sourceMappingURL, url);
    if (sourceContent) {
      console.log(`Found source map content: ${sourceMappingURL}`);
      await parseSourceMap(sourceContent, url);
      return;
    }
    console.log(`No source map content for: ${sourceMappingURL}`);
  }
};

const run = async () => {
  if (!BASE_URL || !OUT_DIR) {
    console.error(
      "Must pass url as first argument and directory to save into as second"
    );
    process.exit(1);
  }
  const { data, request } = await axiosClient.get(BASE_URL);
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
        const parsedUrl = new URL(BASE_URL);
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
run();
