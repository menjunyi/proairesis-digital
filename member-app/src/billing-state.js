export function billingReturnKind(search) {
  const query = new URLSearchParams(search);
  const checkout = query.get("checkout");
  if (["success", "cancelled"].includes(checkout)) return checkout;
  return query.get("billing") === "return" ? "portal" : null;
}

export function billingReturnPlan(search) {
  const plan = new URLSearchParams(search).get("plan");
  return ["starter", "monthly"].includes(plan) ? plan : null;
}

export function billingPresentation(billing, formatDate) {
  const paid = billing?.plan === "monthly";
  const starter = billing?.plan === "starter";
  const hasSubscription = billing?.hasSubscription === true;
  const cancelAtPeriodEnd = billing?.cancelAtPeriodEnd === true;
  const starterPurchased =
    starter ||
    billing?.starterPurchased === true ||
    billing?.starterEverPaid === true ||
    billing?.starterEligible === false;
  const subscriptionPurchased = billing?.subscriptionEverPaid === true;
  const canBuyStarter =
    !paid &&
    !hasSubscription &&
    !starterPurchased &&
    !subscriptionPurchased &&
    billing?.canPurchaseStarter !== false &&
    billing?.canBuyStarter !== false;
  let message = "";
  if (paid && cancelAtPeriodEnd) {
    message = `Cancellation is scheduled. Your remaining paid allowance is available until ${formatDate(billing.periodEnd)}. It will not renew.`;
  } else if (billing?.status === "refunded") {
    message = hasSubscription
      ? "The refunded period's paid allowance is unavailable. Your Stripe subscription is still open; manage it to review future payments or cancel."
      : "The refunded period's paid allowance is unavailable. Your saved drafts remain available.";
  } else if (billing?.status === "payment_pending") {
    message = hasSubscription
      ? "Your subscription exists, but payment has not been confirmed. The paid allowance will appear after payment is verified. Refresh the status or review payment in Stripe."
      : "Your payment has not been confirmed. Starter credits will appear after payment is verified. Refresh the status or review the payment in Stripe.";
  } else if (hasSubscription && !paid) {
    message = "Your subscription needs attention before a paid allowance is available. Review its payment status in Stripe. Your saved drafts remain available.";
  }
  return {
    paid,
    starter,
    hasSubscription,
    canSubscribe: !hasSubscription && !paid,
    canBuyStarter,
    canManageBilling: billing?.canManageBilling === true,
    periodLabel: paid && billing.periodEnd
      ? `${cancelAtPeriodEnd ? "Paid access ends" : "Current period ends"} ${formatDate(billing.periodEnd)}`
      : starter
        ? "One-time Starter credits"
        : "No generation credits",
    message,
  };
}

export function billingReturnOutcome(kind, billing, expectedPlan = null) {
  if (kind === "success") {
    if (expectedPlan === "starter") {
      return billing?.plan === "starter" &&
        billing?.status === "active" &&
        billing?.canGenerate === true &&
        Number(billing?.remaining) > 0
        ? "verified"
        : "waiting";
    }
    if (expectedPlan === "monthly") {
      return billing?.plan === "monthly" && billing?.status === "active"
        ? "verified"
        : "waiting";
    }
    return "waiting";
  }
  return kind === "cancelled" ? "cancelled" : "refreshed";
}

export function billingCheckoutBody(plan) {
  if (!["starter", "monthly"].includes(plan)) {
    throw new Error("Choose a valid cover-letter plan.");
  }
  return { plan, termsAccepted: true };
}
