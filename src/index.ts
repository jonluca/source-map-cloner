import jsdom from "jsdom";
import path from "path";
import fs from "fs/promises";
import type { RawSourceMap } from "source-map-js";
import sourceMap from "source-map-consumer";
import { fetchFromURL, getSourceMappingURL } from "./utils.js";
import { mkdirp } from "mkdirp";
import { VM } from "vm2";
import logger from "./logger.js";
import pMap from "p-map";
import { agent, cookieJar, gotClient } from "./http";

const { JSDOM } = jsdom;
const { SourceMapConsumer } = sourceMap;

export interface SourceMapClonerOptions {
  verbose?: boolean;
  urlPathBasedSaving?: boolean;
  headers?: Record<string, string>;
  baseUrl?: URL;
  outputDir: string;
  seenSources?: Set<string>;
}

export interface CloneOptions {
  urls: string | string[];
  outputDir?: string;
  urlPathBasedSaving?: boolean;
  crawl?: boolean;
  headers?: Record<string, string>;
  verbose?: boolean;
}
const doesFileExists = async (path: string) => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
};

const parseSourceMap = async (
  sourceMap,
  guessedUrl: string,
  options: SourceMapClonerOptions,
) => {
  try {
    const parsed = (await new SourceMapConsumer(
      typeof sourceMap === "string" ? JSON.parse(sourceMap) : sourceMap,
    )) as unknown as RawSourceMap;
    const url = new URL(guessedUrl);
    const pathname = url.pathname;
    const dirname = path.parse(pathname).dir;
    const DIR_TO_SAVE = options.outputDir;
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
      if (options.urlPathBasedSaving) {
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

      if (options.verbose && !pathParsed.dir.startsWith(DIR_TO_SAVE)) {
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
        if (options.verbose) {
          logger.warn(
            `${joined} path exists but with different content overwriting`,
          );
        }
      }

      if (options.verbose && !sourceCode) {
        logger.warn(`No source code for ${value}`);
      }
      try {
        await fs.writeFile(joined, sourceCode);
      } catch (e) {
        logger.error(`Error writing ${joined} - ${e}`);
      }
      if (options.verbose) {
        logger.info(`Wrote ${joined}`);
      }
    }
  } catch (e) {
    logger.error(`Error parsing source map for ${guessedUrl}: ${e}`);
  }
};

const getJsFilesFromManifest = async (
  url: string,
  options: SourceMapClonerOptions,
) => {
  try {
    const newUrl = new URL(url, options.baseUrl?.origin || url);
    const resp = await gotClient(newUrl, {
      headers: options.headers || {},
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
    const parsedUrl = new URL(requestUrl, options.baseUrl);
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
const fetchAndParseJsFile = async (
  url: string,
  options: SourceMapClonerOptions,
) => {
  const { verbose, headers } = options;
  const { body: data } = await gotClient(url, { headers, agent });
  const { sourceMappingURL } = getSourceMappingURL(data);
  if (verbose && sourceMappingURL) {
    logger.info(`Found source map url: ${sourceMappingURL}`);
  }
  const toCheck = [...new Set([sourceMappingURL, getFallbackUrl(url)])].filter(
    Boolean,
  );
  for (const u of toCheck) {
    try {
      if (u) {
        const { sourceContent } = await fetchFromURL(u, url, headers || {});
        if (sourceContent && sourceContent[0] !== "<") {
          if (verbose) {
            logger.info(`Found source map content: ${u}`);
          }
          await parseSourceMap(sourceContent, url, options);
        } else {
          if (verbose) {
            logger.info(`No source map content for: ${u}`);
          }
        }
      }
    } catch {
      // pass
    }
  }
};

const jsRegex = /(?<=")([^"]+\.js)(?=")/gi;

export const fetchAndWriteSourcesForUrl = async (
  baseUrl: string,
  options: SourceMapClonerOptions,
) => {
  const sourcesSeen = options.seenSources || new Set<string>();
  const srcList: string[] = [];
  const parsedUrl = new URL(baseUrl);
  if (baseUrl.endsWith(".js")) {
    srcList.push(baseUrl);
  } else {
    try {
      const resp = await gotClient(baseUrl, {
        headers: options.headers || {},
        agent,
        http2: true,
      });
      const { body: data, requestUrl } = resp;
      const virtualConsole = new jsdom.VirtualConsole();

      const dom = new JSDOM(data, {
        runScripts: "dangerously",
        resources: "usable",
        url: baseUrl,
        pretendToBeVisual: true,
        cookieJar,
        userAgent: options.headers?.["user-agent"],
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
            if (options.verbose) {
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
    const files = await getJsFilesFromManifest(manifest, options);
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
          await fetchAndParseJsFile(s, options);
        } else {
          const fullUrl = new URL(s, parsedUrl).href;
          await fetchAndParseJsFile(fullUrl, options);
        }
      } catch (e) {
        logger.error(`Error parsing source ${s}`);
        logger.error(e);
      }
    },
    { concurrency: 20 },
  );

  logger.info(`Finished ${baseUrl}`);
};

export async function cloneSourceMaps(options: CloneOptions): Promise<void> {
  const urls = Array.isArray(options.urls) ? options.urls : [options.urls];
  const firstUrl = urls[0];
  let baseUrl: URL;
  
  try {
    baseUrl = new URL(firstUrl);
  } catch (e) {
    throw new Error(`Invalid URL: ${firstUrl}`);
  }
  
  const outputDir = options.outputDir || baseUrl.hostname;
  const fullOutputDir = path.isAbsolute(outputDir) 
    ? outputDir 
    : path.join(process.cwd(), outputDir);
  
  const clonerOptions: SourceMapClonerOptions = {
    verbose: options.verbose || false,
    urlPathBasedSaving: options.urlPathBasedSaving || false,
    headers: options.headers || {},
    baseUrl,
    outputDir: fullOutputDir,
    seenSources: new Set<string>(),
  };
  
  if (options.crawl) {
    const Crawler = (await import("crawler")).default;
    const crawlUrls = new Set<string>();
    const promises: Promise<any>[] = [];
    
    const c = new Crawler({
      maxConnections: 10,
      headers: clonerOptions.headers,
      callback(error, res, done: any) {
        if (error || !res.$) {
          return done();
        }
        
        const anchorTags = res.$("a");
        const urlsOnPage = (Array.from(anchorTags) as any[])
          .map((l) => l.attribs?.href)
          .filter((l) => l && (l.startsWith(baseUrl.href) || l.startsWith("/")));
        
        const unique = [
          ...new Set(
            urlsOnPage.map((l) => {
              const parsed = new URL(
                l?.startsWith("/") ? `${baseUrl.origin}${l}` : l,
              );
              parsed.hash = "";
              parsed.search = "";
              return parsed.href;
            }),
          ),
        ];
        
        unique.forEach((u) => {
          if (!crawlUrls.has(u)) {
            crawlUrls.add(u);
            promises.push(fetchAndWriteSourcesForUrl(u, clonerOptions));
            c.add(u);
          }
        });
        
        for (const uri of [res?.options?.uri, res?.options?.url]) {
          if (uri && !crawlUrls.has(uri)) {
            crawlUrls.add(uri);
            promises.push(fetchAndWriteSourcesForUrl(uri, clonerOptions));
          }
        }
        done();
      },
    });
    
    return new Promise((resolve, reject) => {
      c.on("drain", async () => {
        try {
          await Promise.all(promises);
          if (options.verbose) {
            logger.info(`Finished crawling ${baseUrl}`);
          }
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      
      for (const url of urls) {
        c.add(url);
      }
    });
  } else {
    for (const url of urls) {
      await fetchAndWriteSourcesForUrl(url, clonerOptions);
    }
  }
}

export default cloneSourceMaps;
