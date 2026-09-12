variable "aws_region" {
  type    = string
  default = "ap-southeast-2"
}

variable "site_hostname" {
  description = "Production hostname, normally the apex domain."
  type        = string
}

variable "redirect_hostnames" {
  description = "Additional production hostnames redirected to site_hostname."
  type        = set(string)
  default     = []
}

variable "hosted_zone_id" {
  description = "Hosted zone ID from the shared stack output."
  type        = string
}

variable "monthly_budget_usd" {
  type    = number
  default = 25
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
