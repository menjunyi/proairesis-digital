import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {normalizeJob, ROLE_FAMILIES, sanitizeJobDescriptionContent} from './matching.mjs';

const FIELDS = new Set(['title', 'company', 'url', 'location', 'description', 'roleFamily',
  'workplace', 'employmentType', 'seniority', 'australiaConfirmed', 'permissionConfirmed']);
const MAX_INPUT_BYTES = 80000;
const WORKPLACES = new Set(['unknown', 'remote', 'hybrid', 'on-site', 'onsite']);
const FOREIGN_LOCATION = /\b(?:United States|USA|United Kingdom|UK|Canada|New Zealand|NZ|Singapore|India|Germany|Florida|Scotland)\b/i;

export class ImportedJobError extends Error {
  constructor(message, code = 'INVALID_JOB') {
    super(message);
    this.name = 'ImportedJobError';
    this.status = 400;
    this.code = code;
  }
}

function invalid(message, code) {
  throw new ImportedJobError(message, code);
}

function textField(input, name, max, {optional = false, min = 1} = {}) {
  const value = input[name];
  if (optional && (value === undefined || value === '')) return 'unknown';
  if (typeof value !== 'string' || value.length > max) invalid(`${name} must be text no longer than ${max} characters.`);
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (text.length < min || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    invalid(`${name} must contain at least ${min} readable characters.`);
  }
  return text;
}

export function canonicalJobUrl(value) {
  if (typeof value !== 'string' || value.length > 2000 || !/^https:\/\//i.test(value)
    || /\s|\\|[\u0000-\u001f\u007f]/.test(value)) {
    invalid('Enter a valid HTTPS link to the individual job.');
  }
  let url;
  try { url = new URL(value); } catch { invalid('Enter a valid HTTPS link to the individual job.'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(host.replace(/^\[|\]$/g, ''))
    || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal)$/.test(host)) {
    invalid('Use a credential-free HTTPS job link on a public website.');
  }
  for (const key of Array.from(url.searchParams.keys())) {
    if (/^(?:access_token|id_token|refresh_token|password|secret|api_key|app_key|x-amz-.+)$/i.test(key)) {
      invalid('Remove private access tokens or credentials from the job link.');
    }
  }
  if (['seek.com.au', 'www.seek.com.au', 'au.seek.com'].includes(host)) {
    const match = url.pathname.match(/^\/job\/(\d+)\/?$/);
    if (!match) invalid('Use the individual SEEK job link, not a search or account page.');
    return `https://www.seek.com.au/job/${match[1]}`;
  }
  if (['linkedin.com', 'www.linkedin.com', 'au.linkedin.com'].includes(host)) {
    const match = url.pathname.match(/^\/(?:comm\/)?jobs\/view\/(?:[^/]*-)?(\d+)\/?$/);
    if (!match) invalid('Use the individual LinkedIn job link, not a search or account page.');
    return `https://www.linkedin.com/jobs/view/${match[1]}/`;
  }
  url.hash = '';
  for (const key of Array.from(url.searchParams.keys())) {
    if (/^(?:utm_.+|gclid|fbclid|msclkid|trackingId)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href;
}

function snippet(sentence, match) {
  let start = Math.max(0, match.index - 100);
  if (start && /[\udc00-\udfff]/.test(sentence[start])) start--;
  let result = '', bytes = 0;
  for (const character of sentence.slice(start)) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 1200) break;
    result += character;
    bytes += size;
  }
  return result;
}

export function explicitRequirements(description) {
  const requirements = {citizenship: 'unknown', sponsorship: 'unknown', clearance: 'unknown', minimumYears: null};
  const requirementEvidence = {};
  const experience = String.raw`(\d{1,2})(?:\+)?\s+years?['’]?\s+(?:of\s+)?(?:(?:relevant|professional|commercial|industry|practical|hands-on|software|development|engineering|technical)\s+){0,3}experience\b`;
  const experiencePatterns = [
    new RegExp(String.raw`\b(?:minimum(?: of)?|at least)\s+${experience}`, 'gi'),
    new RegExp(String.raw`\b(?:must|need to)\s+have\s+${experience}`, 'gi'),
    new RegExp(String.raw`\b${experience}\s+(?:(?:is|are)\s+)?(?:required|mandatory|essential)\b`, 'gi'),
  ];
  const safeDescription = sanitizeJobDescriptionContent(description);
  for (const sentence of safeDescription.split(/(?<=[.!?])\s+|\n/).map(value => value.trim()).filter(Boolean)) {
    if (/\b(?:unless|except|if)\b/i.test(sentence)) continue;
    const citizen = sentence.match(/(?:^(?:[-+*•]\s*)?must be an? Australian citizen\s*[.!]?$|\b(?:you|the (?:successful )?(?:applicant|candidate)|applicants?|candidates?) must be an? Australian citizen\s*[.!]?$|\bAustralian citizenship is required(?: for (?:this|the) (?:role|position))?\s*[.!]?$|\bAustralian citizens only(?: may apply| will be considered)?\s*[.!]?$)/i);
    if (citizen && !/\b(?:not|no|or|preferred|desirable)\b/i.test(sentence)) {
      requirements.citizenship = 'required';
      requirementEvidence.citizenship = snippet(sentence, citizen);
    }
    const sponsorship = sentence.match(/\b(?:cannot|can not|unable to|do not|don't|will not|won't) (?:offer|provide|support) (?:visa )?sponsorship(?:\s+(?:for|in)\s+(?:this|the)\s+(?:role|position))?\s*[.!]?$|\bno visa sponsorship(?:(?: is)? (?:available|provided|offered))?(?:\s+(?:for|in)\s+(?:this|the)\s+(?:role|position))?\s*[.!]?$/i);
    if (sponsorship) {
      requirements.sponsorship = 'unavailable';
      requirementEvidence.sponsorship = snippet(sentence, sponsorship);
    }
    const clearance = sentence.match(/(?:^(?:[-+*•]\s*)?must|\b(?:you|the (?:successful )?(?:applicant|candidate)|applicants?|candidates?) must) (?:currently )?(?:hold|have) (?:an? )?(?:active |current )?(baseline|NV1|NV2|PV) (?:security )?clearance\b/i);
    if (clearance && !/\b(?:not|or|obtain|eligible|ability)\b/i.test(sentence)) {
      requirements.clearance = clearance[1].toLowerCase();
      requirementEvidence.clearance = snippet(sentence, clearance);
    }
    const thirdPartyExperience = /\b(?:customers?|clients?|users?|operators?)\b|\b(?:screen|assess|evaluate|identify|support|serve)\w*\s+(?:candidates?|applicants?)\b|\b(?:candidates?|applicants?)\s+(?:who|with)\b/i.test(sentence);
    if (!thirdPartyExperience && !/\b(?:not|no|or|preferred|desired|desirable|ideally|optional|equivalent|recommended|beneficial|advantage)\b|nice.to.have|\b\d+\s*(?:-|–|to)\s*\d+\b/i.test(sentence)) {
      for (const pattern of experiencePatterns) {
        for (const match of sentence.matchAll(pattern)) {
          const years = Number(match[1]);
          if (years <= 50 && (requirements.minimumYears === null || years > requirements.minimumYears)) {
            requirements.minimumYears = years;
            requirementEvidence.minimumYears = snippet(sentence, match);
          }
        }
      }
    }
  }
  return {requirements, requirementEvidence};
}

export function normalizeImportedJob(input, {now = new Date()} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid('Send a job description as a JSON object.');
  if (Object.keys(input).some(key => !FIELDS.has(key))) invalid('The job contains unsupported fields.');
  let size;
  try { size = Buffer.byteLength(JSON.stringify(input)); } catch { invalid('Send a valid job object.'); }
  if (size > MAX_INPUT_BYTES) invalid('The combined job details are too large.');
  if (input.permissionConfirmed !== true) invalid('Confirm you have permission to provide this job description for assessment.', 'CONTENT_PERMISSION_REQUIRED');
  if (input.australiaConfirmed !== true) invalid('Confirm this role can be performed in Australia.', 'AUSTRALIA_CONFIRMATION_REQUIRED');
  const title = textField(input, 'title', 250);
  const company = textField(input, 'company', 250);
  const location = textField(input, 'location', 250);
  // Country confirmation is user-provided, not an external geocoding result.
  if (FOREIGN_LOCATION.test(location) && !/\bAustralia\b/i.test(location)) invalid('The location conflicts with your Australian-role confirmation.');
  const description = textField(input, 'description', 20000, {min: 200});
  if (Buffer.byteLength(description) > 60000) invalid('The description is too large. Use at most 60000 UTF-8 bytes.');
  if (!ROLE_FAMILIES.includes(input.roleFamily)) invalid('Choose a supported technology role family.');
  const workplace = textField(input, 'workplace', 20, {optional: true});
  if (!WORKPLACES.has(workplace)) invalid('Choose remote, hybrid, on-site or unknown for workplace.');
  const employmentType = textField(input, 'employmentType', 60, {optional: true});
  const seniority = textField(input, 'seniority', 60, {optional: true});
  const url = canonicalJobUrl(input.url);
  let importedAt;
  try { importedAt = new Date(typeof now === 'function' ? now() : now).toISOString(); }
  catch { invalid('The job could not be timestamped. Please retry.'); }
  const extracted = explicitRequirements(description);
  const job = normalizeJob({id: createHash('sha256').update(url).digest('hex'), title, company, location,
    description, roleFamily: input.roleFamily, url, sourceUrl: url, country: 'AU',
    workplaceType: workplace, employmentType, seniority, requirements: extracted.requirements,
  }, 'user-provided', importedAt);
  if (!job) invalid('The supplied job could not be normalized.');
  const result = {...job, requirementEvidence: extracted.requirementEvidence, importedAt,
    permissionConfirmedAt: importedAt, australiaConfirmedAt: importedAt,
    descriptionComplete: false, sourceVerified: false, availability: 'unknown',
    availabilityMessage: 'You supplied this job. Confirm its current availability and complete requirements with the employer.',
    availabilityCheckedAt: null,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 90000) invalid('The combined job details are too large.');
  return result;
}
