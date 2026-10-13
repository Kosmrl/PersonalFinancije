CREATE TABLE "obrt_profiles" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"trade_name" text NOT NULL,
	"owner_full_name" text NOT NULL,
	"oib" char(11) NOT NULL,
	"street" text NOT NULL,
	"postal_code" text NOT NULL,
	"city" text NOT NULL,
	"country_code" char(2) DEFAULT 'HR' NOT NULL,
	"iban" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"website" text,
	"in_vat_system" boolean DEFAULT false NOT NULL,
	"default_invoice_note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "obrt_profiles_oib_unique" UNIQUE("oib"),
	CONSTRAINT "obrt_profiles_not_in_vat_system" CHECK ("obrt_profiles"."in_vat_system" = false)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"oib" char(11),
	"vat_id" text,
	"street" text,
	"postal_code" text,
	"city" text,
	"country_code" char(2) DEFAULT 'HR' NOT NULL,
	"email" text,
	"note" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "customers_kind_check" CHECK ("customers"."kind" in ('person', 'business')),
	CONSTRAINT "customers_hr_business_requires_oib" CHECK (not ("customers"."kind" = 'business' and "customers"."country_code" = 'HR' and "customers"."oib" is null))
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit_code" text NOT NULL,
	"unit_price" numeric(19, 6) NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"kpd_code" char(6),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "items_unit_price_non_negative" CHECK ("items"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"request_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "obrt_profiles" ADD CONSTRAINT "obrt_profiles_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_organization_id_oib_active_uidx" ON "customers" USING btree ("organization_id","oib") WHERE "customers"."oib" is not null and "customers"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "customers_organization_id_lower_name_idx" ON "customers" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "items_organization_id_lower_name_idx" ON "items" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "audit_log_organization_id_occurred_at_idx" ON "audit_log" USING btree ("organization_id","occurred_at" DESC NULLS LAST);