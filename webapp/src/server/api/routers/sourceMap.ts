import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { fetchSourceMapFromUrl } from "~/server/sourceMapFetcher";
import { TRPCError } from "@trpc/server";

export const sourceMapRouter = createTRPCRouter({
  fetchSourceMap: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const files = await fetchSourceMapFromUrl(input.url);

        return {
          success: true,
          files,
          fileCount: files.length,
          url: input.url,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to fetch source map",
        });
      }
    }),
});
