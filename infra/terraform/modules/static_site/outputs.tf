output "bucket_name" {
  description = "Private S3 bucket that receives the static build artifact."
  value       = aws_s3_bucket.site.id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID for cache invalidations."
  value       = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain_name" {
  description = "CloudFront-generated domain name."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "site_url" {
  description = "Public HTTPS site URL."
  value       = "https://${var.site_hostname}"
}

output "certificate_arn" {
  description = "Validated ACM certificate ARN in us-east-1."
  value       = aws_acm_certificate_validation.site.certificate_arn
}
