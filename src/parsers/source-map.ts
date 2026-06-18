import sourceMap, {
  type BasicSourceMapConsumer,
  type IndexedSourceMapConsumer,
  type RawIndexMap,
  type RawSourceMap,
} from "source-map";
import pMap from "p-map";
import { SourceMapParseError } from "../utils/errors.js";
import { getOutputPath, normalizeSourcePath } from "../utils/paths.js";
import type { SourceMapClonerOptions, SourceFile } from "../core/types.js";

const { SourceMapConsumer } = sourceMap;

export interface ParsedSourceMap {
  sources: string[];
  sourcesContent: (string | null)[];
}

interface RawSourceMapWithContent {
  sourcesContent?: unknown[];
}

function getRawSourceContent(rawSourcesContent: unknown[] | undefined, index: number): string | null | undefined {
  const content = rawSourcesContent?.[index];

  if (typeof content === "string" || content === null) {
    return content;
  }

  return undefined;
}

function parseSourceMapJson(value: string): object {
  const normalized = value
    .replace(/^\uFEFF/, "")
    .trimStart()
    .replace(/^(?:\)\]\}',?|while\s*\(1\)\s*;|for\s*\(;;\)\s*;)\s*/, "");

  return JSON.parse(normalized) as object;
}

/**
 * Parse a source map from string or object
 */
export async function parseSourceMap(sourceMapData: string | object, sourceUrl: string): Promise<ParsedSourceMap> {
  let consumer: BasicSourceMapConsumer | IndexedSourceMapConsumer | undefined;

  try {
    const rawSourceMap = typeof sourceMapData === "string" ? parseSourceMapJson(sourceMapData) : sourceMapData;
    const rawSourcesContent = Array.isArray((rawSourceMap as RawSourceMapWithContent).sourcesContent)
      ? (rawSourceMap as RawSourceMapWithContent).sourcesContent
      : undefined;

    consumer = await new SourceMapConsumer(rawSourceMap as RawSourceMap | RawIndexMap);
    const sources = consumer.sources || [];

    return {
      sources,
      sourcesContent: sources.map((source, index) => {
        const rawContent = getRawSourceContent(rawSourcesContent, index);
        if (rawContent !== undefined) {
          return rawContent;
        }

        const content = consumer?.sourceContentFor(source, true);
        return typeof content === "string" ? content : null;
      }),
    };
  } catch (error) {
    throw new SourceMapParseError(sourceUrl, error);
  } finally {
    consumer?.destroy();
  }
}

function getFetchableSourceUrl(source: string, sourceMapUrl: string): string | null {
  try {
    const url = new URL(source, sourceMapUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

async function fetchMissingSourceContent(
  parsedMap: ParsedSourceMap,
  sourceMapUrl: string,
  options: SourceMapClonerOptions,
): Promise<ParsedSourceMap> {
  if (options.fetchMissingSources === false || !parsedMap.sourcesContent.some((content) => content === null)) {
    return parsedMap;
  }

  const sourcesContent = [...parsedMap.sourcesContent];
  const missingIndexes = sourcesContent.flatMap((content, index) => (content === null ? [index] : []));

  await pMap(
    missingIndexes,
    async (index) => {
      const source = parsedMap.sources[index];
      if (!source || isSyntheticSource(source)) {
        return;
      }

      const sourceUrl = getFetchableSourceUrl(source, sourceMapUrl);
      if (!sourceUrl) {
        return;
      }

      try {
        const response = await options.fetch(sourceUrl, { headers: options.headers ?? {} });
        sourcesContent[index] = response.body;

        if (options.verbose) {
          options.logger.info(`Fetched missing source content: ${sourceUrl}`);
        }
      } catch (error) {
        if (options.verbose) {
          options.logger.warn(`Failed to fetch missing source ${sourceUrl}: ${error}`);
        }
      }
    },
    { concurrency: Math.max(1, Math.min(options.concurrency ?? 8, 8)) },
  );

  return { ...parsedMap, sourcesContent };
}

function isSyntheticSource(source: string): boolean {
  const normalized = normalizeSourcePath(source);
  return source.includes("[synthetic:") || normalized.startsWith("[synthetic:") || normalized.startsWith("[synthetic_");
}

/**
 * Extract source files from a parsed source map
 */
export function extractSourceFiles(
  parsedMap: ParsedSourceMap,
  sourceUrl: string,
  options: SourceMapClonerOptions,
): SourceFile[] {
  const url = new URL(sourceUrl);
  const pathname = url.pathname;
  const files: SourceFile[] = [];
  let missingContentCount = 0;

  for (let i = 0; i < parsedMap.sources.length; i++) {
    const source = parsedMap.sources[i];
    if (!source) {
      continue;
    }
    const sourceContent = parsedMap.sourcesContent[i];

    // Skip synthetic sources
    if (isSyntheticSource(source)) {
      continue;
    }

    if (sourceContent === null || sourceContent === undefined) {
      missingContentCount += 1;
      continue;
    }

    try {
      const outputPath = getOutputPath(source, {
        outputPrefix: "",
        urlPath: pathname,
      });

      files.push({
        path: outputPath,
        content: sourceContent,
      });

      if (options.verbose) {
        options.logger.info(`Extracted source: ${outputPath}`);
      }
    } catch (error) {
      options.logger.error(`Error processing source ${source}: ${error}`);
      if (options.verbose) {
        console.error(error);
      }
    }
  }

  if (options.verbose && missingContentCount > 0) {
    options.logger.warn(`Skipped ${missingContentCount} source map entries without source content`);
  }

  return files;
}

/**
 * Process a source map and return extracted files
 */
export async function processSourceMap(
  sourceMapData: string | object,
  sourceUrl: string,
  options: SourceMapClonerOptions,
): Promise<SourceFile[]> {
  try {
    const parsedMap = await fetchMissingSourceContent(
      await parseSourceMap(sourceMapData, sourceUrl),
      sourceUrl,
      options,
    );
    const files = extractSourceFiles(parsedMap, sourceUrl, options);

    if (options.verbose) {
      options.logger.info(`Extracted ${files.length} files from ${sourceUrl}`);
    }

    return files;
  } catch (error) {
    if (error instanceof SourceMapParseError) {
      options.logger.error(error.message);
    } else {
      options.logger.error(`Error processing source map for ${sourceUrl}: ${error}`);
    }

    if (options.verbose) {
      console.error(error);
    }

    return [];
  }
}
