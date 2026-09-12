CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`name` text NOT NULL,
	`codex_thread_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`last_heartbeat_at` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `work_tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_status` ON `agent_sessions` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_task` ON `agent_sessions` (`task_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_sessions_codex_thread` ON `agent_sessions` (`codex_thread_id`);--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	`requirement` text DEFAULT 'complete' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `work_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_task_id`) REFERENCES `work_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_dependencies_unique` ON `task_dependencies` (`task_id`,`depends_on_task_id`);--> statement-breakpoint
CREATE INDEX `idx_task_dependencies_prerequisite` ON `task_dependencies` (`depends_on_task_id`);--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_key` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`actor_user_id` text,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_events_workflow_event` ON `task_events` (`workflow_key`,`event_type`);--> statement-breakpoint
CREATE INDEX `idx_task_events_occurred` ON `task_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `work_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`context_type` text NOT NULL,
	`context_name` text NOT NULL,
	`parent_id` text,
	`workflow_key` text,
	`workflow_type` text,
	`status` text DEFAULT 'inbox' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`executor_type` text DEFAULT 'human' NOT NULL,
	`accountable_user_id` text,
	`waiting_reason` text,
	`activation_event` text,
	`condition_text` text,
	`source_label` text,
	`source_path` text,
	`start_at` text,
	`due_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`accountable_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_work_tasks_status_due` ON `work_tasks` (`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_work_tasks_context` ON `work_tasks` (`context_type`,`context_name`);--> statement-breakpoint
CREATE INDEX `idx_work_tasks_parent` ON `work_tasks` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_work_tasks_workflow` ON `work_tasks` (`workflow_key`,`status`);--> statement-breakpoint
CREATE INDEX `idx_work_tasks_executor` ON `work_tasks` (`executor_type`,`status`);