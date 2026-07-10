import { router } from "../trpc";
import { claimRouter } from "./claim";

export const appRouter = router({
  claim: claimRouter,
});

export type AppRouter = typeof appRouter;
