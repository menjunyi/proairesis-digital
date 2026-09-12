#!/usr/bin/env bash

set -u

if [[ -z "${BASE_URL:-}" ]]; then
  echo "BASE_URL is required (for example, https://staging.example.com)." >&2
  exit 2
fi

if [[ ! "${TARGET_ENV:-}" =~ ^(local|staging|production)$ ]]; then
  echo "TARGET_ENV must be local, staging, or production." >&2
  exit 2
fi

BASE_URL="${BASE_URL%/}"
EXPECTED_GA_MEASUREMENT_ID="${EXPECTED_GA_MEASUREMENT_ID:-}"
PUBLIC_SITE_MODE="${PUBLIC_SITE_MODE:-full-app}"

if [[ ! "$PUBLIC_SITE_MODE" =~ ^(full-app|static-marketing)$ ]]; then
  echo "PUBLIC_SITE_MODE must be full-app or static-marketing." >&2
  exit 2
fi

if [[ ! "$BASE_URL" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$ ]]; then
  echo "BASE_URL must be a plain HTTP(S) origin or path without query parameters." >&2
  exit 2
fi

if [[ -n "$EXPECTED_GA_MEASUREMENT_ID" && ! "$EXPECTED_GA_MEASUREMENT_ID" =~ ^G-[A-Z0-9]+$ ]]; then
  echo "EXPECTED_GA_MEASUREMENT_ID must use the GA4 G-XXXXXXXXXX format." >&2
  exit 2
fi

if [[ "$TARGET_ENV" == "production" && "$BASE_URL" != https://* ]]; then
  echo "Production smoke tests require an HTTPS BASE_URL." >&2
  exit 2
fi

TASK_SPACE_NAME="pip-${TARGET_ENV}-${PUBLIC_SITE_MODE}-public-smoke"

{
  printf 'const baseUrl = "%s"\n' "$BASE_URL"
  printf 'const targetEnv = "%s"\n' "$TARGET_ENV"
  printf 'const expectedGaId = "%s"\n' "$EXPECTED_GA_MEASUREMENT_ID"
  printf 'const publicSiteMode = "%s"\n' "$PUBLIC_SITE_MODE"
  printf 'const taskName = "%s"\n' "$TASK_SPACE_NAME"
  cat <<'EOF'
const expectedLegalRoutes = [
  '/terms',
  '/membership-agreement',
  '/privacy',
  '/refunds',
  '/cookies',
  '/disclaimer',
]

const failures = []
const checks = []

function check(condition, label, detail = '') {
  checks.push({ label, passed: Boolean(condition), detail })
  if (!condition) failures.push(detail ? `${label}: ${detail}` : label)
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const task = await useOrCreateTaskSpace(taskName)
await openOrReuseTab(baseUrl, { wait: true, timeout: 30 })
await waitForNetworkIdle({ timeout: 10 }).catch(() => undefined)

const homeInfo = await pageInfo()
const home = await js(String.raw`(() => {
  const canonical = document.querySelector('link[rel="canonical"]')?.href ?? ''
  const robots = document.querySelector('meta[name="robots"]')?.content ?? ''
  const h1 = [...document.querySelectorAll('h1')].map((node) => node.textContent?.trim() ?? '')
  const links = [...document.querySelectorAll('a[href]')].map((node) => ({
    href: node.getAttribute('href') ?? '',
    text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  }))
  const scripts = [...document.scripts]
    .map((node) => [node.src, node.textContent ?? ''].join('\n'))
    .join('\n')
  const dataLayer = Array.isArray(window.dataLayer) ? window.dataLayer : []
  return {
    canonical,
    robots,
    h1,
    links,
    scripts,
    dataLayer,
    lang: document.documentElement.lang,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content ?? '',
    bodyText: document.body.innerText,
  }
})()`)

check(homeInfo.url.startsWith(baseUrl), 'home stays on expected origin', homeInfo.url)
check(home.lang.toLowerCase().startsWith('en'), 'document language is English', home.lang)
check(home.title.trim().length > 0, 'page title exists')
check(home.description.trim().length > 40, 'meta description is meaningful')
check(home.h1.length === 1 && home.h1[0].length > 10, 'home has one meaningful H1', JSON.stringify(home.h1))

const requiredHomeLinks = ['#why', '#how', '#trust', '#pricing', ...expectedLegalRoutes]
for (const href of requiredHomeLinks) {
  check(home.links.some((link) => link.href === href), `home links to ${href}`)
}

if (publicSiteMode === 'full-app') {
  check(home.links.some((link) => link.href === '/billing'), 'full app links to /billing')
}

if (publicSiteMode === 'static-marketing') {
  const internalPaths = home.links.flatMap((link) => {
    try {
      const url = new URL(link.href, baseUrl)
      return url.origin === new URL(baseUrl).origin ? [`${url.pathname}${url.hash}`] : []
    } catch {
      return []
    }
  })
  check(
    internalPaths.some((path) => path === '/#pilot' || path === '#pilot'),
    'static marketing site links to the pilot CTA',
    internalPaths.join(', '),
  )
  const forbiddenPaths = internalPaths.filter((path) =>
    /^\/(?:billing|admin|api)(?:[\/#?]|$)/i.test(path),
  )
  check(
    forbiddenPaths.length === 0,
    'static marketing site has no billing, admin, or API links',
    forbiddenPaths.join(', '),
  )
}

const obviousEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const sensitiveKeys = /(tfn|tax[_ -]?file|visa|citizenship|clearance|resume|cv_text|email_address)/i
const visibleMeasurementSurface = JSON.stringify({
  url: homeInfo.url,
  canonical: home.canonical,
  dataLayer: home.dataLayer,
})
check(!obviousEmail.test(visibleMeasurementSurface), 'measurement surface has no email address')
check(!sensitiveKeys.test(JSON.stringify(home.dataLayer)), 'data layer has no sensitive parameter names')

const allGaIds = [...new Set((`${home.scripts}\n${JSON.stringify(home.dataLayer)}`).match(/G-[A-Z0-9]+/gi) ?? [])]
if (expectedGaId) {
  check(allGaIds.includes(expectedGaId), 'expected GA4 measurement ID is present', `found ${allGaIds.join(', ') || 'none'}`)
  check(allGaIds.every((id) => id === expectedGaId), 'no other GA4 measurement ID is present', allGaIds.join(', '))
}

if (targetEnv === 'production') {
  check(home.canonical.length > 0, 'production canonical URL exists')
  check(home.canonical.startsWith(`${baseUrl}/`) || home.canonical === baseUrl, 'production canonical uses tested origin', home.canonical)
  check(!/noindex/i.test(home.robots), 'production page is indexable', home.robots)
}

if (targetEnv === 'staging') {
  check(/noindex/i.test(home.robots), 'staging page declares noindex', home.robots || 'missing robots meta')
}

for (const route of expectedLegalRoutes) {
  await gotoAndWait(`${baseUrl}${route}`, { timeout: 30, settle: 0.5 })
  const legal = await js(String.raw`(() => ({
    title: document.title,
    h1: document.querySelector('h1')?.textContent?.trim() ?? '',
    bodyLength: document.body.innerText.length,
    robots: document.querySelector('meta[name="robots"]')?.content ?? '',
  }))()`)
  check(legal.title.length > 0 && legal.h1.length > 3 && legal.bodyLength > 300, `${route} renders meaningful content`, JSON.stringify(legal))
  if (targetEnv === 'staging') {
    check(/noindex/i.test(legal.robots), `${route} declares noindex in staging`, legal.robots || 'missing robots meta')
  }
}

await gotoAndWait(baseUrl, { timeout: 30, settle: 0.5 })
const publicFiles = await js(String.raw`(async () => {
  const read = async (path) => {
    try {
      const response = await fetch(path, { credentials: 'omit', cache: 'no-store' })
      return { status: response.status, text: await response.text() }
    } catch (error) {
      return { status: 0, text: String(error) }
    }
  }
  return { robots: await read('/robots.txt'), sitemap: await read('/sitemap.xml') }
})()`)

if (targetEnv === 'staging') {
  check(publicFiles.robots.status === 200, 'staging robots.txt exists', `HTTP ${publicFiles.robots.status}`)
  check(/Disallow:\s*\//i.test(publicFiles.robots.text), 'staging robots.txt disallows all crawling')
}

if (targetEnv === 'production') {
  check(publicFiles.robots.status === 200, 'production robots.txt exists', `HTTP ${publicFiles.robots.status}`)
  check(!/Disallow:\s*\/\s*(?:\r?\n|$)/i.test(publicFiles.robots.text), 'production robots.txt does not globally disallow crawling')
  check(publicFiles.sitemap.status === 200, 'production sitemap.xml exists', `HTTP ${publicFiles.sitemap.status}`)
  check(/<urlset[\s>]/i.test(publicFiles.sitemap.text), 'production sitemap is XML')
  for (const route of ['/', ...expectedLegalRoutes]) {
    const expectedUrl = `${baseUrl}${route === '/' ? '/' : route}`
    check(new RegExp(`<loc>\\s*${escapeRegex(expectedUrl)}/?\\s*</loc>`, 'i').test(publicFiles.sitemap.text), `sitemap contains ${route}`, expectedUrl)
  }
  check(!/\/admin(?:<|\/)|\/api\//i.test(publicFiles.sitemap.text), 'sitemap excludes admin and API routes')
}

cliLog(JSON.stringify({
  taskSpaceId: task.id,
  environment: targetEnv,
  publicSiteMode,
  baseUrl,
  passed: failures.length === 0,
  checks,
  failures,
}, null, 2))

if (failures.length) process.exitCode = 1
EOF
} | ego-browser nodejs

TEST_STATUS=$?

{
  printf 'const taskName = "%s"\n' "$TASK_SPACE_NAME"
  cat <<'EOF'
const result = await completeTaskSpace(taskName, { keep: false })
cliLog(JSON.stringify({ cleanup: result }))
EOF
} | ego-browser nodejs

if [[ $TEST_STATUS -ne 0 ]]; then
  exit "$TEST_STATUS"
fi
