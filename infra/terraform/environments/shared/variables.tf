variable "aws_region" {
  type    = string
  default = "ap-southeast-2"
}

variable "domain_name" {
  description = "Purchased registrable domain, without scheme or trailing dot."
  type        = string
}

variable "dns_records" {
  description = "Shared records supplied by verified providers, including Google Workspace and Search Console."
  type = map(object({
    name    = string
    type    = string
    ttl     = number
    records = list(string)
  }))
  default = {}
}

variable "cost_anomaly_alert_emails" {
  description = "Recipients for daily Cost Anomaly Detection alerts."
  type        = set(string)
  default     = []
}

variable "cost_anomaly_threshold_usd" {
  description = "Minimum absolute anomaly impact in USD before sending an alert."
  type        = number
  default     = 5
}

variable "additional_tags" {
  type    = map(string)
  default = {}
}
