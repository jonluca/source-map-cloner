export class SourceMapClonerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SourceMapClonerError";
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InvalidURLError extends SourceMapClonerError {
  constructor(url: string, details?: unknown) {
    super(`Invalid URL: ${url}`, "INVALID_URL", details);
    this.name = "InvalidURLError";
  }
}

export class HTTPError extends SourceMapClonerError {
  constructor(url: string, statusCode?: number, details?: unknown) {
    const message = statusCode ? `HTTP ${statusCode} error fetching ${url}` : `Network error fetching ${url}`;
    super(message, "HTTP_ERROR", details);
    this.name = "HTTPError";
  }
}

export class SourceMapParseError extends SourceMapClonerError {
  constructor(url: string, details?: unknown) {
    super(`Failed to parse source map from ${url}`, "PARSE_ERROR", details);
    this.name = "SourceMapParseError";
  }
}

export class FileSystemError extends SourceMapClonerError {
  constructor(operation: string, path: string, details?: unknown) {
    super(`File system error during ${operation}: ${path}`, "FS_ERROR", details);
    this.name = "FileSystemError";
  }
}

export function formatError(error: unknown): string {
  if (error instanceof SourceMapClonerError) {
    return `${error.message}${error.details ? ` (${JSON.stringify(error.details)})` : ""}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
