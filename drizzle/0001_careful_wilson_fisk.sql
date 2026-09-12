CREATE TABLE `crm_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_user_id` text NOT NULL,
	`actor_user_id` text,
	`activity_type` text NOT NULL,
	`summary` text NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`contact_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_crm_activities_contact` ON `crm_activities` (`contact_user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_activities_occurred` ON `crm_activities` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `crm_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`stage` text DEFAULT 'lead' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`owner_user_id` text,
	`source` text DEFAULT 'Pip' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`next_follow_up_at` text,
	`last_contacted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_crm_profiles_stage` ON `crm_profiles` (`stage`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_profiles_follow_up` ON `crm_profiles` (`next_follow_up_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_profiles_owner` ON `crm_profiles` (`owner_user_id`,`stage`);--> statement-breakpoint
CREATE TABLE `crm_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_user_id` text NOT NULL,
	`assigned_to` text,
	`title` text NOT NULL,
	`due_at` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`contact_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_crm_tasks_status_due` ON `crm_tasks` (`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_tasks_contact` ON `crm_tasks` (`contact_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_tasks_assignee` ON `crm_tasks` (`assigned_to`,`status`);--> statement-breakpoint
PRAGMA optimize;
