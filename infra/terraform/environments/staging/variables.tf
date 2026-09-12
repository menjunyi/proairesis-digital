variable "aws_region" {
  type    = string
  default = "ap-southeast-2"
}

variable "site_hostname" {
  description = "Staging hostname, normally staging.<domain>."
  type        = string
}

variable "hosted_zone_id" {
  description = "Hosted zone ID from the shared stack output."
  type        = string
}

variable "monthly_budget_usd" {
  type    = number
  default = 10
}

variable "budget_alert_emails" {
  description = "Recipients sourced from an ignored tfvars file populated securely from 1Password."
  type        = set(string)
  default     = []
}

variable "additional_tags" {
  type    = map(string)
  default = {}
}

