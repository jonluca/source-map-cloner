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

const bundlerProtocols = new Set(["webpack:", "ng:", "parcel:", "rollup:", "vite:"]);

function safeDecodeURI(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function stripSourceProtocol(source: string): string {
  const trimmed = source.trim().replace(/\\/g, "/");

  try {
    const url = new URL(trimmed);

    if (bundlerProtocols.has(url.protocol)) {
      return safeDecodeURI(url.pathname);
    }

    if (url.protocol === "file:") {
      return safeDecodeURI(url.pathname);
    }

    if (url.protocol === "http:" || url.protocol === "https:") {
      return safeDecodeURI(joinPath(url.hostname, url.pathname));
    }
  } catch {
    // Source map entries are often not valid URLs. Fall back to string cleanup.
  }

  return trimmed.replace(/^(webpack|ng|parcel|rollup|vite):\/\/(?:[^/]+)?/i, "").replace(/^file:\/\//i, "");
}

function normalizeRelativePath(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? "";
  const segments: string[] = [];

  for (const segment of withoutQuery.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      segments.pop();
      continue;
    }

    const sanitized = sanitizePathSegment(segment);
    if (sanitized) {
      segments.push(sanitized);
    }
  }

  return segments.join("/");
}

function sanitizePathSegment(segment: string): string {
  const invalidCharacters = '<>:"|?*';
  let sanitized = Array.from(segment, (character) =>
    character.charCodeAt(0) <= 0x1f || invalidCharacters.includes(character) ? "_" : character,
  )
    .join("")
    .replace(/[. ]+$/g, "")
    .trim();

  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  return sanitized;
}

/**
 * Normalize source map source paths into stable local paths.
 */
export function normalizeSourcePath(source: string): string {
  return normalizeRelativePath(stripSourceProtocol(source));
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
  const base = normalizeRelativePath(basePath);
  const relative = normalizeRelativePath(stripSourceProtocol(relativePath));

  return joinPath(base, relative);
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

  const value = normalizeSourcePath(source);

  if (!value) {
    throw new Error(`Empty source path: ${source}`);
  }

  return sanitizePath(outputPrefix, value);
}
