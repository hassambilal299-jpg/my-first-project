/**
 * One-time schema setup.
 *
 * The sandbox this was built in can't reach the production database, so the
 * tables are created from inside the app, which can. Guarded by CRON_SECRET —
 * the same secret that protects the scheduled check — so a stranger can't
 * poke at the schema.
 *
 * Every statement is idempotent: running this twice is a no-op, never an
 * error and never destructive. Nothing here drops or alters existing data.
 */
import { NextRequest, NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Postgres has no CREATE TYPE IF NOT EXISTS, and ADD CONSTRAINT has no
 * IF NOT EXISTS either, so those are wrapped in exception-swallowing blocks.
 */
const STATEMENTS = [
  `DO $$ BEGIN
     CREATE TYPE "public"."frequency" AS ENUM('DAILY', 'WEEKLY');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
     CREATE TYPE "public"."urgency" AS ENUM('urgent', 'normal', 'good_news');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
     CREATE TYPE "public"."plan" AS ENUM('FREE', 'PRO', 'AGENCY');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `CREATE TABLE IF NOT EXISTS "users" (
     "id" text PRIMARY KEY NOT NULL,
     "email" text NOT NULL,
     "password_hash" text NOT NULL,
     "created_at" timestamp with time zone DEFAULT now() NOT NULL,
     CONSTRAINT "users_email_unique" UNIQUE("email")
   )`,

  `CREATE TABLE IF NOT EXISTS "sites" (
     "id" text PRIMARY KEY NOT NULL,
     "user_id" text NOT NULL,
     "url" text NOT NULL,
     "label" text NOT NULL,
     "frequency" "frequency" DEFAULT 'WEEKLY' NOT NULL,
     "paused" boolean DEFAULT false NOT NULL,
     "alert_email" text NOT NULL,
     "last_checked_at" timestamp with time zone,
     "last_score" integer,
     "created_at" timestamp with time zone DEFAULT now() NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS "checks" (
     "id" text PRIMARY KEY NOT NULL,
     "site_id" text NOT NULL,
     "score" integer NOT NULL,
     "grade" text NOT NULL,
     "down" boolean DEFAULT false NOT NULL,
     "findings" jsonb NOT NULL,
     "load_ms" integer NOT NULL,
     "created_at" timestamp with time zone DEFAULT now() NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS "alerts" (
     "id" text PRIMARY KEY NOT NULL,
     "site_id" text NOT NULL,
     "check_id" text NOT NULL,
     "kind" text NOT NULL,
     "subject" text NOT NULL,
     "title" text NOT NULL,
     "detail" text NOT NULL,
     "fix" text,
     "urgency" "urgency" NOT NULL,
     "emailed_at" timestamp with time zone,
     "read_at" timestamp with time zone,
     "created_at" timestamp with time zone DEFAULT now() NOT NULL
   )`,

  `DO $$ BEGIN
     ALTER TABLE "sites" ADD CONSTRAINT "sites_user_id_users_id_fk"
       FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
     ALTER TABLE "checks" ADD CONSTRAINT "checks_site_id_sites_id_fk"
       FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
     ALTER TABLE "alerts" ADD CONSTRAINT "alerts_site_id_sites_id_fk"
       FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
     ALTER TABLE "alerts" ADD CONSTRAINT "alerts_check_id_checks_id_fk"
       FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  /**
   * Added after the first release, so these are ALTERs rather than part of
   * the CREATE TABLEs above. Both forms have to stay correct: a fresh
   * database runs the CREATE and then a no-op ALTER, an existing one runs
   * the no-op CREATE and then a real ALTER.
   */
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan" "plan" DEFAULT 'FREE' NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_renews_at" timestamp with time zone`,
  `ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "share_token" text`,

  `CREATE TABLE IF NOT EXISTS "audit_hits" (
     "id" text PRIMARY KEY NOT NULL,
     "key" text NOT NULL,
     "created_at" timestamp with time zone DEFAULT now() NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS "sites_user_idx" ON "sites" USING btree ("user_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "sites_share_token_unique" ON "sites" USING btree ("share_token")`,
  `CREATE INDEX IF NOT EXISTS "audit_hits_key_created_idx" ON "audit_hits" USING btree ("key","created_at")`,
  `CREATE INDEX IF NOT EXISTS "sites_due_idx" ON "sites" USING btree ("paused","last_checked_at")`,
  `CREATE INDEX IF NOT EXISTS "checks_site_created_idx" ON "checks" USING btree ("site_id","created_at")`,
  `CREATE INDEX IF NOT EXISTS "alerts_site_created_idx" ON "alerts" USING btree ("site_id","created_at")`,
];

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  }

  const header = req.headers.get("authorization");
  const query = req.nextUrl.searchParams.get("secret");
  if (header !== `Bearer ${secret}` && query !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  // A dedicated short-lived connection rather than the shared pool: this runs
  // once, and must not leave a long-lived client behind on a serverless host.
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    for (const statement of STATEMENTS) {
      await sql.unsafe(statement);
    }

    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public'
      order by table_name`;

    return NextResponse.json({
      ok: true,
      applied: STATEMENTS.length,
      tables: tables.map((t) => t.table_name),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
