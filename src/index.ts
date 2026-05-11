export { fetchAndWriteSourcesForUrl, cloneSourceMaps } from "./core/processor.js";
export { noopLogger, createConsoleLogger } from "./utils/default-logger.js";
export type {
  CloneOptions,
  CloneResult,
  SourceMapClonerOptions,
  SourceFile,
  FetchFunction,
  Logger,
} from "./core/types.js";
