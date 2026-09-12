locals {
  tags = merge({
    Project     = "proairesis-digital"
    Environment = "shared"
    ManagedBy   = "terraform"
  }, var.additional_tags)
}

module "hosted_zone" {
  source = "../../modules/hosted_zone"

  zone_name = var.domain_name
  tags      = local.tags
}

module "provider_records" {
  source = "../../modules/dns_records"

  zone_id = module.hosted_zone.zone_id
  records = var.dns_records
}

resource "aws_ce_anomaly_monitor" "services" {
  name              = "Default-Services-Monitor"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
  tags              = local.tags
}

resource "aws_ce_anomaly_subscription" "daily" {
  count = length(var.cost_anomaly_alert_emails) == 0 ? 0 : 1

  name             = "proairesis-digital-daily-cost-anomalies"
  frequency        = "DAILY"
  monitor_arn_list = [aws_ce_anomaly_monitor.services.arn]
  tags             = local.tags

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = [tostring(var.cost_anomaly_threshold_usd)]
    }
  }

  dynamic "subscriber" {
    for_each = var.cost_anomaly_alert_emails
    content {
      type    = "EMAIL"
      address = subscriber.value
    }
  }
}
