import "dotenv/config";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Using the WebSocket `Pool` driver (not `neon-http`) because FR-5's reserve
// invariant needs a real interactive transaction (read the current reserve,
// decide, then write) — `neon-http` only supports non-interactive batches
// and throws "No transactions support in neon-http driver" at runtime.
// This app runs as a persistent Node.js server (not a per-request edge
// function), so a single module-level pool is safe to reuse across requests.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
