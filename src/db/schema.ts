import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  date,
  unique,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "claimant",
  "adjuster",
  "supervisor",
]);

export const claimStatusEnum = pgEnum("claim_status", [
  "intake",
  "triage",
  "investigating",
  "approved",
  "denied",
  "paid",
  "closed",
  "reopened",
  "withdrawn",
]);

export const documentTypeEnum = pgEnum("document_type", [
  "police_report",
  "damage_photo",
  "repair_invoice",
  "repair_proof",
  "other",
]);

// Whether the deductible is subtracted before or after the limit is applied.
export const deductibleOrderEnum = pgEnum("deductible_order", [
  "before_limit",
  "after_limit",
]);

// Whether the limit is applied per occurrence or against the policy aggregate.
export const limitModeEnum = pgEnum("limit_mode", [
  "per_occurrence",
  "aggregate",
]);

// Doubles as the Better Auth "user" model (see drizzleAdapter config in
// src/lib/auth.ts) — emailVerified/image/createdAt/updatedAt are required
// by Better Auth's core schema; role is a Better Auth additionalField.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  role: userRoleEnum("role").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Better Auth core tables — required by the drizzle adapter (usePlural: true).
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // The account id as provided by the SSO, or equal to userId for credential accounts.
  accountId: varchar("account_id", { length: 255 }).notNull(),
  providerId: varchar("provider_id", { length: 100 }).notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  idToken: text("id_token"),
  // Only set for the email/password (credentials) provider.
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: varchar("identifier", { length: 255 }).notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const policies = pgTable("policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  policyNumber: varchar("policy_number", { length: 100 }).notNull().unique(),
  currency: varchar("currency", { length: 3 }).notNull().default("ILS"),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  // Money stored as integer agorot (1 ILS = 100 agorot) to avoid float rounding errors.
  deductibleAgorot: integer("deductible_agorot").notNull(),
  perOccurrenceLimitAgorot: integer("per_occurrence_limit_agorot").notNull(),
  aggregateLimitAgorot: integer("aggregate_limit_agorot").notNull(),
  // Settlement order parameters; persisted (not hard-coded) and auditable.
  deductibleOrder: deductibleOrderEnum("deductible_order")
    .notNull()
    .default("before_limit"),
  limitMode: limitModeEnum("limit_mode").notNull().default("per_occurrence"),
});

export const claims = pgTable("claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Human-readable claim reference, e.g. "CLM-2026-0007".
  claimRef: varchar("claim_ref", { length: 50 }).notNull().unique(),
  claimantId: uuid("claimant_id")
    .notNull()
    .references(() => users.id),
  policyId: uuid("policy_id")
    .notNull()
    .references(() => policies.id),
  currency: varchar("currency", { length: 3 }).notNull().default("ILS"),
  dateOfLoss: date("date_of_loss").notNull(),
  status: claimStatusEnum("status").notNull().default("intake"),
  // Optimistic concurrency control: incremented on every update, checked in WHERE clause.
  version: integer("version").notNull().default(1),
  // Nullable; set exactly once to enforce a single settlement per claim.
  settledAt: timestamp("settled_at", { withTimezone: true }),
});

export const claimItems = pgTable("claim_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => claims.id),
  category: varchar("category", { length: 100 }).notNull(),
  ageMonths: integer("age_months").notNull(),
  // Money stored as integer agorot (1 ILS = 100 agorot) to avoid float rounding errors.
  claimedAgorot: integer("claimed_agorot").notNull(),
});

export const reserves = pgTable("reserves", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => claims.id),
  amountAgorot: integer("amount_agorot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id),
    amountAgorot: integer("amount_agorot").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
  },
  (table) => [
    unique("payments_claim_id_idempotency_key_unique").on(
      table.claimId,
      table.idempotencyKey,
    ),
  ],
);

export const recoveries = pgTable("recoveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => claims.id),
  amountAgorot: integer("amount_agorot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => claims.id),
  fileKey: varchar("file_key", { length: 512 }).notNull(),
  docType: documentTypeEnum("doc_type").notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => claims.id),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const claimsRelations = relations(claims, ({ one, many }) => ({
  claimant: one(users, {
    fields: [claims.claimantId],
    references: [users.id],
  }),
  policy: one(policies, {
    fields: [claims.policyId],
    references: [policies.id],
  }),
  items: many(claimItems),
  reserves: many(reserves),
  payments: many(payments),
  recoveries: many(recoveries),
  documents: many(documents),
  auditLogs: many(auditLogs),
}));

export const claimItemsRelations = relations(claimItems, ({ one }) => ({
  claim: one(claims, {
    fields: [claimItems.claimId],
    references: [claims.id],
  }),
}));
