CREATE TABLE `wa_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`name` text NOT NULL,
	`instructions` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	`last_test_at` integer,
	`last_test_ok` integer,
	`last_test_mode` text,
	`last_test_error` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wa_agents_branch_unique` ON `wa_agents` (`branch_id`);--> statement-breakpoint
CREATE TABLE `wa_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`phone` text,
	`webhook_token_hash` text NOT NULL,
	`status` text NOT NULL,
	`connected_by` text,
	`connected_at` integer,
	`last_check_at` integer,
	`last_check_state` text,
	`last_check_detail` text,
	`last_inbound_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wa_channels_branch_unique` ON `wa_channels` (`branch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wa_channels_token_unique` ON `wa_channels` (`webhook_token_hash`);--> statement-breakpoint
CREATE TABLE `wa_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`company_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `wa_agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wa_materials_agent_idx` ON `wa_materials` (`agent_id`);--> statement-breakpoint
CREATE TABLE `wa_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`direction` text NOT NULL,
	`text` text NOT NULL,
	`external_id` text,
	`status` text NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lead_id` text,
	`reply_to_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wa_messages_external_unique` ON `wa_messages` (`external_id`);--> statement-breakpoint
CREATE INDEX `wa_messages_branch_idx` ON `wa_messages` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `wa_messages_status_idx` ON `wa_messages` (`status`,`created_at`);