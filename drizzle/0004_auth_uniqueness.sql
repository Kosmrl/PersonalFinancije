DROP INDEX "organization_slug_uidx";--> statement-breakpoint
DROP INDEX "twoFactor_userId_idx";--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_user_id_unique" UNIQUE("organization_id","user_id");--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_unique" UNIQUE("user_id");