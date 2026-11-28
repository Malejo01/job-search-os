CREATE TABLE "requirement_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"req_key" text NOT NULL,
	"answer" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirement_answers_key" CHECK (char_length("requirement_answers"."req_key") between 1 and 160),
	CONSTRAINT "requirement_answers_answer" CHECK ("requirement_answers"."answer" in ('si', 'no', 'en_parte')),
	CONSTRAINT "requirement_answers_note" CHECK ("requirement_answers"."note" is null or ("requirement_answers"."answer" = 'en_parte' and char_length("requirement_answers"."note") <= 200))
);
--> statement-breakpoint
ALTER TABLE "requirement_answers" ADD CONSTRAINT "requirement_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_answers_user_key" ON "requirement_answers" USING btree ("user_id","req_key");