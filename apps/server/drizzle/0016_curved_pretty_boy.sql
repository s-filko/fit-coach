CREATE INDEX "idx_conversation_turns_run_id" ON "conversation_turns" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_llm_calls_run_id_call_index" ON "llm_calls" USING btree ("run_id","call_index");--> statement-breakpoint
CREATE INDEX "idx_llm_calls_prompt_hashes_gin" ON "llm_calls" USING gin ("prompt_hashes");