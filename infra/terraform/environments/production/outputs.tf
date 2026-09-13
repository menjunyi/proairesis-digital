output "site_url" {
  value = module.site.site_url
}

output "site_bucket_name" {
  value = module.site.bucket_name
}

output "cloudfront_distribution_id" {
  value = module.site.cloudfront_distribution_id
}

output "cloudfront_domain_name" {
  value = module.site.cloudfront_domain_name
}

output "certificate_arn" {
  value = module.site.certificate_arn
}

output "budget_name" {
  value = module.budget.budget_name
}


output "booking_function" { value = module.booking.function_name }
