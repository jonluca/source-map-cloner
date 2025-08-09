import { gotClient, agent } from "./http-client.js";
import { HTTPError } from "../utils/errors.js";
import type { FetchFunction } from "../core/types.js";

/**
 * Create a fetch function using Got for Node.js environments
 */
export function createNodeFetch(): FetchFunction {
  return async function nodeFetch(
    url: string,
    options?: { headers?: Record<string, string> },
  ): Promise<{ body: string; statusCode: number; requestUrl: string }> {
    try {
      const response = await gotClient(url, {
        headers: options?.headers || {},
        agent,
        responseType: "text",
      });

      return {
        body: response.body as string,
        statusCode: response.statusCode,
        requestUrl: response.requestUrl.href,
      };
    } catch (error: any) {
      throw new HTTPError(url, error.response?.statusCode, {
        message: error.message,
        code: error.code,
      });
    }
  };
}
