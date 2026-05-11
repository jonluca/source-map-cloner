// nicely stolen from https://raw.githubusercontent.com/webpack-contrib/source-map-loader/master/src/utils.js

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

function getSourceMappingURL(code: string) {
  const lines = code.split(/^/m).filter(Boolean).toReversed();
  const matched = lines.find((line) => sourceMappingURLRegex.exec(line));
  const match = matched ? sourceMappingURLRegex.exec(matched) : null;
  const sourceMappingURL = match ? match[1] || match[2] || "" : null;

  return {
    sourceMappingURL: sourceMappingURL ? safeDecodeURI(sourceMappingURL) : sourceMappingURL,
    replacementString: match ? match[0] : null,
  };
}

function safeDecodeURI(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

export { getSourceMappingURL };
