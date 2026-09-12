CREATE TABLE `commission_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_user_id` text,
	`source_type` text NOT NULL,
	`source_detail` text DEFAULT '' NOT NULL,
	`lead_staff_id` text,
	`sales_staff_id` text,
	`gross_amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'AUD' NOT NULL,
	`pool_rate_bps` integer NOT NULL,
	`lead_share_bps` integer NOT NULL,
	`sales_share_bps` integer NOT NULL,
	`commission_pool_cents` integer NOT NULL,
	`lead_commission_cents` integer NOT NULL,
	`sales_commission_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`converted_at` text NOT NULL,
	`eligible_at` text NOT NULL,
	`approved_at` text,
	`paid_at` text,
	`reversed_at` text,
	`stripe_invoice_id` text,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`contact_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lead_staff_id`) REFERENCES `commission_staff`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sales_staff_id`) REFERENCES `commission_staff`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commission_entries_invoice` ON `commission_entries` (`stripe_invoice_id`);--> statement-breakpoint
CREATE INDEX `idx_commission_entries_status_eligible` ON `commission_entries` (`status`,`eligible_at`);--> statement-breakpoint
CREATE INDEX `idx_commission_entries_contact` ON `commission_entries` (`contact_user_id`,`converted_at`);--> statement-breakpoint
CREATE INDEX `idx_commission_entries_lead_staff` ON `commission_entries` (`lead_staff_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_commission_entries_sales_staff` ON `commission_entries` (`sales_staff_id`,`status`);--> statement-breakpoint
CREATE TABLE `commission_rules` (
	`source_type` text PRIMARY KEY NOT NULL,
	`pool_rate_bps` integer NOT NULL,
	`lead_share_bps` integer NOT NULL,
	`sales_share_bps` integer NOT NULL,
	`hold_days` integer DEFAULT 7 NOT NULL,
	`updated_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_commission_rules_updated` ON `commission_rules` (`updated_at`);--> statement-breakpoint
CREATE TABLE `commission_staff` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`team` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commission_staff_email` ON `commission_staff` (`email`);--> statement-breakpoint
CREATE INDEX `idx_commission_staff_team_status` ON `commission_staff` (`team`,`status`);
--> statement-breakpoint
PRAGMA optimize;
