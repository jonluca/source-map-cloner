import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { cloneSourceMaps } from "source-map-cloner/src/index.js";
import { createNodeFetch } from "source-map-cloner/src/fetchers/node.js";

export const sourceMapRouter = createTRPCRouter({
  fetchSourceMap: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const result = await cloneSourceMaps({
          urls: [input.url],
          fetch: createNodeFetch(),
        });

        // Transform Map to array and build directory structure
        const filesArray = Array.from(result.files.entries()).map(([path, content]) => ({
          path,
          content,
        }));

        // Build directory structure
        const directoryStructure = buildDirectoryStructure(filesArray);

        return {
          files: filesArray,
          stats: result.stats,
          errors: result.errors,
          directoryStructure,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to fetch source map",
        });
      }
    }),
});

// Helper function to build directory structure
function buildDirectoryStructure(files: Array<{ path: string; content: string }>) {
  interface TreeNode {
    name: string;
    type: "file" | "directory";
    children?: TreeNode[];
    path?: string;
  }

  const root: TreeNode = {
    name: "/",
    type: "directory",
    children: [],
  };

  files.forEach((file) => {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;

      current.children ??= [];

      let child = current.children.find((c) => c.name === part);

      if (!child) {
        child = {
          name: part,
          type: isFile ? "file" : "directory",
          ...(isFile ? { path: file.path } : { children: [] }),
        };
        current.children.push(child);
      }

      if (!isFile) {
        current = child;
      }
    });
  });

  return root;
}
