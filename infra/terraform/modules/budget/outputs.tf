output "budget_name" {
  description = "AWS budget name."
  value       = aws_budgets_budget.this.name
}

