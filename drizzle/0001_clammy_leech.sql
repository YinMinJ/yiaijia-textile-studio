CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`module_id` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`error` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_generation_owner_project` ON `generation_jobs` (`owner_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `model_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`protocol` text NOT NULL,
	`base_url` text NOT NULL,
	`model` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`key_hint` text NOT NULL,
	`updated_at` text NOT NULL
);
