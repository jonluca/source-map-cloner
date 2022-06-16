import axios from "axios";
import jsdom from "jsdom";
import * as path from "path";
import * as fs from "fs";
import sourceMap from "source-map";

const { JSDOM } = jsdom;
const { SourceMapConsumer } = sourceMap;

const BASE_URL = process.argv[process.argv.length - 2];
const OUT_DIR = process.argv[process.argv.length - 1];
const CWD = process.cwd();
const parseSourceMap = async (sourceMap, guessedUrl: string) => {
  try {
    const parsed = await new SourceMapConsumer(sourceMap);
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
      fs.writeFile(
        joined,
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
  // start by fetching the maps directly - if this works, we're golden
  const guessedUrl = url.replace(/\.js$/, ".js.map");
  const { data: sourceMap } = await axios.get(guessedUrl);
  if (sourceMap) {
    await parseSourceMap(sourceMap, guessedUrl);
    return;
  }

  // if we don't have it, try and parse it from the page
  const { headers, data } = await axios.get(url);
  const b64 = data.split(
    "//# sourceMappingURL=data:application/json;base64,"
  )[1];
  // if we have base64 data, then parse it that way
  if (b64) {
    const rawSourceMap = Buffer.from(b64, "base64").toString();
    await parseSourceMap(rawSourceMap, url);
    return;
  }

  if (headers["X-SourceMap"]) {
    // parse from there. todo in the future
  }
  const urlToFetch = data.split("//# sourceMappingURL=")[1];
  if (urlToFetch) {
    // todo - fetch the url and do the above
    const baseUrl = new URL(url);
    const pathname = baseUrl.pathname;
    const dirname = path.parse(pathname).dir;

    let fullUrl;
    if (urlToFetch.startsWith("http")) {
      fullUrl = urlToFetch;
    } else {
      const baseJoin = urlToFetch.startsWith("/") ? pathname : dirname;
      baseUrl.pathname = path.join(baseJoin, urlToFetch);
      fullUrl = baseUrl.toString();
    }

    const { data: sourceMap } = await axios.get(fullUrl);
    if (sourceMap) {
      await parseSourceMap(sourceMap, guessedUrl);
      return;
    }
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
};
run();
