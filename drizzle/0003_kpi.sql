CREATE TABLE `kpi_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`scope` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`indicators` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`approved_by` text,
	`approved_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kpi_versions_scope_version_unique` ON `kpi_versions` (`company_id`,`scope`,`version`);--> statement-breakpoint
CREATE INDEX `kpi_versions_approved_idx` ON `kpi_versions` (`company_id`,`scope`,`approved_at`);