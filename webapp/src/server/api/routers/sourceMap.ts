import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { cloneSourceMaps } from "source-map-cloner";
import { createNodeFetch } from "source-map-cloner/fetchers";

export const sourceMapRouter = createTRPCRouter({
  fetchSourceMap: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const files = await cloneSourceMaps({
          urls: [input.url],
          fetch: createNodeFetch(),
        });

        return files;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to fetch source map",
        });
      }
    }),
});
