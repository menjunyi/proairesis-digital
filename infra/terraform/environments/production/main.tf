locals {
  tags = merge({
    Project     = "proairesis-digital"
    Environment = "production"
    ManagedBy   = "terraform"
  }, var.additional_tags)
}

module "site" {
  source = "../../modules/static_site"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  booking_api_domain = module.booking.domain
  environment        = "production"
  site_hostname      = var.site_hostname
  redirect_hostnames = var.redirect_hostnames
  hosted_zone_id     = var.hosted_zone_id
  tags               = local.tags
}

module "budget" {
  source = "../../modules/budget"

  name              = "proairesis-digital-production"
  monthly_limit_usd = var.monthly_budget_usd
  alert_emails      = var.budget_alert_emails
  tags              = { Environment = "production" }
}

module "booking" {
  source           = "../../modules/booking"
  environment      = "production"
  site_origin      = "https://proairesis.digital"
  bridge_url       = "https://script.google.com/macros/s/AKfycbyFErae9Ip_PR1VjCAtayI0Z_lif8lZ1YexlbyjKLpaaOSX9miTnrQw8bFbo7MN_wjnlw/exec"
  secret_parameter = "/roleclue/production/booking/bridge-secret"
}
