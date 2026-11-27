CREATE TABLE `work_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`sections` text DEFAULT '["crm","kpi","stats"]' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `work_roles_company_idx` ON `work_roles` (`company_id`);--> statement-breakpoint
ALTER TABLE `kpi_versions` ADD `effective_from` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `work_role_id` text;