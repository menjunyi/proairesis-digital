import {createHash} from 'node:crypto';
import {visibleGeographySupportsAustralia} from './job-geography.mjs';
import {normalizeJob, sanitizeJobDescriptionSource} from './matching.mjs';

const PROVIDERS = new Set(['greenhouse', 'lever', 'ashby']);
const REGISTRY_KEYS = new Set(['provider', 'board', 'company', 'licenseApproved', 'licenseReference']);
const JOB_HOSTS = {
  greenhouse: new Set(['job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io', 'boards.greenhouse.io', 'boards.eu.greenhouse.io']),
  lever: new Set(['jobs.lever.co', 'jobs.eu.lever.co']),
  ashby: new Set(['jobs.ashbyhq.com']),
};
const DEFAULT_LIMITS = {
  sources: 20,
  records: 3000,
  pages: 31,
  responseBytes: 5 * 1024 * 1024,
  totalBytes: 25 * 1024 * 1024,
  requestTimeoutMs: 10000,
  totalTimeoutMs: 45000,
};

function fail(message) {
  throw new Error(`Job feed: ${message}`);
}

function registry(config) {
  if (!config || !Array.isArray(config.sources) || !config.sources.length) fail('sources are required');
  const limits = {...DEFAULT_LIMITS};
  for (const [key, value] of Object.entries(config.limits ?? {})) {
    if (!(key in limits) || !Number.isInteger(value) || value < 1 || value > limits[key]) {
      fail('invalid limit');
    }
    limits[key] = value;
  }
  if (config.sources.length > limits.sources) fail('too many sources');
  const seen = new Set();
  for (const source of config.sources) {
    if (!source || Object.keys(source).some(key => !REGISTRY_KEYS.has(key))) fail('invalid registry entry');
    if (!PROVIDERS.has(source.provider)) fail('unsupported provider');
    if (typeof source.board !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,99}$/.test(source.board)
      || source.board.trim() !== source.board || source.board.includes('..')) fail('invalid board');
    if (typeof source.company !== 'string' || !source.company.trim() || source.company.length > 250) fail('company is required');
    if (source.licenseApproved !== true || typeof source.licenseReference !== 'string'
      || !source.licenseReference.trim() || source.licenseReference.length > 1000) fail('source licence approval is required');
    const key = `${source.provider}:${source.board.toLowerCase()}`;
    if (seen.has(key)) fail('duplicate source');
    seen.add(key);
  }
  return limits;
}

function entities(value) {
  const named = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: "'", lsquo: "'"};
  return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]+);/gi, (match, entity) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? match;
    const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number) : ' ';
  });
}

export function plainText(value) {
  if (typeof value !== 'string' || value.length > 120000) return '';
  let text = sanitizeJobDescriptionSource(entities(entities(value)), {structured: true});
  text = Array.from(text, character => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x08 || codePoint === 0x0b || codePoint === 0x0c ||
      codePoint >= 0x0e && codePoint <= 0x1f ? ' ' : character;
  }).join('');
  return text
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function locations(row, provider, title) {
  let entries;
  if (provider === 'ashby') {
    entries = [{name: row.location, country: row.address?.postalAddress?.addressCountry},
      ...(Array.isArray(row.secondaryLocations) ? row.secondaryLocations.map(item => ({
        name: item.location, country: item.address?.addressCountry,
      })) : [])];
  } else if (provider === 'lever') {
    entries = [{name: row.categories?.location, country: row.country},
      ...(Array.isArray(row.categories?.allLocations) ? row.categories.allLocations
        .filter(name => name !== row.categories.location).map(name => ({name})) : [])];
  } else {
    entries = [{name: row.location?.name}, ...(Array.isArray(row.offices)
      ? row.offices.map(office => ({name: office.location})) : [])];
  }
  return [...new Set(entries.filter(item => visibleGeographySupportsAustralia({
    title,
    location: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : item.country ? 'Australia' : '',
    countries: item.country ? [item.country] : [],
  }))
    .map(item => typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Australia'))];
}

function roleFamily(title, description) {
  const patterns = [
    ['security', /\b(?:cybersecurity|security engineer|security architect|security analyst|security engineering|penetration tester|soc analyst)\b/i],
    ['cloud', /\b(?:cloud|platform|devops|site reliability|infrastructure|systems) (?:engineer|architect)|\bSRE\b/i],
    ['data', /\b(?:data|machine learning|ML|AI|analytics) (?:engineer|scientist|analyst|architect|researcher)|\bbusiness intelligence\b/i],
    ['quality', /\b(?:QA|quality assurance|test automation|software test|test engineer|SDET)\b/i],
    ['software', /\b(?:software|web|mobile|frontend|front-end|backend|back-end|full-stack|full stack|Java|Python|C\+\+) (?:engineer|developer)|\b(?:iOS|Android) developer\b/i],
    ['it-support', /\b(?:IT|technical|desktop|application|network) (?:support|engineer)|\bservice desk\b/i],
    ['product', /\b(?:technical product|product) (?:manager|owner)\b/i],
    ['design', /\b(?:UX|UI|user experience|product) designer\b/i],
    ['business-analysis', /\b(?:business|systems) analyst\b/i],
  ];
  for (const [family, pattern] of patterns) if (pattern.test(title)) return family;
  if (/\b(?:sales|marketing|recruiter|counsel|accountant|finance|human resources)\b/i.test(title)) return null;
  if (!/\b(?:engineer|developer|analyst|architect|specialist|consultant|technical|scientist)\b/i.test(title)) return null;
  const duties = description.split(/[.!?\n]/).filter(line =>
    /\b(?:build|develop|design|maintain|implement|test|secure|operate)\b/i.test(line));
  if (duties.some(line => /\b(?:software|web applications|APIs|code|React|TypeScript|Python)\b/i.test(line))) return 'software';
  if (duties.some(line => /\b(?:data pipelines|machine learning|data warehouse)\b/i.test(line))) return 'data';
  if (duties.some(line => /\b(?:cloud infrastructure|Kubernetes|Terraform)\b/i.test(line))) return 'cloud';
  return null;
}

function requirementSnippet(sentence, match) {
  let start = Math.max(0, match.index - 120);
  if (start && sentence.charCodeAt(start) >= 0xdc00 && sentence.charCodeAt(start) <= 0xdfff) start--;
  const remainder = sentence.slice(start);
  let text = '', bytes = 0;
  for (const character of remainder) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 1200) break;
    text += character;
    bytes += size;
  }
  return text;
}

function requirements(description) {
  const result = {citizenship: 'unknown', sponsorship: 'unknown', clearance: 'unknown', minimumYears: null};
  const evidence = {};
  const experience = String.raw`(\d{1,2})(?:\+)?\s+years?['’]?\s+(?:of\s+)?(?:(?:relevant|professional|commercial|industry|practical|hands-on|software|development|engineering|technical)\s+){0,3}experience\b`;
  const experiencePatterns = [
    new RegExp(String.raw`\b(?:minimum(?: of)?|at least)\s+${experience}`, 'gi'),
    new RegExp(String.raw`\b(?:must|need to)\s+have\s+${experience}`, 'gi'),
    new RegExp(String.raw`\b${experience}\s+(?:(?:is|are)\s+)?(?:required|mandatory|essential)\b`, 'gi'),
  ];
  for (const sentence of description.split(/(?<=[.!?])\s+|\n/).map(line => line.trim()).filter(Boolean)) {
    if (/\b(?:if|unless|except)\b/i.test(sentence)) continue;
    const citizenship = sentence.match(/\b(?:must be an? Australian citizen|Australian citizenship is required|Australian citizens only)\b/i);
    if (!/\b(?:not|no|or|preferred|desirable)\b/i.test(sentence)
      && citizenship) {
      result.citizenship = 'required'; evidence.citizenship = requirementSnippet(sentence, citizenship);
    }
    const sponsorship = sentence.match(/\b(?:cannot|can not|unable to|do not|don't|will not|won't) (?:offer|provide|support) (?:visa )?sponsorship\b|\bno visa sponsorship(?: is)? (?:available|provided|offered)\b|^no visa sponsorship[.!]?$/i);
    if (sponsorship) {
      result.sponsorship = 'unavailable'; evidence.sponsorship = requirementSnippet(sentence, sponsorship);
    }
    const clearance = sentence.match(/\bmust (?:currently )?(?:hold|have) (?:an? )?(?:active |current )?(baseline|NV1|NV2|PV) (?:security )?clearance\b/i);
    if (clearance && !/\b(?:not|or|obtain|eligible|ability)\b/i.test(sentence)) {
      result.clearance = clearance[1].toLowerCase(); evidence.clearance = requirementSnippet(sentence, clearance);
    }
    // Missing, preferred and alternative experience requirements are not hard gates.
    if (!/\b(?:not|no|or|preferred|desired|desirable|ideally|optional|equivalent|recommended|beneficial|advantage)\b|nice.to.have|\b\d+\s*(?:-|–|to)\s*\d+\b/i.test(sentence)) {
      for (const pattern of experiencePatterns) {
        for (const years of sentence.matchAll(pattern)) {
          const minimum = Number(years[1]);
          if (minimum <= 50 && (result.minimumYears === null || minimum > result.minimumYears)) {
            result.minimumYears = minimum; evidence.minimumYears = requirementSnippet(sentence, years);
          }
        }
      }
    }
  }
  return {requirements: result, requirementEvidence: evidence};
}

function sourceLink(row, source) {
  const url = source.provider === 'greenhouse' ? row.absolute_url
    : source.provider === 'lever' ? row.hostedUrl ?? row.applyUrl : row.jobUrl;
  let parsed, parts;
  try {
    if (typeof url !== 'string' || url.trim() !== url || url.length > 2000) fail('invalid job URL');
    parsed = new URL(url);
    parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch { fail(`invalid ${source.provider} job URL`); }
  // Unknown custom domains fail the refresh rather than inventing a replacement link.
  // Keep the provider's original global/EU link, including its application query string.
  const authority = url.match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (parsed.protocol !== 'https:' || !JOB_HOSTS[source.provider].has(parsed.hostname)
    || parsed.username || parsed.password || parsed.port || authority?.toLowerCase() !== parsed.hostname
    || parts[0] !== source.board) fail(`invalid ${source.provider} job URL`);
  const id = source.provider === 'greenhouse' ? parts[2] : parts[1];
  const validPath = source.provider === 'greenhouse' ? parts.length === 3 && parts[1] === 'jobs'
    : parts.length === 2 || (source.provider === 'lever' && parts.length === 3 && parts[2] === 'apply');
  if (!validPath || !/^[a-zA-Z0-9_-]{1,100}$/.test(id ?? '')
    || (source.provider !== 'ashby' && String(row.id) !== id)) fail(`invalid ${source.provider} job URL`);
  return {url, id};
}

function sourceJob(row, source, fetchedAt) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail('invalid job record');
  if (source.provider === 'ashby' && row.isListed !== true) return null;
  const title = plainText(source.provider === 'lever' ? row.text : row.title);
  const australian = locations(row, source.provider, title);
  if (!australian.length) return null;
  let description;
  if (source.provider === 'lever') {
    if (!Array.isArray(row.lists ?? [])) fail('invalid Lever description lists');
    description = [row.descriptionPlain ?? row.description, ...(row.lists ?? []).flatMap(list => [list.text, list.content]),
      row.additionalPlain ?? row.additional].map(plainText).filter(Boolean).join('\n\n');
  } else description = plainText(source.provider === 'ashby' ? row.descriptionPlain ?? row.descriptionHtml : row.content);
  if (description.length < 120 || description.length > 30000 || Buffer.byteLength(description) > 60000
    || !title || title.length > 250) return null;
  const family = roleFamily(title, description);
  if (!family) return null;
  const {url, id} = sourceLink(row, source);
  const workplace = String(row.workplaceType ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const employment = String(row.employmentType ?? row.categories?.commitment ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const sourceName = `${source.provider}:${source.board}`;
  const extracted = requirements(description);
  const job = normalizeJob({id: String(id), title, description, country: 'AU', roleFamily: family,
    company: source.company, location: australian.join('; '), url,
    workplaceType: ({onsite: 'on-site', remote: 'remote', hybrid: 'hybrid'})[workplace] ?? 'unknown',
    employmentType: ({fulltime: 'full-time', parttime: 'part-time', contract: 'contract', intern: 'internship', internship: 'internship', temporary: 'temporary'})[employment] ?? 'unknown',
    seniority: title.match(/\b(senior|lead|principal|staff|graduate|junior)\b/i)?.[1].toLowerCase() ?? 'unknown',
    requirements: extracted.requirements,
  }, sourceName, fetchedAt);
  if (!job) return null;
  // Hash the registry identity to avoid collisions when normalization removes punctuation.
  const boardKey = createHash('sha256').update(sourceName).digest('hex').slice(0,16);
  const normalized = {...job, id: `${source.provider}:${boardKey}:${id}`, sourceBoard: source.board,
    licenseReference: source.licenseReference, descriptionComplete: true,
    requirementEvidence: extracted.requirementEvidence, lastSeenAt: fetchedAt,
    contentHash: createHash('sha256').update(JSON.stringify({title, description, australian})).digest('hex')};
  return Buffer.byteLength(JSON.stringify(normalized)) <= 90000 ? normalized : null;
}

async function requestJson(url, state, fetchImpl) {
  const remaining = state.deadline - Date.now();
  if (remaining <= 0) fail('refresh timed out');
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Job feed: request timed out')); },
      Math.min(state.limits.requestTimeoutMs, remaining));
  });
  const work = async () => {
    const response = await fetchImpl(url, {redirect: 'error', signal: controller.signal, headers: {Accept: 'application/json'}});
    if (!response.ok || response.redirected) fail('source request failed');
    const contentType = response.headers?.get('content-type') ?? '';
    if (!/\bapplication\/(?:[a-z0-9.+-]+\+)?json\b/i.test(contentType)) fail('source did not return JSON');
    const declared = Number(response.headers?.get('content-length'));
    if (declared > state.limits.responseBytes) fail('response too large');
    if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') fail('missing response stream');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      if (controller.signal.aborted) fail('request timed out');
      const buffer = Buffer.from(chunk);
      bytes += buffer.length; state.bytes += buffer.length;
      if (bytes > state.limits.responseBytes || state.bytes > state.limits.totalBytes) {
        controller.abort(); fail('response too large');
      }
      chunks.push(buffer);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid JSON'); }
  };
  try { return await Promise.race([work(), timeout]); }
  finally { clearTimeout(timer); controller.abort(); }
}

export async function fetchApprovedJobs(config, {fetchImpl = fetch, now = new Date()} = {}) {
  const limits = registry(config);
  const date = typeof now === 'function' ? now() : now;
  const fetchedAt = new Date(date).toISOString();
  const state = {limits, bytes: 0, count: 0, deadline: Date.now() + limits.totalTimeoutMs};
  const jobs = [], sources = [], seen = new Set();
  for (const source of config.sources) {
    const board = encodeURIComponent(source.board);
    let pages = 0, fetchedCount = 0, acceptedCount = 0;
    const rawIds = new Set();
    let more;
    do {
      if (++pages > limits.pages) fail('pagination limit exceeded');
      const url = source.provider === 'greenhouse' ? `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`
        : source.provider === 'ashby' ? `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`
          : `https://api.lever.co/v0/postings/${board}?mode=json&skip=${(pages - 1) * 100}&limit=100`;
      const data = await requestJson(url, state, fetchImpl);
      const rows = source.provider === 'lever' ? data : data?.jobs;
      if (!Array.isArray(rows)) fail('invalid source response');
      if (source.provider !== 'lever' && (data.hasMore || data.next || data.nextPage || data.cursor)) fail('incomplete source response');
      if (source.provider === 'greenhouse' && data.meta?.total !== undefined && data.meta.total !== rows.length) fail('incomplete Greenhouse response');
      if (source.provider === 'lever' && rows.length > 100) fail('invalid Lever page size');
      state.count += rows.length; fetchedCount += rows.length;
      if (state.count > limits.records) fail('record limit exceeded');
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) fail('invalid job record');
        const identity = String(source.provider === 'ashby' ? row.jobUrl : row.id);
        if (identity === 'undefined' || rawIds.has(identity)) fail('missing or repeated source job');
        rawIds.add(identity);
        const job = sourceJob(row, source, fetchedAt);
        if (job && !seen.has(job.id)) { seen.add(job.id); jobs.push(job); acceptedCount++; }
      }
      more = source.provider === 'lever' && rows.length === 100;
    } while (more);
    sources.push({...source, fetchedCount, acceptedCount, excludedCount: fetchedCount - acceptedCount, pages});
  }
  return {jobs, metadata: {complete: true, fetchedAt, sources, fetchedCount: state.count, acceptedCount: jobs.length,
    excludedCount: state.count - jobs.length, responseBytes: state.bytes}};
}
