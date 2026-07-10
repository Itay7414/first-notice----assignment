import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { db } from "@/db";
import { auth } from "@/lib/auth";

export async function createTRPCContext(opts: { headers: Headers }) {
  const session = await auth.api.getSession({ headers: opts.headers });

  return {
    db,
    session,
  };
}

type Context = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

export const createCallerFactory = t.createCallerFactory;
export const router = t.router;

export const publicProcedure = t.procedure;

// Every procedure in this app must go through this: it verifies a valid
// Better Auth session exists and narrows `ctx.session` to non-null for
// everything downstream.
const requireAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be logged in to do this.",
    });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireAuth);
