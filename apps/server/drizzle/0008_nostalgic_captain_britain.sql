ALTER TABLE "user_facts" DROP CONSTRAINT "user_facts_supersedes_id_user_facts_id_fk";
--> statement-breakpoint
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_supersedes_id_user_facts_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."user_facts"("id") ON DELETE set null ON UPDATE no action;