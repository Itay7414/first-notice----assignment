The system is fully complete, working, and finalized! Let's write a stellar, comprehensive README.md file for this project that showcases the architecture and high-quality solutions we implemented. 

The README must cleanly cover:
1. Project Overview & Tech Stack (Next.js App Router, Better Auth, Drizzle ORM, Neon Serverless via WebSockets with multi-tenant/role based routing).
2. Key Functional Requirements Handled:
   - State Machine Transitions (with strict optimistic concurrency version gates to prevent race conditions).
   - Financial Core Logic (using integer/Agorot calculations with zero floating-point math for strict financial precision).
   - Apportionment Algorithm (FR-3.2: Hamilton method/Largest Remainder for fair value splitting over policy limits, using deterministic string sorting for ties).
   - Reserve Management & Append-only Ledger (FR-5 / FR-7: Atomic transactions via db.transaction and SELECT FOR UPDATE, supervisor budget bypass role gates, and live audit trail ui with recordedById and idempotency keys).
   - Mock Upload Dev Fallback (custom detection for UploadThing when local UPLOADTHING_TOKEN is missing, ensuring flawless manual evaluation without external dependencies).
   - Claim Finalization & Formal Summary Letter (FR-6 / FR-8: rendering an official, unmodifiable printable legal summary letter).
3. How to Setup and Run (Prerequisites, .env configuration, running npm run db:push, npm run db:seed, and vitest for the 19 automated business tests).

Format it beautifully with professional markdown, headers, and bullet points.