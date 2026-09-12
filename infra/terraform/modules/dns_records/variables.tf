variable "zone_id" {
  description = "Route 53 hosted zone ID."
  type        = string
}

variable "records" {
  description = "Non-alias DNS records, such as Google Workspace MX/TXT and Search Console verification."
  type = map(object({
    name    = string
    type    = string
    ttl     = number
    records = list(string)
  }))
  default = {}
}

