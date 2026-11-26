CREATE TABLE `lead_events` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`company_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`type` text NOT NULL,
	`field` text,
	`old_value` text,
	`new_value` text,
	`actor_user_id` text,
	`op_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lead_events_lead_idx` ON `lead_events` (`lead_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lead_operations` (
	`op_id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`number` integer NOT NULL,
	`client_name` text NOT NULL,
	`client_phone` text,
	`client_company` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`stage` text NOT NULL,
	`owner_user_id` text,
	`next_contact_at` integer,
	`amount` integer,
	`lost_reason` text,
	`search_text` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_op_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`stage_changed_at` integer NOT NULL,
	`closed_at` integer,
	`closed_owner_user_id` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_company_number_unique` ON `leads` (`company_id`,`number`);--> statement-breakpoint
CREATE INDEX `leads_branch_stage_idx` ON `leads` (`branch_id`,`stage`);--> statement-breakpoint
CREATE INDEX `leads_branch_owner_idx` ON `leads` (`branch_id`,`owner_user_id`);--> statement-breakpoint
CREATE INDEX `leads_branch_next_contact_idx` ON `leads` (`branch_id`,`next_contact_at`);--> statement-breakpoint
CREATE INDEX `leads_company_closed_idx` ON `leads` (`company_id`,`closed_at`);--> statement-breakpoint
CREATE INDEX `leads_company_created_idx` ON `leads` (`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `leads_branch_phone_idx` ON `leads` (`branch_id`,`client_phone`);