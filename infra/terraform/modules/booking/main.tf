variable "environment" { type = string }
variable "site_origin" { type = string }
variable "bridge_url" { type = string }
variable "secret_parameter" { type = string }
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "archive_file" "handler" {
  type        = "zip"
  source_file = "${path.module}/../../../../scripts/release/booking-handler.mjs"
  output_path = "${path.root}/.terraform/booking-handler.zip"
}
resource "aws_iam_role" "booking" {
  name               = "roleclue-${var.environment}-booking"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_cloudwatch_log_group" "booking" {
  name              = "/aws/lambda/roleclue-${var.environment}-booking"
  retention_in_days = 14
}
resource "aws_iam_role_policy" "booking" {
  role   = aws_iam_role.booking.id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([{ Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.booking.arn}:*" }], var.environment == "production" ? [{ Effect = "Allow", Action = ["ssm:GetParameter"], Resource = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${var.secret_parameter}" }] : []) })
}
resource "aws_lambda_function" "booking" {
  function_name    = "roleclue-${var.environment}-booking"
  role             = aws_iam_role.booking.arn
  filename         = data.archive_file.handler.output_path
  source_code_hash = data.archive_file.handler.output_base64sha256
  handler          = "booking-handler.handler"
  runtime          = "nodejs22.x"
  timeout          = 29
  memory_size      = 128
  environment { variables = { DEPLOYMENT_ENV = var.environment, SITE_ORIGIN = var.site_origin, BOOKING_BRIDGE_URL = var.bridge_url, BOOKING_SECRET_PARAMETER = var.secret_parameter, OPINION_TABLE = aws_dynamodb_table.opinions.name } }
  depends_on = [aws_iam_role_policy.booking]
  # GitHub promotes tested handler artifacts after Terraform bootstraps the function.
  lifecycle { ignore_changes = [filename, source_code_hash] }
}
resource "aws_apigatewayv2_api" "booking" {
  name          = "roleclue-${var.environment}-booking"
  protocol_type = "HTTP"
}
resource "aws_apigatewayv2_integration" "booking" {
  api_id                 = aws_apigatewayv2_api.booking.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.booking.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "booking" {
  for_each  = toset(["GET /api/booking/availability", "POST /api/booking/confirm", "POST /api/booking/message"])
  api_id    = aws_apigatewayv2_api.booking.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.booking.id}"
}
resource "aws_apigatewayv2_stage" "booking" {

  api_id      = aws_apigatewayv2_api.booking.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 2
  }
}
resource "aws_lambda_permission" "gateway" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.booking.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.booking.execution_arn}/*/*"
}
output "domain" { value = replace(aws_apigatewayv2_api.booking.api_endpoint, "https://", "") }
output "function_name" { value = aws_lambda_function.booking.function_name }

resource "aws_dynamodb_table" "opinions" {
  name         = "roleclue-${var.environment}-opinion-requests"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}
resource "aws_iam_role_policy" "opinion_email" {
  count = var.environment == "production" ? 1 : 0
  role  = aws_iam_role.booking.id
  name  = "opinion-email"
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ses:SendEmail"], Resource = "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:identity/hello@proairesis.digital", Condition = { StringEquals = { "ses:FromAddress" = "hello@proairesis.digital" }, "ForAllValues:StringEquals" = { "ses:Recipients" = ["hello@proairesis.digital"] } } },
    { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"], Resource = aws_dynamodb_table.opinions.arn }
  ] })
}
