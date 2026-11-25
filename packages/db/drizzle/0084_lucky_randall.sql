CREATE TABLE "blob_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blob_files_bytes_range" CHECK ("blob_files"."bytes" between 1 and 10485760),
	CONSTRAINT "blob_files_bytes_match" CHECK ("blob_files"."bytes" = octet_length("blob_files"."data")),
	CONSTRAINT "blob_files_sha256_check" CHECK ("blob_files"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "feedback_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"original_name" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"blob_ref" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "feedback_attachments_kind_check" CHECK ("feedback_attachments"."kind" in ('image', 'pdf', 'docx')),
	CONSTRAINT "feedback_attachments_bytes_range" CHECK ("feedback_attachments"."bytes" between 1 and 10485760),
	CONSTRAINT "feedback_attachments_name_length" CHECK (char_length("feedback_attachments"."original_name") between 1 and 200),
	CONSTRAINT "feedback_attachments_sha256_check" CHECK ("feedback_attachments"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "feedback_attachments_size_check" CHECK (("feedback_attachments"."width" is null) = ("feedback_attachments"."height" is null) and ("feedback_attachments"."width" is null or ("feedback_attachments"."width" > 0 and "feedback_attachments"."height" > 0)))
);
--> statement-breakpoint
CREATE TABLE "feedback_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"path" text NOT NULL,
	"category" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'nuevo' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_items_status_check" CHECK ("feedback_items"."status" in ('nuevo', 'visto', 'resuelto')),
	CONSTRAINT "feedback_items_category_check" CHECK ("feedback_items"."category" in ('algo_no_anduvo', 'idea', 'confuso')),
	CONSTRAINT "feedback_items_message_length" CHECK (char_length("feedback_items"."message") between 0 and 50000),
	CONSTRAINT "feedback_items_path_length" CHECK (char_length("feedback_items"."path") between 1 and 200),
	CONSTRAINT "feedback_items_position_range" CHECK ("feedback_items"."position" between 0 and 29)
);
--> statement-breakpoint
CREATE TABLE "feedback_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'borrador' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_reports_status_check" CHECK ("feedback_reports"."status" in ('borrador', 'enviado', 'visto', 'resuelto')),
	CONSTRAINT "feedback_reports_sent_check" CHECK ("feedback_reports"."status" = 'borrador' or "feedback_reports"."sent_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "blob_files" ADD CONSTRAINT "blob_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_item_id_feedback_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."feedback_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_report_id_feedback_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."feedback_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blob_files_user" ON "blob_files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "feedback_attachments_item" ON "feedback_attachments" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "feedback_attachments_user" ON "feedback_attachments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_items_report_position" ON "feedback_items" USING btree ("report_id","position");--> statement-breakpoint
CREATE INDEX "feedback_items_user" ON "feedback_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "feedback_reports_user_created" ON "feedback_reports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_reports_sent" ON "feedback_reports" USING btree ("sent_at" DESC NULLS LAST) WHERE "feedback_reports"."status" <> 'borrador';--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_reports_one_draft" ON "feedback_reports" USING btree ("user_id") WHERE "feedback_reports"."status" = 'borrador';