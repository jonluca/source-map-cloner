#! /usr/bin/env node
import logger from "./logger";
import Crawler from "crawler";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { SourceMapClonerOptions } from "./index";
import { fetchAndWriteSourcesForUrl } from "./index";
import UserAgent from "user-agents";
import path from "path";

process.on("uncaughtException", function (err) {
  const isJsdomError =
    err.stack?.includes("jsdom") || err.stack?.includes("at https://");
  if (isJsdomError) {
    logger.error(err);
    return;
  }
  return;
});
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

const userAgent = new UserAgent({ deviceCategory: "desktop" });

const headers = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "en",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "sec-ch-ua":
    '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  cookie:
    "visid_incap_2294548=lJqMoGSlSwuwSKCFE9tneq6CbWgAAAAAQUIPAAAAAACl0lY6WA9mLBtfJ5KIvnnb; incap_ses_1001_2294548=5u+8X0RvsUO6WKtyiETkDa6CbWgAAAAAiWeRPn+w70yY2kWDoNcFvA==; csrftoken=oLhfOdwjCcosJ8MgUtPmxsIrY2bndH9M; nlbi_2294548=oeHHdAPvcBn9ZaZoMFEctgAAAAATpFPkwEpOp5qHAm5aYwTM; ajs_user_id=00000000; ajs_anonymous_id=0d506845-a8a6-41ad-a9f9-cbe7b89147f8; visid_incap_2857051=jxVdMR87TueHmjbxrlq8BseCbWgAAAAAQUIPAAAAAABWwJa9LS/BuQr/poISOLMh; nlbi_2857051=U3GfL0SkgDwkTFQ2TNSVbgAAAABZAEsQyTdHdw3ep9A7Q9TG; incap_ses_1001_2857051=f4IESZTxXjU8eqtyiETkDceCbWgAAAAAf94U85LiVnCrwkDXg5BK6w==; visid_incap_2627658=if7d+LjcQjSTUQwQMUSQUsiCbWgAAAAAQUIPAAAAAACxMfRNyBqM38VyuyXHYR7X; nlbi_2627658=IOUPc5b+2y9F/1szSeCpSgAAAAAXQf+n05bAsLH9uPA7a2wF; incap_ses_1001_2627658=Vy5bA55CeBt2e6tyiETkDciCbWgAAAAAcR1szy929VVh4rLtCIb32w==",
  "user-agent": userAgent.toString(),
};

if (args.headers) {
  for (const header of args.headers) {
    const [key, value] = header.split(": ");
    headers[key] = value;
  }
}
const getBaseUrl = () => {
  const BASE_URL = args.url[0];
  try {
    return new URL(BASE_URL);
  } catch (e) {
    logger.error("Invalid URL");
    process.exit(1);
  }
};
const baseUrl = getBaseUrl();
const OUT_DIR = args.dir || baseUrl.hostname;
const CWD = process.cwd();

logger.info(`Started cloning source maps of ${baseUrl}`);

const options: SourceMapClonerOptions = {
  verbose: args.verbose,
  urlPathBasedSaving: Boolean(args.urlPathBasedSaving),
  headers,
  baseUrl,
  outputDir: path.join(CWD, OUT_DIR),
  seenSources: new Set<string>(),
};

if (args.crawl) {
  logger.info(`Crawling ${baseUrl}`);

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
        .filter((l) => l && (l.startsWith(baseUrl.href) || l.startsWith("/")));
      const base = new URL(baseUrl);
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
          promises.push(fetchAndWriteSourcesForUrl(u, options));
          c.add(u);
        }
      });
      for (const uri of [res?.options?.uri, res?.options?.url]) {
        if (uri && !urls.has(uri)) {
          urls.add(uri);
          promises.push(fetchAndWriteSourcesForUrl(uri, options));
        }
      }
      done();
    },
  });

  c.on("drain", async () => {
    await Promise.all(promises);
    logger.info(`Finished crawling ${baseUrl}`);
    process.exit(0);
  });

  // Queue just one URL, with default callback
  for (const url of args.url) {
    c.add(url);
  }
} else {
  for (const url of args.url) {
    await fetchAndWriteSourcesForUrl(url, options);
  }
  process.exit(0);
}
