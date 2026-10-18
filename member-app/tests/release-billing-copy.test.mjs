import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productionConfig } from '../scripts/prepare-release.mjs';

const read = name => readFileSync(new URL(`../public/${name}.html`, import.meta.url), 'utf8');
const text = html => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const terms = text(read('terms'));
const privacy = text(read('privacy'));
const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const contract = JSON.parse(readFileSync(new URL('../contract.json', import.meta.url), 'utf8'));
const environment = { ROLECLUE_COGNITO_CLIENT_ID: 'syntheticclient12345' };

test('production billing and AI capabilities remain opt-in, with an accurate disabled notice', () => {
  const config = productionConfig(environment);
  assert.equal(config.mode, 'production');
  assert.deepEqual(config.capabilities, { jobImport: true, recommendations: false, guestDiscovery: false, coverLetters: false, billing: false });
  assert.match(config.betaNotice, /Paid subscriptions are not currently available/);
  assert.match(config.betaNotice, /Automatic job discovery is not included/);
  assert.equal(productionConfig({ ...environment, ROLECLUE_BILLING_ENABLED: 'TRUE' }).capabilities.billing, false);
  assert.equal(productionConfig({ ...environment, ROLECLUE_BILLING_ENABLED: true }).capabilities.billing, false);
  assert.throws(() => productionConfig({}), /Cognito client ID/);
});

test('enabled billing does not ship a paid-coming-later notice or enable discovery', () => {
  const config = productionConfig({ ...environment, ROLECLUE_BILLING_ENABLED: 'true' });
  assert.equal(config.capabilities.billing, true);
  assert.equal(config.capabilities.recommendations, false);
  assert.equal(config.capabilities.guestDiscovery, false);
  assert.match(config.betaNotice, /Automatic job discovery is not included/);
  assert.doesNotMatch(config.betaNotice, /subscriptions.*(?:later|unavailable|not currently available)/);
  const all = productionConfig({ ...environment, ROLECLUE_BILLING_ENABLED: 'true', ROLECLUE_RECOMMENDATIONS_ENABLED: 'true', ROLECLUE_GUEST_DISCOVERY_ENABLED: 'true' });
  assert.equal(all.capabilities.guestDiscovery, true);
  assert.doesNotMatch(all.betaNotice, /not included|not currently available/);
});

test('guest discovery is independently opt-in and never enables from truthy variants', () => {
  assert.equal(productionConfig({ ...environment, ROLECLUE_RECOMMENDATIONS_ENABLED: 'true' }).capabilities.guestDiscovery, false);
  assert.equal(productionConfig({ ...environment, ROLECLUE_GUEST_DISCOVERY_ENABLED: 'TRUE' }).capabilities.guestDiscovery, false);
  assert.equal(productionConfig({ ...environment, ROLECLUE_GUEST_DISCOVERY_ENABLED: true }).capabilities.guestDiscovery, false);
  assert.equal(productionConfig({ ...environment, ROLECLUE_GUEST_DISCOVERY_ENABLED: 'true' }).capabilities.guestDiscovery, true);
});

test('Google sign-in requires an HTTPS hosted domain and callback, while email stays available by default', () => {
  const defaultConfig = productionConfig(environment);
  assert.equal(defaultConfig.googleSignInEnabled, false);
  assert.equal(defaultConfig.cognitoDomain, '');
  assert.throws(
    () => productionConfig({...environment, ROLECLUE_GOOGLE_SIGN_IN_ENABLED: 'true'}),
    /hosted UI domain/,
  );
  const enabled = productionConfig({
    ...environment,
    ROLECLUE_GOOGLE_SIGN_IN_ENABLED: 'true',
    ROLECLUE_COGNITO_DOMAIN: 'https://roleclue.example.auth.ap-southeast-2.amazoncognito.com',
    ROLECLUE_OAUTH_REDIRECT_URI: 'https://app.proairesis.digital/',
  });
  assert.equal(enabled.googleSignInEnabled, true);
});

test('member terms describe the one-time Starter purchase and the 50-letter monthly plan', () => {
  assert.match(terms, /Version roleclue-v1-2026-10-12-starter-50/);
  assert.match(terms, /ABN 71 151 568 558/);
  assert.match(terms, /Starter costs A\$1 total/);
  assert.match(terms, /two successful cover-letter generations/);
  assert.match(terms, /one-time purchase, not a subscription/);
  assert.match(terms, /limited to one successful purchase per account/);
  assert.match(terms, /Starter generations do not expire/);
  assert.match(terms, /costs A\$20 total per month/);
  assert.match(terms, /not registered for GST, so no GST is charged/);
  assert.match(terms, /We do not add a payment-processing surcharge/);
  assert.match(terms, /free workspace does not include cover-letter generations/);
  assert.match(terms, /There is no free generation trial/);
  assert.match(terms, /50 successful cover-letter generations/);
  assert.match(terms, /unused monthly generations do not roll over/);
  assert.match(terms, /subscription renews monthly at A\$20 until cancelled/);
  assert.match(terms, /If checkout is unavailable, you cannot start a paid plan/);
  assert.match(terms, /unused Starter generations remain attached to the account while Plus is active/);
  assert.doesNotMatch(terms, /Payments are disabled|No current subscription|not an active paid service/);
  assert.doesNotMatch(terms, /lifetime free cover-letter|40 successful cover-letter/);
});

test('every payment retains the full 168-hour no-reason refund promise and consumer rights', () => {
  assert.match(terms, /Every Starter purchase and every Plus payment, including each monthly renewal, has a full, no-reason refund period of seven days \(168 hours\) from successful payment/);
  assert.match(terms, /removes unused Starter generations for a refunded Starter purchase/);
  assert.match(terms, /Saved drafts remain available/);
  assert.match(terms, /A refund does not reset that eligibility/);
  assert.match(terms, /You do not need to give a reason/);
  assert.match(terms, /does not limit remedies available after seven days/);
  assert.match(terms, /support@proairesis.digital/);
  assert.match(read('terms'), /https:\/\/www\.accc\.gov\.au\/consumers\/buying-products-and-services\/consumer-rights-and-guarantees/);
  assert.doesNotMatch(terms, /no refunds|first (?:purchase|payment) only|unused generations only/i);
});

test('paid terms explain cancellation, retained access, budget outages and available remedies', () => {
  assert.match(terms, /Ordinary cancellation takes effect at the end of the current paid period/);
  assert.match(terms, /A Plus refund does not itself cancel future renewal/);
  assert.match(terms, /shared daily AI budget or capacity limits/);
  assert.match(terms, /affect paid users even when generations remain/);
  assert.match(terms, /including a refund where applicable/);
  assert.match(terms, /availability limits do not remove the refund promise or consumer rights/);
  assert.match(terms, /search permitted public job data/);
  assert.match(terms, /review up to five current high-fit Australian technology opportunities/);
});

test('privacy describes optional Stripe data flows and financial retention without promising wholesale deletion', () => {
  assert.match(privacy, /Version roleclue-v1-2026-10-12-starter-50/);
  assert.match(privacy, /If you open enabled checkout/);
  assert.match(privacy, /verified account email, internal account identifier and checkout terms acceptance time\/version/);
  assert.match(privacy, /does not store your full card number or security code/);
  assert.match(privacy, /does not automatically delete Stripe's payment records/);
  assert.match(privacy, /Starter and monthly generation usage/);
  assert.match(privacy, /enforce one Starter purchase per account/);
  assert.match(privacy, /including in the United States and India/);
  assert.match(read('privacy'), /https:\/\/stripe\.com\/au\/privacy/);
  assert.match(privacy, /privacy@proairesis.digital/);
  assert.match(privacy, /A refund alone also does not cancel it/);
  assert.match(privacy, /Financial records described above may remain after the app account is deleted/);
  assert.doesNotMatch(privacy, /Stripe subscriptions.*remain disabled|paid subscriptions are not enabled/);
});

test('production-facing copy no longer labels the product as beta or early access', () => {
  assert.doesNotMatch(appSource, /Beta terms|early-access profile|profile is saved for early access/i);
  assert.doesNotMatch(privacy, /early access/i);
  assert.doesNotMatch(terms, /receiving early access/i);
});

test('the public contract includes current eligibility values and shortlist refresh', () => {
  assert.ok(contract.enums.workRights.includes('visa-unrestricted'));
  assert.ok(contract.enums.workRights.includes('visa-limited'));
  assert.ok(contract.enums.needsSponsorship.includes('now'));
  assert.ok(contract.enums.needsSponsorship.includes('later'));
  assert.ok(contract.routes.some(route => route.startsWith('POST /api/opportunities/refresh')));
  assert.match(contract.configEndpoint, /guestDiscovery/);
});
