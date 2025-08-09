/**
 * Isomorphic path utilities that work in both Node.js and browser
 */

/**
 * Join path segments
 */
export function joinPath(...segments: string[]): string {
  return segments
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/\.\//g, "/")
    .replace(/\/$/g, "");
}

/**
 * Parse a path to get directory and filename
 */
export function parsePath(path: string): {
  dir: string;
  base: string;
  name: string;
  ext: string;
} {
  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash >= 0 ? path.substring(0, lastSlash) : "";
  const base = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
  const lastDot = base.lastIndexOf(".");
  const ext = lastDot > 0 ? base.substring(lastDot) : "";
  const name = lastDot > 0 ? base.substring(0, lastDot) : base;

  return { dir, base, name, ext };
}

/**
 * Get the directory name of a path
 */
export function dirname(path: string): string {
  return parsePath(path).dir;
}

/**
 * Sanitize a path to prevent directory traversal
 */
export function sanitizePath(basePath: string, relativePath: string): string {
  // Remove leading protocol and domain
  let sanitized = relativePath
    .replace(/^webpack:\/\/_N_E\//, "")
    .replace(/^(.*?):\/\//, "");

  // Remove leading slashes
  sanitized = sanitized.replace(/^\/+/, "");

  // Remove .. references that would escape the base path
  while (sanitized.includes("../")) {
    sanitized = sanitized.replace(/^\.\.\//, "").replace(/\/\.\.\//g, "/");
  }

  // Join with base path
  const joined = joinPath(basePath, sanitized);

  // Ensure the result doesn't escape the base path
  if (!joined.startsWith(basePath)) {
    return joinPath(basePath, sanitized.replace(/\.\./g, ""));
  }

  return joined;
}

/**
 * Get output path for a source file
 */
export function getOutputPath(
  source: string,
  options: {
    outputPrefix?: string;
    urlPath?: string;
  },
): string {
  const { outputPrefix = "" } = options;

  const value = source
    .replace(/^webpack:\/\/_N_E\//, "")
    .replace(/^(.*?):\/\//, "");

  if (!value) {
    throw new Error(`Empty source path: ${source}`);
  }

  const outputPath: string = joinPath(outputPrefix, value);

  // Sanitize the path
  return sanitizePath(outputPrefix, outputPath.replace(outputPrefix, ""));
}
