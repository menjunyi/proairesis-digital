variable "project_name" {
  description = "Short project identifier used in resource names."
  type        = string
  default     = "proairesis-digital"
}

variable "environment" {
  description = "Deployment environment."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "site_hostname" {
  description = "Fully qualified hostname served by CloudFront."
  type        = string
}

variable "redirect_hostnames" {
  description = "Additional hostnames served by CloudFront and redirected permanently to site_hostname."
  type        = set(string)
  default     = []
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID from the shared stack."
  type        = string
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}

variable "enable_spa_fallback" {
  description = "Map 403/404 responses to index.html. Enable only for a static SPA build."
  type        = bool
  default     = false
}

variable "enable_clean_url_rewrites" {
  description = "Rewrite extensionless viewer paths such as /privacy to /privacy/index.html."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags applied to supported resources."
  type        = map(string)
  default     = {}
}

variable "booking_api_domain" {
  type    = string
  default = ""
}

variable "campaign_api_domain" {
  type    = string
  default = ""
}
