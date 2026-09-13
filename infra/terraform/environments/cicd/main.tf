terraform {
  required_version = ">= 1.5.7"
  backend "s3" {}
  required_providers { aws = { source = "hashicorp/aws", version = "~> 6.0" } }
}
provider "aws" { region = "ap-southeast-2" }
variable "targets" {
  type = map(object({ bucket = string, distribution = string }))
  validation {
    condition     = alltrue([for k, v in var.targets : contains(["staging", "production"], k) && startswith(v.bucket, "proairesis-digital-${k}-site-")])
    error_message = "Targets must use the corresponding company environment."
  }
}
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}
resource "aws_iam_role" "deploy" {
  for_each             = var.targets
  name                 = "roleclue-github-${each.key}"
  max_session_duration = 3600
  assume_role_policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Federated = aws_iam_openid_connect_provider.github.arn }, Action = "sts:AssumeRoleWithWebIdentity", Condition = { StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com", "token.actions.githubusercontent.com:sub" = "repo:menjunyi/proairesis-digital:environment:${each.key}" } } }] })
}
resource "aws_iam_role_policy" "deploy" {
  for_each = var.targets
  role     = aws_iam_role.deploy[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:ListBucket", "s3:GetBucketLocation"], Resource = "arn:aws:s3:::${each.value.bucket}" },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "arn:aws:s3:::${each.value.bucket}/*" },
    { Effect = "Allow", Action = ["cloudfront:GetDistribution", "cloudfront:GetDistributionConfig", "cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"], Resource = "arn:aws:cloudfront::037169690315:distribution/${each.value.distribution}" },
    { Effect = "Allow", Action = ["lambda:UpdateFunctionCode", "lambda:GetFunctionConfiguration", "lambda:GetFunction"], Resource = "arn:aws:lambda:ap-southeast-2:037169690315:function:roleclue-${each.key}-booking" }
  ] })
}
output "roles" { value = { for name, role in aws_iam_role.deploy : name => role.arn } }
