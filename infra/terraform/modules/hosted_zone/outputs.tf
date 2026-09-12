output "zone_id" {
  description = "Route 53 hosted zone ID."
  value       = aws_route53_zone.this.zone_id
}

output "name_servers" {
  description = "Authoritative name servers to configure at the domain registrar."
  value       = aws_route53_zone.this.name_servers
}

