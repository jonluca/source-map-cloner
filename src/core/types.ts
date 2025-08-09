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
}
