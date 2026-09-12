variable "aws_region" {
  description = "Region for Terraform state resources."
  type        = string
  default     = "ap-southeast-2"
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name for Terraform state."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "state_bucket_name must be a valid globally unique S3 bucket name."
  }
}

variable "lock_table_name" {
  description = "DynamoDB table name for state locking and compatibility with existing automation."
  type        = string
  default     = "proairesis-digital-terraform-locks"
}

