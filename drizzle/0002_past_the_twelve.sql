CREATE TABLE `billing_events` (
	`stripe_event_id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`processed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_billing_events_processed` ON `billing_events` (`processed_at`);--> statement-breakpoint
CREATE TABLE `resume_generation_usage` (
	`user_id` text PRIMARY KEY NOT NULL,
	`free_generation_limit` integer DEFAULT 2 NOT NULL,
	`free_generations_used` integer DEFAULT 0 NOT NULL,
	`total_generations` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_resume_generation_usage_updated` ON `resume_generation_usage` (`updated_at`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`stripe_price_id` text,
	`status` text DEFAULT 'inactive' NOT NULL,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`current_period_end` text,
	`cancel_at` text,
	`canceled_at` text,
	`latest_invoice_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_subscriptions_stripe_customer` ON `subscriptions` (`stripe_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_subscriptions_stripe_subscription` ON `subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_status` ON `subscriptions` (`status`);--> statement-breakpoint
PRAGMA optimize;
