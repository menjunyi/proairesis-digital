output "hosted_zone_id" {
  value = module.hosted_zone.zone_id
}

output "name_servers" {
  description = "Configure these at the current domain registrar only after all existing DNS records are represented here."
  value       = module.hosted_zone.name_servers
}

output "provider_record_fqdns" {
  value = module.provider_records.record_fqdns
}

output "cost_anomaly_monitor_arn" {
  value = aws_ce_anomaly_monitor.services.arn
}
