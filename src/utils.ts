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

export { getSourceMappingURL };
