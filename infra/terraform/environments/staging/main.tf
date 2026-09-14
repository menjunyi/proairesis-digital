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

  campaign_api_domain = module.campaigns.domain
  booking_api_domain  = module.booking.domain
  environment         = "staging"
  site_hostname       = var.site_hostname
  hosted_zone_id      = var.hosted_zone_id
  tags                = local.tags
}

module "budget" {
  source = "../../modules/budget"

  name              = "proairesis-digital-staging"
  monthly_limit_usd = var.monthly_budget_usd
  alert_emails      = var.budget_alert_emails
  tags              = { Environment = "staging" }
}


module "booking" {
  source           = "../../modules/booking"
  environment      = "staging"
  site_origin      = "https://staging.proairesis.digital"
  bridge_url       = "https://script.google.com/macros/s/AKfycbyFErae9Ip_PR1VjCAtayI0Z_lif8lZ1YexlbyjKLpaaOSX9miTnrQw8bFbo7MN_wjnlw/exec"
  secret_parameter = "/roleclue/staging/booking/bridge-secret"
}

module "campaigns" {
  source      = "../../modules/campaigns"
  environment = "staging"
  site_origin = "https://staging.proairesis.digital"
}
