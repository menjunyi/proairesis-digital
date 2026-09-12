variable "zone_name" {
  description = "Registrable domain name, without a trailing dot."
  type        = string

  validation {
    condition     = length(trimspace(var.zone_name)) > 3 && !startswith(var.zone_name, "http")
    error_message = "zone_name must be a domain name such as example.com, not a URL."
  }
}

variable "tags" {
  description = "Tags applied to the hosted zone."
  type        = map(string)
  default     = {}
}

