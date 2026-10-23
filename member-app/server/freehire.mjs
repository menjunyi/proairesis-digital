import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {explicitRequirements} from './imported-jobs.mjs';
import {detectSkills, normalizeJob, sanitizeJobDescriptionContent} from './matching.mjs';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 100;
const TIMEOUT_MS = 8000;
const MAX_TRANSPORT_ATTEMPTS = 2;
const DIRECT_SOURCES = new Set([
  'ashby', 'bamboohr', 'comeet', 'greenhouse', 'icims', 'jobvite', 'lever', 'oracle', 'personio',
  'recruitee', 'smartrecruiters', 'successfactors', 'teamtailor', 'workable', 'workday',
]);
const DENIED_HOST = /(?:^|\.)(?:adzuna\.[a-z.]+|indeed\.[a-z.]+|linkedin\.com|seek\.com\.au|glassdoor\.[a-z.]+)$/i;
const FAMILY_CATEGORIES = Object.freeze({
  software: ['software_engineering', 'backend', 'frontend', 'fullstack', 'mobile', 'embedded', 'blockchain', 'developer_relations', 'technical_writing', 'solutions_engineering'],
  data: ['data_engineering', 'data_science', 'data_analytics', 'ml_ai', 'ai_engineering'],
  cloud: ['devops', 'sre', 'network_engineering', 'architecture'],
  security: ['security'], quality: ['qa'], product: ['product'], design: ['design'],
  'it-support': ['support'], 'business-analysis': ['business_analysis'],
});
const CATEGORY_FAMILY = new Map(Object.entries(FAMILY_CATEGORIES).flatMap(([family, categories]) => categories.map(category => [category, family])));

export class FreehireError extends Error {
  constructor(code, message) { super(message);this.name = 'FreehireError';this.status = 503;this.code = code; }
}

function configuredBase(value) {
  let url;
  try { url = new URL(value || 'https://freehire.me/api/v1/'); } catch { throw new FreehireError('JOB_SEARCH_NOT_CONFIGURED', 'Live job search is not configured.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port
    || !url.hostname.includes('.') || isIP(url.hostname) || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)) {
    throw new FreehireError('JOB_SEARCH_NOT_CONFIGURED', 'Live job search is not configured.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

async function boundedJson(response, controller) {
  if (!response.ok || response.redirected) throw new FreehireError('JOB_SEARCH_UNAVAILABLE', 'Live job search is temporarily unavailable. Try again shortly.');
  const contentType = response.headers?.get('content-type') ?? '';
  const declared = Number(response.headers?.get('content-length'));
  if (!/\bapplication\/(?:[a-z0-9.+-]+\+)?json\b/i.test(contentType) || declared > MAX_RESPONSE_BYTES || !response.body) {
    throw new FreehireError('JOB_SEARCH_UNAVAILABLE', 'The live job source returned an invalid response. Try again shortly.');
  }
  const chunks = [];let size = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);size += bytes.length;
    if (size > MAX_RESPONSE_BYTES) { controller.abort();throw new FreehireError('JOB_SEARCH_UNAVAILABLE', 'The live job source returned too much data. Try again shortly.'); }
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new FreehireError('JOB_SEARCH_UNAVAILABLE', 'The live job source returned an invalid response. Try again shortly.');
  }
}

function safeApplyUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(url.hostname) || DENIED_HOST.test(url.hostname)) return null;
  return url.href;
}

function sourceTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function normalizeFreehire(row, licenseReference, fetchedAt) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.manually_added === true) return null;
  const upstream = String(row.source ?? '').trim().toLowerCase();
  if (!DIRECT_SOURCES.has(upstream) || !Array.isArray(row.countries) || !row.countries.some(country => String(country).toUpperCase() === 'AU')) return null;
  const category = String(row.enrichment?.category ?? '').toLowerCase(), roleFamily = CATEGORY_FAMILY.get(category);
  if (!roleFamily || row.closed_at) return null;
  const description = typeof row.description === 'string' ? row.description.replace(/\u0000/g, '').trim() : '';
  if (description.length < 200 || description.length > 20000 || Buffer.byteLength(description, 'utf8') > 60000) return null;
  const url = safeApplyUrl(row.apply_url ?? row.url);if (!url) return null;
  const slug = String(row.public_slug ?? '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,179}$/.test(slug)) return null;
  const extracted = explicitRequirements(description);
  const workMode = String(row.work_mode ?? '').toLowerCase();
  const employment = String(row.enrichment?.employment_type ?? '').toLowerCase();
  const seniority = String(row.enrichment?.seniority ?? 'unknown').toLowerCase();
  const job = normalizeJob({
    id: slug, title: String(row.title ?? '').trim(), company: String(row.company ?? '').trim(), country: 'AU', roleFamily,
    location: String(row.location ?? 'Australia').trim() || 'Australia', url, sourceUrl: url, description,
    workplaceType: ({remote: 'remote', hybrid: 'hybrid', onsite: 'on-site'})[workMode] ?? 'unknown',
    employmentType: ({full_time: 'full-time', part_time: 'part-time', contract: 'contract', internship: 'internship', fellowship: 'fellowship'})[employment] ?? 'unknown',
    seniority: ({middle: 'mid', c_level: 'executive', intern: 'junior'})[seniority] ?? seniority,
    skills: detectSkills(sanitizeJobDescriptionContent(description)), requirements: extracted.requirements,
  }, `freehire:${upstream}`, fetchedAt);
  if (!job) return null;
  const publishedAt = sourceTimestamp(row.posted_at);
  const sourceFirstSeenAt = sourceTimestamp(row.created_at);
  const sourceUpdatedAt = sourceTimestamp(row.updated_at);
  const result = {...job, sourceDisplay: `Freehire / ${upstream}`, upstreamSource: upstream,
    freehireSlug: slug, licenseReference, descriptionComplete: true, sourceVerified: false,
    requirementEvidence: extracted.requirementEvidence, lastSeenAt: fetchedAt,
    ...(publishedAt ? {publishedAt} : {}), ...(sourceFirstSeenAt ? {sourceFirstSeenAt} : {}),
    ...(sourceUpdatedAt ? {sourceUpdatedAt} : {}),
    contentHash: createHash('sha256').update(JSON.stringify({url, title: job.title, description})).digest('hex')};
  return Buffer.byteLength(JSON.stringify(result), 'utf8') <= 90000 ? result : null;
}

export function createFreehireSearch(env, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const enabled = () => env.FREEHIRE_ENABLED === 'true' && env.FREEHIRE_LICENSE_APPROVED === 'true'
    && typeof env.FREEHIRE_LICENSE_REFERENCE === 'string' && Boolean(env.FREEHIRE_LICENSE_REFERENCE.trim());
  return {
    available: async () => enabled(),
    async search(profile, _guest = {}) {
      if (!enabled()) throw new FreehireError('JOB_SEARCH_NOT_CONFIGURED', 'Live job search is awaiting source approval. No sample jobs were substituted.');
      const categories = [...new Set((profile.roleFamilies ?? []).flatMap(family => FAMILY_CATEGORIES[family] ?? []))];
      if (!categories.length) return {jobs: [], source: {name: 'Freehire', status: 'ready'}};
      const url = new URL('agent/jobs/search', configuredBase(env.FREEHIRE_BASE_URL));
      url.searchParams.set('countries', 'AU');url.searchParams.set('category', categories.join(','));
      url.searchParams.set('source', [...DIRECT_SOURCES].join(','));
      url.searchParams.set('description_format', 'text');url.searchParams.set('limit', String(MAX_RESULTS));
      url.searchParams.set('sort', 'posted_at');url.searchParams.set('order', 'desc');url.searchParams.set('open_within_days', '90');
      let result;
      try {
        for(let attempt=1;attempt<=MAX_TRANSPORT_ATTEMPTS;attempt++){
          const controller = new AbortController();const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
          try {
            const response = await fetchImpl(url, {redirect: 'error', signal: controller.signal, headers: {Accept: 'application/json'}});
            result = await boundedJson(response, controller);
            break;
          } catch(error) {
            if(error instanceof FreehireError || attempt===MAX_TRANSPORT_ATTEMPTS)throw error;
          } finally { clearTimeout(timer);controller.abort(); }
        }
        const returnedLimit=Number(result?.meta?.limit);
        if (!Array.isArray(result?.data) || !Number.isSafeInteger(returnedLimit) || returnedLimit<1
          || returnedLimit>MAX_RESULTS || result.data.length>returnedLimit) {
          throw new FreehireError('JOB_SEARCH_UNAVAILABLE', 'The live job source returned an invalid result set. Try again shortly.');
        }
        const ignored = result.meta.ignored_params;
        if (Array.isArray(ignored) && ignored.some(item => ['countries', 'category', 'source', 'description_format', 'limit'].includes(typeof item === 'string' ? item : item?.param))) {
          throw new FreehireError('JOB_SEARCH_UNAVAILABLE', 'The live job source did not apply the required Australian technology filters.');
        }
        const fetchedAt = new Date().toISOString(), seen = new Set(), jobs = [];
        for (const row of result.data) {
          const job = normalizeFreehire(row, env.FREEHIRE_LICENSE_REFERENCE.trim(), fetchedAt);
          if (job && !seen.has(job.url)) { seen.add(job.url);jobs.push(job); }
        }
        return {jobs, source: {name: 'Freehire', status: 'ready', fetchedAt, returned: result.data.length, accepted: jobs.length}};
      } catch (error) {
        if (error instanceof FreehireError) throw error;
        throw new FreehireError('JOB_SEARCH_UNAVAILABLE', 'Live job search is temporarily unavailable. Try again shortly.');
      }
    },
  };
}
