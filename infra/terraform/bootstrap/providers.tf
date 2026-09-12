provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "proairesis-digital"
      ManagedBy = "terraform"
      Stack     = "state-bootstrap"
    }
  }
}

