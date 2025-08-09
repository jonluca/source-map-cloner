import type { FetchFunction } from "../core/types.js";
import parseDataURL from "../parsers/data-url.js";
import * as iconv from "iconv-lite";
const { decode } = iconv;
import labelsToNames from "../parsers/label-mapper";

/**
 * Fetch content from a URL (including data URLs)
 */
export async function fetchFromURL(
  sourceMapUrl: string,
  baseUrl: string,
  headers: Record<string, string>,
  fetch: FetchFunction,
): Promise<{ sourceContent: string }> {
  // Handle data URLs
  if (sourceMapUrl.startsWith("data:")) {
    const dataURL = parseDataURL(sourceMapUrl);
    if (dataURL) {
      // JSON text SHALL be encoded in Unicode. The default encoding is UTF-8.
      const encodingName = labelToName(dataURL.parameters.get("charset")) || "UTF-8";
      const sourceContent = decode(dataURL.body, encodingName);
      return { sourceContent };
    }
    throw new Error(`Failed to parse source map from "data" URL: ${sourceMapUrl}`);
  }

  // Handle regular URLs
  const absoluteUrl = new URL(sourceMapUrl, baseUrl).href;
  const response = await fetch(absoluteUrl, { headers });
  return { sourceContent: response.body };
}

function labelToName(label: any): string | null {
  if (!label) {
    return null;
  }
  const labelLowercase = String(label).trim().toLowerCase();

  // @ts-ignore
  return labelsToNames[labelLowercase] || null;
}
