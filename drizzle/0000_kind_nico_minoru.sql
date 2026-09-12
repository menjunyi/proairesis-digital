CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` text,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text,
	`before_json` text,
	`after_json` text,
	`request_id` text NOT NULL,
	`outcome` text DEFAULT 'succeeded' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_audit_target` ON `audit_events` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_actor` ON `audit_events` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_action` ON `audit_events` (`action`,`created_at`);--> statement-breakpoint
CREATE TABLE `consultant_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_user_id` text NOT NULL,
	`consultant_user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`consent_scope` text NOT NULL,
	`consented_at` text NOT NULL,
	`assigned_by` text NOT NULL,
	`ended_at` text,
	`ended_by` text,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`candidate_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`consultant_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ended_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_assignments_candidate_status` ON `consultant_assignments` (`candidate_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_assignments_consultant_status` ON `consultant_assignments` (`consultant_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `consultant_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`speciality` text DEFAULT '' NOT NULL,
	`service_scope` text DEFAULT '' NOT NULL,
	`application_status` text DEFAULT 'draft' NOT NULL,
	`checks_completed` integer DEFAULT 0 NOT NULL,
	`checks_required` integer DEFAULT 5 NOT NULL,
	`submitted_at` text,
	`decided_at` text,
	`decided_by` text,
	`decision_reason` text,
	`internal_notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_consultants_application_status` ON `consultant_profiles` (`application_status`);--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_user_id` text,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`role` text DEFAULT 'registered_user' NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`email_verified_at` text,
	`onboarding_status` text DEFAULT 'not_started' NOT NULL,
	`last_active_at` text,
	`suspended_at` text,
	`suspended_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_auth_user_id` ON `users` (`auth_user_id`);--> statement-breakpoint
CREATE INDEX `idx_users_role_status` ON `users` (`role`,`status`);--> statement-breakpoint
CREATE INDEX `idx_users_created_at` ON `users` (`created_at`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`workflow_type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`error_code` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_workflow_runs_status_created` ON `workflow_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_workflow_runs_user_created` ON `workflow_runs` (`user_id`,`created_at`);--> statement-breakpoint
PRAGMA optimize;
