CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`branch_id` text,
	`name` text NOT NULL,
	`provider` text DEFAULT 'openai' NOT NULL,
	`model` text DEFAULT 'gpt-6-luna' NOT NULL,
	`auth_mode` text DEFAULT 'key' NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`delay_seconds` integer DEFAULT 10 NOT NULL,
	`groups_enabled` integer DEFAULT 0 NOT NULL,
	`response_token_limit` integer DEFAULT 4096 NOT NULL,
	`context_chars` integer DEFAULT 18000 NOT NULL,
	`hourly_limit` integer DEFAULT 120 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`kb_version` integer DEFAULT 1 NOT NULL,
	`whapi_status` text DEFAULT 'missing' NOT NULL,
	`whapi_identity` text,
	`whapi_channel_hash` text,
	`whapi_checked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agents_owner` ON `agents` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `channel_single_agent` ON `agents` (`whapi_channel_hash`);--> statement-breakpoint
CREATE TABLE `chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`document_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`content` text NOT NULL,
	`search_content` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chunks_agent` ON `chunks` (`agent_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`name` text NOT NULL,
	`is_group` integer DEFAULT 0 NOT NULL,
	`group_allowed` integer DEFAULT 0 NOT NULL,
	`blocked` integer DEFAULT 0 NOT NULL,
	`handoff` integer DEFAULT 0 NOT NULL,
	`epoch` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`lead_id` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_chat` ON `conversations` (`agent_id`,`chat_id`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`agent_id` text NOT NULL,
	`provider` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `provider`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`hash` text NOT NULL,
	`kind` text DEFAULT 'text' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_dedup` ON `documents` (`agent_id`,`hash`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`status` text NOT NULL,
	`due_at` integer NOT NULL,
	`version` integer NOT NULL,
	`epoch` integer NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_due` ON `jobs` (`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`external_id` text,
	`role` text NOT NULL,
	`type` text DEFAULT 'text' NOT NULL,
	`content` text NOT NULL,
	`media` text,
	`transcript` text,
	`translation` text,
	`knowledge_version` integer,
	`epoch` integer NOT NULL,
	`created_at` integer NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_external` ON `messages` (`agent_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `message_conversation` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`version` integer NOT NULL,
	`epoch` integer NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`body` text NOT NULL,
	`external_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_turn` ON `outbox` (`conversation_id`,`epoch`,`version`);--> statement-breakpoint
CREATE TABLE `prompt_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`agent_id` text NOT NULL,
	`event_id` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `event_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `usage` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`kind` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `usage_agent_time` ON `usage` (`agent_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `vault_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL
);
