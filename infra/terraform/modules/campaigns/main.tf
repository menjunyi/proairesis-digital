variable "environment" { type = string }
variable "site_origin" { type = string }
data "archive_file" "handler" {
  type        = "zip"
  source_file = "${path.module}/../../../../scripts/release/campaign-handler.mjs"
  output_path = "${path.root}/.terraform/campaign-handler.zip"
}
resource "aws_dynamodb_table" "campaigns" {
  name         = "roleclue-${var.environment}-campaigns"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  ttl {
    attribute_name = "expires"
    enabled        = true
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled = true
  }
}
resource "aws_iam_role" "campaigns" {
  name               = "roleclue-${var.environment}-campaigns"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_cloudwatch_log_group" "campaigns" {
  name              = "/aws/lambda/roleclue-${var.environment}-campaigns"
  retention_in_days = 14
}
resource "aws_iam_role_policy" "campaigns" {
  role = aws_iam_role.campaigns.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.campaigns.arn}:*" },
    { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"], Resource = aws_dynamodb_table.campaigns.arn }
  ] })
}
resource "aws_lambda_function" "campaigns" {
  function_name    = "roleclue-${var.environment}-campaigns"
  role             = aws_iam_role.campaigns.arn
  filename         = data.archive_file.handler.output_path
  source_code_hash = data.archive_file.handler.output_base64sha256
  handler          = "campaign-handler.handler"
  runtime          = "nodejs22.x"
  timeout          = 29
  memory_size      = 256
  environment { variables = { SITE_ORIGIN = var.site_origin, CAMPAIGN_TABLE = aws_dynamodb_table.campaigns.name } }
  depends_on = [aws_iam_role_policy.campaigns]
  lifecycle { ignore_changes = [filename, source_code_hash] }
}
resource "aws_apigatewayv2_api" "campaigns" {
  name          = "roleclue-${var.environment}-campaigns"
  protocol_type = "HTTP"
}
resource "aws_apigatewayv2_integration" "campaigns" {
  api_id                 = aws_apigatewayv2_api.campaigns.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.campaigns.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "campaigns" {
  for_each  = toset(["GET /r/{slug}", "POST /api/campaigns/visit"])
  api_id    = aws_apigatewayv2_api.campaigns.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.campaigns.id}"
}
resource "aws_apigatewayv2_stage" "campaigns" {
  api_id      = aws_apigatewayv2_api.campaigns.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }
}
resource "aws_lambda_permission" "gateway" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.campaigns.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.campaigns.execution_arn}/*/*"
}
output "domain" { value = replace(aws_apigatewayv2_api.campaigns.api_endpoint, "https://", "") }
output "function_name" { value = aws_lambda_function.campaigns.function_name }
