/**
 * Logger interface
 */
export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug?: (message: string) => void;
}

/**
 * Represents a file in memory with its path and content
 */
export interface SourceFile {
  path: string;
  content: string;
}

/**
 * Result of source map cloning operation
 */
export interface CloneResult {
  /**
   * Map of file paths to their contents
   */
  files: Map<string, string>;

  /**
   * Statistics about the operation
   */
  stats: {
    totalFiles: number;
    totalSize: number;
    scriptsProcessed: number;
    sourceMapsFound: number;
    urls: string[];
    duration?: number;
  };

  /**
   * Any errors encountered during processing
   */
  errors: {
    url?: string;
    file?: string;
    error: string;
  }[];

  /** Non-fatal conditions where output was still preserved. */
  warnings: {
    url?: string;
    file?: string;
    warning: string;
  }[];
}

/**
 * Fetch function interface for HTTP requests
 */
export type FetchFunction = (
  url: string,
  options?: {
    headers?: Record<string, string>;
  },
) => Promise<{
  body: string;
  statusCode: number;
  requestUrl: string;
}>;

/**
 * Options for source map cloning
 */
export interface SourceMapClonerOptions {
  fetch: FetchFunction;
  logger: Logger;
  verbose?: boolean;
  headers?: Record<string, string>;
  baseUrl?: URL;
  seenSources?: Set<string>;
  concurrency?: number;
  fetchMissingSources?: boolean;
  discoverReferencedScripts?: boolean;
  maxScriptDepth?: number;
  maxScripts?: number;
  followCrossOriginScripts?: boolean;
}

/**
 * Public API options for cloning
 */
export interface CloneOptions {
  urls: string | [string, ...string[]];
  fetch: FetchFunction;
  logger?: Logger;
  crawl?: boolean;
  cleanupKnownInvalidFiles?: boolean;
  headers?: Record<string, string>;
  verbose?: boolean;
  /** Maximum number of JavaScript files processed at once. Defaults to 20. */
  concurrency?: number;
  /** Fetch source files referenced by maps that omit sourcesContent. Defaults to true. */
  fetchMissingSources?: boolean;
  /** Recursively inspect fetched bundles for additional JavaScript chunks. Defaults to true. */
  discoverReferencedScripts?: boolean;
  /** Maximum referenced-script depth beyond scripts found in HTML. Defaults to 3. */
  maxScriptDepth?: number;
  /** Maximum JavaScript files processed across the operation. Defaults to 500. */
  maxScripts?: number;
  /** Follow cross-origin references found inside bundles. Defaults to false. */
  followCrossOriginScripts?: boolean;
}
