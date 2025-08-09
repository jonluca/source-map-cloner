import { sourceMapRouter } from "~/server/api/routers/sourceMap";
import { createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  sourceMap: sourceMapRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
