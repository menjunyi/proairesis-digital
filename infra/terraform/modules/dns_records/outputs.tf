output "record_fqdns" {
  description = "Created record names keyed by caller-defined identifiers."
  value       = { for key, record in aws_route53_record.this : key => record.fqdn }
}

