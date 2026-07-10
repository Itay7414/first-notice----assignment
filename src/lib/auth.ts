import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import * as schema from "@/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
    // Every Better Auth table (users, sessions, accounts, verifications) is plural.
    usePlural: true,
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: ["claimant", "adjuster", "supervisor"],
        required: true,
        // Role is assigned server-side (e.g. via seeding), never chosen at signup.
        input: false,
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
