import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { fetchAndWriteSourcesForUrl } from "source-map-cloner";
import { TRPCError } from "@trpc/server";

export const sourceMapRouter = createTRPCRouter({
  fetchSourceMap: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
        crawl: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Create an in-memory structure to hold the files
        const files: Record<string, string> = {};
        
        // Mock the file system operations for browser environment
        const mockFs = {
          writeFile: (path: string, content: string) => {
            files[path] = content;
          },
          mkdir: () => Promise.resolve(),
        };

        // Call the source map fetcher with custom options
        const result = await fetchAndWriteSourcesForUrl(
          input.url,
          "memory", // Use memory instead of file system
          {
            crawl: input.crawl,
            headers: {},
            customFs: mockFs as any,
          }
        );

        return {
          success: true,
          files,
          fileCount: Object.keys(files).length,
          result,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to fetch source map",
        });
      }
    }),

  // Proxy endpoint for fetching resources
  proxyFetch: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
        headers: z.record(z.string()).optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const response = await fetch(input.url, {
          headers: input.headers,
        });
        
        const contentType = response.headers.get("content-type") || "";
        const text = await response.text();
        
        return {
          status: response.status,
          contentType,
          body: text,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to fetch URL: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),
});