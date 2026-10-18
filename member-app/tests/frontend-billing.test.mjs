import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { refreshBillingStatus } from "../src/api.js";
import { clearSession, startDemo } from "../src/auth.js";
import {
  billingCheckoutBody,
  billingPresentation,
  billingReturnKind,
  billingReturnOutcome,
  billingReturnPlan,
} from "../src/billing-state.js";

const free = {
  plan: "free", status: "none", subscriptionStatus: "none",
  hasSubscription: false, canManageBilling: false, cancelAtPeriodEnd: false,
  starterEverPaid: false, subscriptionEverPaid: false,
  used: 0, limit: 0, remaining: 0, reserved: 0, canGenerate: false, periodEnd: null,
};
const starter = {
  ...free, plan: "starter", status: "active", starterEverPaid: true,
  canManageBilling: true, used: 1, limit: 2, remaining: 1, canGenerate: true,
};
const paid = {
  ...free, plan: "monthly", status: "active", subscriptionStatus: "active",
  hasSubscription: true, canManageBilling: true, subscriptionEverPaid: true,
  used: 3, limit: 50, remaining: 47, canGenerate: true,
  periodEnd: "2026-11-12T00:00:00Z",
};
const commonJsModule = { exports: {} };
const compiled = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/App.jsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
}).outputFiles[0].text;
// oxlint-disable-next-line typescript/no-implied-eval -- Executes local esbuild output in this test harness.
new Function("require", "module", "exports", compiled)(
  createRequire(import.meta.url), commonJsModule, commonJsModule.exports,
);
const { AccountScreen, UpgradeDialog } = commonJsModule.exports;
const account = (billing, enabled = true) => renderToStaticMarkup(
  React.createElement(AccountScreen, {
    config: { mode: "production", capabilities: { billing: true } },
    me: {
      profile: { name: "Synthetic QA", email: "qa@example.invalid" },
      billing, capabilities: { billing: enabled, coverLetters: true },
    },
  }),
);
const upgrade = (billing) => renderToStaticMarkup(
  React.createElement(UpgradeDialog, { billing, onClose() {} }),
);

test("checkout and Portal return URLs trigger verification without granting allowance", () => {
  assert.equal(billingReturnKind("?checkout=success"), "success");
  assert.equal(billingReturnKind("?checkout=cancelled"), "cancelled");
  assert.equal(billingReturnKind("?billing=return"), "portal");
  assert.equal(billingReturnKind("?checkout=active&plan=monthly"), null);
  assert.equal(billingReturnPlan("?checkout=success&plan=starter"), "starter");
  assert.equal(billingReturnPlan("?checkout=success&plan=monthly"), "monthly");
  assert.equal(billingReturnPlan("?checkout=success&plan=unknown"), null);
  assert.equal(billingReturnOutcome("success", free), "waiting");
  assert.equal(billingReturnOutcome("success", undefined), "waiting");
  assert.equal(billingReturnOutcome("success", starter), "waiting");
  assert.equal(billingReturnOutcome("success", paid), "waiting");
  assert.equal(billingReturnOutcome("success", starter, "starter"), "verified");
  assert.equal(billingReturnOutcome("success", {...starter, remaining: 0, canGenerate: false}, "starter"), "waiting");
  assert.equal(billingReturnOutcome("success", {...starter, status: "refunded", plan: "free"}, "starter"), "waiting");
  assert.equal(billingReturnOutcome("success", starter, "monthly"), "waiting");
  assert.equal(billingReturnOutcome("success", paid, "monthly"), "verified");
  assert.equal(billingReturnOutcome("cancelled", free), "cancelled");
  assert.equal(billingReturnOutcome("portal", free), "refreshed");
  assert.deepEqual(billingCheckoutBody("starter"), { plan: "starter", termsAccepted: true });
  assert.deepEqual(billingCheckoutBody("monthly"), { plan: "monthly", termsAccepted: true });
  assert.throws(() => billingCheckoutBody("free"), /valid cover-letter plan/);
});

test("account renders active allowance and a scheduled cancellation without promising renewal", () => {
  const billing = { ...paid, cancelAtPeriodEnd: true };
  const view = billingPresentation(billing, () => "12 Nov 2026");
  assert.equal(view.periodLabel, "Paid access ends 12 Nov 2026");
  assert.match(view.message, /remaining paid allowance.*12 Nov 2026.*will not renew/);
  assert.equal(view.canSubscribe, false);
  const html = account(billing);
  assert.match(html, /47 available/);
  assert.match(html, /Paid access ends/);
  assert.match(html, /Manage subscription/);
  assert.match(html, /Refresh billing status/);
  assert.doesNotMatch(html, /Next period|View cover-letter plans|It resets/);
  const exhaustedHtml = upgrade({ ...billing, used: 50, remaining: 0, canGenerate: false });
  assert.match(exhaustedHtml, /Cancellation is scheduled/);
  assert.doesNotMatch(exhaustedHtml, /Continue to Stripe|It resets|new allowance starts/);
});

test("refunded ongoing subscriptions remain manageable and cannot start duplicate checkout", () => {
  const billing = { ...free, status: "refunded", subscriptionStatus: "active", hasSubscription: true, canManageBilling: true };
  const html = account(billing);
  assert.match(html, /Stripe subscription is still open/);
  assert.match(html, /Manage subscription/);
  assert.match(html, /Subscription: Active/);
  assert.doesNotMatch(html, /View cover-letter plans|No card needed/);
  const dialog = upgrade(billing);
  assert.match(dialog, /Manage subscription/);
  assert.doesNotMatch(dialog, /Continue to Stripe|I understand the/);
});

test("unpaid confirmation does not display an active paid allowance", () => {
  const billing = { ...free, status: "payment_pending", subscriptionStatus: "active", hasSubscription: true, canManageBilling: true };
  const html = account(billing);
  assert.match(html, /payment has not been confirmed/);
  assert.match(html, /No cover-letter credits are active/);
  assert.doesNotMatch(html, /50 successful|View cover-letter plans/);
  assert.equal(billingReturnOutcome("success", billing), "waiting");
});

test("ended subscribers can restart or access Stripe records while active subscribers only manage", () => {
  const ended = account({ ...free, status: "canceled", subscriptionStatus: "canceled", canManageBilling: true });
  assert.match(ended, /View cover-letter plans/);
  assert.match(ended, /View billing history/);
  const dialog = upgrade(paid);
  assert.match(dialog, /47 generations available/);
  assert.match(dialog, /Manage subscription/);
  assert.doesNotMatch(dialog, /Continue to Stripe/);
});

test("runtime billing false suppresses checkout, Portal and refresh controls", () => {
  for (const billing of [free, paid]) {
    const html = account(billing, false);
    assert.match(html, /Paid generation plans are currently unavailable/);
    assert.doesNotMatch(html, /View cover-letter plans|Manage subscription|Refresh billing status/);
  }
  const dialog = upgrade(free);
  assert.match(dialog, /A\$1/);
  assert.match(dialog, /2 successful cover letters/);
  assert.match(dialog, /A\$20/);
  assert.match(dialog, /50 successful cover letters each month/);
  assert.match(dialog, /There is no free generation trial/);
  assert.match(dialog, /disabled=""[^>]*>Buy Starter for A\$1/);
});

test("Starter is a one-time option and prior Starter or Plus payment removes it", () => {
  const freePlan = billingPresentation(free, () => "Not available");
  assert.equal(freePlan.canBuyStarter, true);
  assert.match(upgrade(free), /Buy Starter for A\$1/);

  const starterPlan = billingPresentation(starter, () => "Not available");
  assert.equal(starterPlan.canBuyStarter, false);
  const starterHtml = upgrade(starter);
  assert.match(starterHtml, /Starter purchased/);
  assert.match(starterHtml, /Subscribe for A\$20 per month/);
  assert.doesNotMatch(starterHtml, /Buy Starter for A\$1/);

  const formerSubscriber = { ...free, subscriptionEverPaid: true };
  assert.equal(billingPresentation(formerSubscriber, () => "Not available").canBuyStarter, false);
  const formerSubscriberHtml = upgrade(formerSubscriber);
  assert.match(formerSubscriberHtml, /Starter is unavailable/);
  assert.doesNotMatch(formerSubscriberHtml, /Buy Starter for A\$1/);
});

test("billing refresh only publishes a verified response for the current signed-in view", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const storage = new Map();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
  });
  try {
    await t.test("success uses POST refresh and preserves returned cancellation fields", async () => {
      startDemo({ mode: "demo" });
      let current = free;
      const billing = { ...paid, cancelAtPeriodEnd: true };
      const result = await refreshBillingStatus(async (path, options) => {
        assert.equal(path, "/billing/refresh");
        assert.equal(options.method, "POST");
        return { billing };
      }, { onBilling(value) { current = value; } });
      assert.equal(result, billing);
      assert.equal(current.cancelAtPeriodEnd, true);
    });
    await t.test("missing billing and backend errors never replace prior allowance", async () => {
      startDemo({ mode: "demo" });
      let writes = 0;
      await assert.rejects(refreshBillingStatus(async () => ({}), { onBilling() { writes++; } }), /could not be verified/);
      const error = Object.assign(new Error("Wait before checking again."), { code: "BILLING_REFRESH_LIMIT", status: 429 });
      await assert.rejects(refreshBillingStatus(async () => { throw error; }, { onBilling() { writes++; } }), { code: "BILLING_REFRESH_LIMIT" });
      assert.equal(writes, 0);
    });
    await t.test("sign-out during refresh prevents stale entitlement changes", async () => {
      startDemo({ mode: "demo" });
      let writes = 0;
      await assert.rejects(refreshBillingStatus(async () => {
        clearSession();
        return { billing: paid };
      }, { onBilling() { writes++; } }), { code: "SESSION_CHANGED" });
      assert.equal(writes, 0);
    });
    await t.test("leaving the view during refresh prevents stale entitlement changes", async () => {
      startDemo({ mode: "demo" });
      let active = true, writes = 0;
      await assert.rejects(refreshBillingStatus(async () => {
        active = false;
        return { billing: paid };
      }, { assertCurrent() { if (!active) throw new Error("View closed"); }, onBilling() { writes++; } }), /View closed/);
      assert.equal(writes, 0);
    });
  } finally {
    clearSession();
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else delete globalThis.sessionStorage;
  }
});
