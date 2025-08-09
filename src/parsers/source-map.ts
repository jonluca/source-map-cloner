import type { RawSourceMap } from "source-map-js";
import sourceMap from "source-map";
import { SourceMapParseError } from "../utils/errors.js";
import { getOutputPath } from "../utils/paths.js";
import type { SourceMapClonerOptions, SourceFile } from "../core/types.js";

const { SourceMapConsumer } = sourceMap;

export interface ParsedSourceMap {
  sources: string[];
  sourcesContent: (string | null)[];
}

/**
 * Parse a source map from string or object
 */
export async function parseSourceMap(
  sourceMapData: string | object,
  sourceUrl: string,
): Promise<ParsedSourceMap> {
  try {
    const parsed = (await new SourceMapConsumer(
      typeof sourceMapData === "string"
        ? JSON.parse(sourceMapData)
        : sourceMapData,
    )) as unknown as RawSourceMap;

    return {
      sources: parsed.sources || [],
      sourcesContent: parsed.sourcesContent || [],
    };
  } catch (error) {
    throw new SourceMapParseError(sourceUrl, error);
  }
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

  for (let i = 0; i < parsedMap.sources.length; i++) {
    const source = parsedMap.sources[i];
    const sourceContent = parsedMap.sourcesContent[i];

    // Skip synthetic sources
    if (source.startsWith("[synthetic:")) {
      continue;
    }

    if (!sourceContent) {
      if (options.verbose) {
        options.logger.warn(`No source content for ${source}`);
      }
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
    const parsedMap = await parseSourceMap(sourceMapData, sourceUrl);
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
