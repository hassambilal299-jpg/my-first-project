/**
 * Database schema (Drizzle ORM, Postgres).
 *
 * After changing anything here, run:  npm run db:push
 */
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { randomBytes } from "crypto";
import type { Finding } from "@/lib/checks";
import type { AlertKind } from "@/lib/diff";

/** Short, URL-safe primary key. Generated in app code, not by Postgres. */
export const createId = () => randomBytes(15).toString("base64url");

export const frequencyEnum = pgEnum("frequency", ["DAILY", "WEEKLY"]);
export const urgencyEnum = pgEnum("urgency", ["urgent", "normal", "good_news"]);
export const planEnum = pgEnum("plan", ["FREE", "PRO", "AGENCY"]);

/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(createId),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),

  /**
   * What they're entitled to. See src/lib/plans.ts for the limits each one
   * carries — nothing in this file enforces anything, it only records which
   * plan they are on.
   */
  plan: planEnum("plan").notNull().default("FREE"),
  /** When the current paid period ends. Null on the free plan. */
  planRenewsAt: timestamp("plan_renews_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A website someone is paying us to watch. */
export const sites = pgTable(
  "sites",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Normalised, always absolute, e.g. "https://mikesplumbing.com/". */
    url: text("url").notNull(),
    /** What the owner calls it. Shown in emails and the dashboard. */
    label: text("label").notNull(),

    frequency: frequencyEnum("frequency").notNull().default("WEEKLY"),
    /** Paused sites stay in the list but are skipped by the scheduler. */
    paused: boolean("paused").notNull().default(false),

    /** Where alerts go. Defaults to the account email at creation time. */
    alertEmail: text("alert_email").notNull(),

    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastScore: integer("last_score"),

    /**
     * Unguessable token for the public report page at /r/<token>.
     *
     * Null means sharing is off, which is the default — turning it on is an
     * explicit act, because the report names every weakness of a real
     * business's website. Rotating the token revokes every link already sent.
     */
    shareToken: text("share_token").unique(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sites_user_idx").on(t.userId),
    // The scheduler's hot path: "which sites are due?"
    index("sites_due_idx").on(t.paused, t.lastCheckedAt),
  ],
);

/** One row per audit run. The history that makes trends visible. */
export const checks = pgTable(
  "checks",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),

    score: integer("score").notNull(),
    grade: text("grade").notNull(),
    down: boolean("down").notNull().default(false),

    /**
     * The full finding list, stored as JSON. Denormalised on purpose: the
     * checks evolve over time, and a report from six months ago should still
     * render exactly as it did then rather than being re-interpreted by
     * today's rules.
     */
    findings: jsonb("findings").$type<Finding[]>().notNull(),

    loadMs: integer("load_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("checks_site_created_idx").on(t.siteId, t.createdAt)],
);

/** Something changed and the owner should know. */
export const alerts = pgTable(
  "alerts",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    checkId: text("check_id")
      .notNull()
      .references(() => checks.id, { onDelete: "cascade" }),

    kind: text("kind").$type<AlertKind>().notNull(),
    /** The finding id this came from, or "score". */
    subject: text("subject").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    fix: text("fix"),
    urgency: urgencyEnum("urgency").notNull(),

    /** Null until an email actually went out for this alert. */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    /** Set when the owner ticks it off in the dashboard. */
    readAt: timestamp("read_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alerts_site_created_idx").on(t.siteId, t.createdAt)],
);

/**
 * One row per free audit run from the home page, used only to cap how many
 * a single visitor may run in an hour. Rows are disposable: see
 * src/lib/rate-limit.ts, which clears out anything older than a few hours.
 *
 * `key` is the client IP. It is never joined to a user or shown anywhere.
 */
export const auditHits = pgTable(
  "audit_hits",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_hits_key_created_idx").on(t.key, t.createdAt)],
);

/* ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ many }) => ({
  sites: many(sites),
}));

export const sitesRelations = relations(sites, ({ one, many }) => ({
  user: one(users, { fields: [sites.userId], references: [users.id] }),
  checks: many(checks),
  alerts: many(alerts),
}));

export const checksRelations = relations(checks, ({ one, many }) => ({
  site: one(sites, { fields: [checks.siteId], references: [sites.id] }),
  alerts: many(alerts),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  site: one(sites, { fields: [alerts.siteId], references: [sites.id] }),
  check: one(checks, { fields: [alerts.checkId], references: [checks.id] }),
}));

/* ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type Check = typeof checks.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
