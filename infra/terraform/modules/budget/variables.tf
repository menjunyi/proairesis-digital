variable "name" {
  description = "Unique budget name."
  type        = string
}

variable "monthly_limit_usd" {
  description = "Monthly cost ceiling in USD."
  type        = number

  validation {
    condition     = var.monthly_limit_usd > 0
    error_message = "monthly_limit_usd must be greater than zero."
  }
}

variable "alert_emails" {
  description = "Email recipients for forecast and actual-spend alerts. Keep real values in an ignored tfvars file sourced from 1Password."
  type        = set(string)
  default     = []
}

variable "tags" {
  description = "Cost allocation tags used to constrain the budget."
  type        = map(string)
  default     = {}
}

