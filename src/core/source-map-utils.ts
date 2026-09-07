// nicely stolen from https://raw.githubusercontent.com/webpack-contrib/source-map-loader/master/src/utils.js

// Match sourceMappingURL comments in source order, including multiline blocks.
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
  "g",
);

function getSourceMappingURL(code: string) {
  let match: RegExpMatchArray | null = null;
  for (const candidate of code.matchAll(sourceMappingURLRegex)) {
    match = candidate;
  }
  const sourceMappingURL = match ? match[1] || match[2] || "" : null;

  return {
    sourceMappingURL,
    replacementString: match ? match[0] : null,
  };
}

export { getSourceMappingURL };
