import type { FetchFunction } from "../core/types";
import { HTTPError } from "../utils/errors";

/**
 * Create a fetch function using the browser's fetch API
 */
export function createBrowserFetch(): FetchFunction {
  if (typeof fetch === "undefined") {
    throw new Error("Fetch API is not available in this environment");
  }

  return async function browserFetch(
    url: string,
    options?: { headers?: Record<string, string> },
  ): Promise<{ body: string; statusCode: number; requestUrl: string }> {
    try {
      const response = await fetch(url, {
        headers: options?.headers,
      });

      if (!response.ok) {
        throw new HTTPError(url, response.status, {
          message: response.statusText,
        });
      }

      const body = await response.text();

      return {
        body,
        statusCode: response.status,
        requestUrl: response.url,
      };
    } catch (error: any) {
      if (error instanceof HTTPError) {
        throw error;
      }
      throw new HTTPError(url, undefined, {
        message: error.message,
      });
    }
  };
}
