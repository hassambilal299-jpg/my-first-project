CREATE TYPE "public"."frequency" AS ENUM('DAILY', 'WEEKLY');--> statement-breakpoint
CREATE TYPE "public"."urgency" AS ENUM('urgent', 'normal', 'good_news');--> statement-breakpoint
CREATE TABLE "alerts" (
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
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"score" integer NOT NULL,
	"grade" text NOT NULL,
	"down" boolean DEFAULT false NOT NULL,
	"findings" jsonb NOT NULL,
	"load_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
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
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_site_created_idx" ON "alerts" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "checks_site_created_idx" ON "checks" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "sites_user_idx" ON "sites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sites_due_idx" ON "sites" USING btree ("paused","last_checked_at");