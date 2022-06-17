import axios from "axios";
import jsdom from "jsdom";
import * as path from "path";
import * as fs from "fs";
import sourceMap from "source-map-js";
import { fetchFromURL, getSourceMappingURL } from "./utils";

const { JSDOM } = jsdom;
const { SourceMapConsumer } = sourceMap;

const BASE_URL = process.argv[process.argv.length - 2];
const OUT_DIR = process.argv[process.argv.length - 1];
const CWD = process.cwd();
const parseSourceMap = async (sourceMap, guessedUrl: string) => {
  try {
    const parsed = await new SourceMapConsumer(
      typeof sourceMap === "string" ? JSON.parse(sourceMap) : sourceMap
    );
    const url = new URL(guessedUrl);
    const pathname = url.pathname;
    const dirname = path.parse(pathname).dir;
    // @ts-ignore
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
      fs.writeFile(
        joined,
        // @ts-ignore
        parsed.sourcesContent[index] || "",
        (err) => err && console.log(value, err)
      );
    });
  } catch (e) {
    console.error(`Error parsing source map for ${guessedUrl}`);
    console.error(e);
  }
};

const fetchAndParseJsFile = async (url: string) => {
  const { data } = await axios.get(url);
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
  const { data } = await axios.get(BASE_URL);
  const dom = new JSDOM(data);
  if (!dom) {
    console.error("Invalid DOM");
    process.exit(1);
  }
  const links = dom.window.document.querySelectorAll("script");
  const src: string[] = [];
  links.forEach((l) => {
    if (l.src) {
      src.push(l.src);
    }
  });

  if (!src.length) {
    console.log("No sources found, bailing");
    process.exit(0);
  }

  for (const s of src) {
    try {
      const parsedUrl = new URL(BASE_URL);
      parsedUrl.pathname = s;
      await fetchAndParseJsFile(parsedUrl.toString());
    } catch (e) {
      console.error(`Error parsing source ${s}`);
      console.error(e);
    }
  }
  console.error(`Done`);
};
run();
