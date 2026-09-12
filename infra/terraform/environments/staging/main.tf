locals {
  tags = merge({
    Project     = "proairesis-digital"
    Environment = "staging"
    ManagedBy   = "terraform"
  }, var.additional_tags)
}

module "site" {
  source = "../../modules/static_site"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  environment    = "staging"
  site_hostname  = var.site_hostname
  hosted_zone_id = var.hosted_zone_id
  tags           = local.tags
}

module "budget" {
  source = "../../modules/budget"

  name              = "proairesis-digital-staging"
  monthly_limit_usd = var.monthly_budget_usd
  alert_emails      = var.budget_alert_emails
  tags              = { Environment = "staging" }
}

