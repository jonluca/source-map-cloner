import { gotClient, agent } from "./http-client.js";
import { HTTPError } from "../utils/errors.js";
import type { FetchFunction } from "../core/types.js";

export interface NodeFetchOptions {
  /** Headers included with every request. Per-request headers take precedence. */
  headers?: Record<string, string>;
}

/**
 * Create a fetch function using Got for Node.js environments
 */
export function createNodeFetch(defaultOptions: NodeFetchOptions = {}): FetchFunction {
  return async function nodeFetch(
    url: string,
    options?: { headers?: Record<string, string> },
  ): Promise<{ body: string; statusCode: number; requestUrl: string }> {
    try {
      const response = await gotClient(url, {
        headers: { ...defaultOptions.headers, ...options?.headers },
        agent,
        responseType: "text",
      });

      return {
        body: response.body,
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
