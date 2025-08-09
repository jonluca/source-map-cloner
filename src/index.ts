export { fetchAndWriteSourcesForUrl, cloneSourceMaps } from "./core/processor";
export { noopLogger, createConsoleLogger } from "./utils/default-logger";
export type {
  CloneOptions,
  CloneResult,
  SourceMapClonerOptions,
  SourceFile,
  FetchFunction,
  Logger,
} from "./core/types";
