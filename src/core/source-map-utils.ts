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
  const lines = code.split(/^/m).filter(Boolean).reverse();
  const matched = lines.find((line) => sourceMappingURLRegex.exec(line));
  const match = matched ? sourceMappingURLRegex.exec(matched) : null;
  const sourceMappingURL = match ? match[1] || match[2] || "" : null;

  return {
    sourceMappingURL: sourceMappingURL ? decodeURI(sourceMappingURL) : sourceMappingURL,
    replacementString: match ? match[0] : null,
  };
}

export { getSourceMappingURL };
