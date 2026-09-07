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

function getRawSourcesContent(rawSourceMap: RawSourceMap | RawIndexMap): (string | null)[] {
  if ("sections" in rawSourceMap) {
    return rawSourceMap.sections.flatMap(({ map }) => getRawSourcesContent(map));
  }

  const contents = Array.isArray(rawSourceMap.sourcesContent) ? rawSourceMap.sourcesContent : [];
  return rawSourceMap.sources.map((_, index) => {
    const content = contents[index];
    return typeof content === "string" ? content : null;
  });
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
    const rawSourceMap = (typeof sourceMapData === "string" ? parseSourceMapJson(sourceMapData) : sourceMapData) as
      | RawSourceMap
      | RawIndexMap;

    consumer = await new SourceMapConsumer(rawSourceMap);
    const sources = consumer.sources || [];

    return {
      sources,
      // Keep content aligned by source index, including across nested sections.
      // Looking it up by name loses duplicate entries and empty indexed sources.
      sourcesContent: getRawSourcesContent(rawSourceMap),
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
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new Error(`HTTP ${response.statusCode}`);
        }
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
