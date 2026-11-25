CREATE TABLE `admission_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`role` text NOT NULL,
	`branch_id` text,
	`course_key` text NOT NULL,
	`min_score_percent` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `admission_rules_company_idx` ON `admission_rules` (`company_id`);--> statement-breakpoint
CREATE TABLE `course_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`course_id` text NOT NULL,
	`scope` text NOT NULL,
	`branch_id` text,
	`user_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `course_assignments_company_idx` ON `course_assignments` (`company_id`,`course_id`);--> statement-breakpoint
CREATE TABLE `course_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`course_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`content` text NOT NULL,
	`checksum` text NOT NULL,
	`external_ref` text,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_versions_course_version_unique` ON `course_versions` (`course_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `course_versions_course_ref_unique` ON `course_versions` (`course_id`,`external_ref`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_company_key_unique` ON `courses` (`company_id`,`key`);--> statement-breakpoint
CREATE TABLE `lesson_progress` (
	`user_id` text NOT NULL,
	`course_id` text NOT NULL,
	`lesson_key` text NOT NULL,
	`course_version_id` text NOT NULL,
	`completed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `course_id`, `lesson_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_version_id`) REFERENCES `course_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `test_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`branch_id` text,
	`course_id` text NOT NULL,
	`course_version_id` text NOT NULL,
	`status` text NOT NULL,
	`answers` text DEFAULT '{}' NOT NULL,
	`started_at` integer NOT NULL,
	`submitted_at` integer,
	`correct_count` integer,
	`total_count` integer,
	`score_percent` integer,
	`min_score_percent` integer,
	`passed` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_version_id`) REFERENCES `course_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_attempts_one_open_unique` ON `test_attempts` (`user_id`,`course_id`) WHERE status = 'in_progress';--> statement-breakpoint
CREATE INDEX `test_attempts_company_branch_idx` ON `test_attempts` (`company_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `test_attempts_user_course_idx` ON `test_attempts` (`user_id`,`course_id`);--> statement-breakpoint
CREATE TABLE `training_files` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`course_id` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `training_files_object_key_unique` ON `training_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `training_files_course_idx` ON `training_files` (`course_id`);