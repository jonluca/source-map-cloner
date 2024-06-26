// nicely stolen from https://raw.githubusercontent.com/webpack-contrib/source-map-loader/master/src/utils.js
import path from "path";
import urlUtils from "url";

import * as iconv from "iconv-lite";
const { decode } = iconv;
import parseDataURL from "./parse-data-url.js";
import labelsToNames from "./labels-to-names.js";
import { gotClient } from "./http";

// Matches only the last occurrence of sourceMappingURL
const innerRegex = /\s*[#@]\s*sourceMappingURL\s*=\s*([^\s'"]*)\s*/;

const sourceMappingURLRegex = RegExp(
  "(?:" +
    "/\\*" +
    "(?:\\s*\r?\n(?://)?)?" +
    "(?:" +
    innerRegex.source +
    ")" +
    "\\s*" +
    "\\*/" +
    "|" +
    "//(?:" +
    innerRegex.source +
    ")" +
    ")" +
    "\\s*",
);

function labelToName(label) {
  const labelLowercase = String(label).trim().toLowerCase();
  return labelsToNames[labelLowercase] || null;
}

function getSourceMappingURL(code) {
  const lines = code.split(/^/m);
  let match;

  for (let i = lines.length - 1; i >= 0; i--) {
    match = lines[i].match(sourceMappingURLRegex);
    if (match) {
      break;
    }
  }

  const sourceMappingURL = match ? match[1] || match[2] || "" : null;

  return {
    sourceMappingURL: sourceMappingURL
      ? decodeURI(sourceMappingURL)
      : sourceMappingURL,
    replacementString: match ? match[0] : null,
  };
}

function getAbsolutePath(request, sourceRoot) {
  const url = new URL(sourceRoot);
  const pathname = url.pathname;
  if (path.isAbsolute(request)) {
    url.pathname = path.join(pathname, request);
    return url.toString();
  }

  url.pathname = path.join(pathname, "../" + request);
  return url.toString();
}

function fetchFromDataURL(sourceURL) {
  const dataURL = parseDataURL(sourceURL);

  if (dataURL) {
    // https://tools.ietf.org/html/rfc4627
    // JSON text SHALL be encoded in Unicode. The default encoding is UTF-8.
    const encodingName =
      labelToName(dataURL.parameters.get("charset")) || "UTF-8";

    return decode(dataURL.body, encodingName);
  }

  throw new Error(`Failed to parse source map from "data" URL: ${sourceURL}`);
}

async function fetchPath(sourceURL, headers: Record<string, string>) {
  let buffer;

  try {
    const { body: data, statusCode: status } = await gotClient(sourceURL, {
      headers,
    });
    if (status < 400) {
      buffer = data;
    }
  } catch (error) {
    throw new Error(
      `Failed to parse source map from '${sourceURL}' file: ${error}`,
    );
  }

  return {
    path: sourceURL,
    data:
      typeof buffer === "object"
        ? JSON.stringify(buffer)
        : buffer?.toString() || "",
  };
}

async function fetchPaths(
  possibleRequests,
  errorsAccumulator = "",
  headers: Record<string, string>,
) {
  let result;

  try {
    result = await fetchPath(possibleRequests[0], headers);
  } catch (error: any) {
    errorsAccumulator += `${error.message}\n\n`;

    const [, ...tailPossibleRequests] = possibleRequests;

    if (tailPossibleRequests.length === 0) {
      error.message = errorsAccumulator;

      throw error;
    }

    return fetchPaths(tailPossibleRequests, errorsAccumulator, headers);
  }

  return result;
}

const protocolIsHttp = (
  protocol: string | null,
): protocol is "https:" | "http:" => {
  return protocol === "https:" || protocol === "http:";
};

async function fetchFromURL(
  url: string,
  sourceRoot = "",
  headers: Record<string, string>,
) {
  // 1. It's an absolute url and it is not `windows` path like `C:\dir\file`
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !path.win32.isAbsolute(url)) {
    const { protocol } = urlUtils.parse(url);

    if (protocol === "data:") {
      const sourceContent = fetchFromDataURL(url);
      return { sourceURL: "", sourceContent };
    }
    if (protocol === "file:") {
      const pathFromURL = urlUtils.fileURLToPath(url);
      const sourceURL = path.normalize(pathFromURL);
      const { data: sourceContent } = await fetchPath(sourceURL, headers);
      return { sourceURL, sourceContent };
    }

    if (!protocolIsHttp(protocol)) {
      throw new Error(
        `Failed to parse source map: '${url}' URL is not supported`,
      );
    }
  }

  // 2. It's a scheme-relative
  if (/^\/\//.test(url)) {
    // just make it https?
    url = `https:${url}`;
    // throw new Error(
    //   `Failed to parse source map: '${url}' URL is not supported`
    // );
  }

  // 3. Absolute path
  if (path.isAbsolute(url) || url.startsWith("http")) {
    const sourceURL = path.normalize(url);
    const possibleRequests = [sourceURL];

    if (url.startsWith("/")) {
      possibleRequests.push(getAbsolutePath(sourceURL.slice(1), sourceRoot));
    }

    const result = await fetchPaths(possibleRequests, "", headers);

    return { sourceURL: result.path, sourceContent: result.data };
  }

  // 4. Relative path
  const sourceURL = getAbsolutePath(url, sourceRoot);

  const { data: sourceContent } = await fetchPath(sourceURL, headers);

  return { sourceURL, sourceContent };
}

export { getSourceMappingURL, fetchFromURL };
