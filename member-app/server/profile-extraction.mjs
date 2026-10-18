import {detectSkills, ROLE_FAMILIES} from './matching.mjs';

const FAMILY_SIGNALS = [
  ['security', /\b(?:cyber ?security|security (?:engineer|analyst|architect)|penetration test|soc analyst)\b/i],
  ['cloud', /\b(?:cloud|platform|devops|site reliability|infrastructure) (?:engineer|architect)|\bSRE\b|\bterraform\b|\bkubernetes\b/i],
  ['data', /\b(?:data|machine learning|ML|AI|analytics) (?:engineer|scientist|analyst|architect)|\bpower bi\b|\btableau\b/i],
  ['quality', /\b(?:QA|quality assurance|test automation|test engineer|SDET|selenium|playwright|cypress)\b/i],
  ['software', /\b(?:software|frontend|front-end|backend|back-end|full[- ]stack|web|mobile) (?:engineer|developer)|\b(?:react|typescript|javascript|node\.js|java|python|c#|c\+\+)\b/i],
  ['product', /\b(?:technical )?product (?:manager|owner)\b/i],
  ['design', /\b(?:UX|UI|user experience|product) design(?:er)?\b|\bfigma\b/i],
  ['it-support', /\b(?:IT|technical|desktop|application|network) support\b|\bservice desk\b/i],
  ['business-analysis', /\b(?:business|systems) analys(?:t|is)\b/i],
];

const TITLE_PATTERN = /\b(?:senior |lead |principal |staff |junior |graduate )?(?:software engineer|software developer|frontend developer|front-end developer|backend developer|back-end developer|full[- ]stack developer|mobile developer|data engineer|data scientist|data analyst|cloud engineer|platform engineer|devops engineer|site reliability engineer|security engineer|security analyst|qa engineer|test engineer|product manager|product designer|ux designer|ui designer|business analyst|systems analyst|technical support specialist|service desk analyst)\b/gi;
const AU_LOCATION = /\b(Sydney|Melbourne|Brisbane|Canberra|Adelaide|Perth|Hobart|Darwin|Gold Coast|Wollongong|New South Wales|Victoria|Queensland|Australian Capital Territory|South Australia|Western Australia|Tasmania|Northern Territory|NSW|VIC|QLD|ACT|SA|WA|TAS|NT)(?:,?\s+Australia)?\b/i;

function headerName(text) {
  const blocked = /\b(?:resume|curriculum vitae|profile|summary|experience|engineer|developer|analyst|manager|designer|email|phone|linkedin)\b/i;
  for (const raw of String(text).split(/\r?\n/).slice(0, 8)) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (line.length < 3 || line.length > 80 || blocked.test(line) || AU_LOCATION.test(line) || /[@\d/:|]/.test(line)) continue;
    const words = line.split(' ');
    if (words.length >= 2 && words.length <= 5 && words.every(word => /^[\p{L}][\p{L}'-]*$/u.test(word))) return line;
  }
  return '';
}

function explicitYears(text) {
  const values = [...String(text).matchAll(/\b(\d{1,2})(?:\+)?\s+years?['’]?\s+(?:of\s+)?(?:professional |commercial |industry |relevant )?experience\b/gi)]
    .map(match => Number(match[1])).filter(value => value >= 0 && value <= 50);
  return values.length ? Math.max(...values) : null;
}

function roleTitles(text) {
  const values = [];
  for (const match of String(text).slice(0, 30000).matchAll(TITLE_PATTERN)) {
    const value = match[0].replace(/\s+/g, ' ').trim();
    if (!values.some(existing => existing.toLowerCase() === value.toLowerCase())) values.push(value);
    if (values.length === 5) break;
  }
  return values;
}

export function suggestProfileFromResume(text, detected = detectSkills(text)) {
  const header = String(text).slice(0, 1800);
  const locationMatch = header.match(AU_LOCATION);
  const families = FAMILY_SIGNALS.filter(([, pattern]) => pattern.test(text)).map(([family]) => family)
    .filter(family => ROLE_FAMILIES.includes(family)).slice(0, 4);
  const titles = roleTitles(text);
  const values = {
    name: headerName(header),
    location: locationMatch?.[0]?.replace(/\s+/g, ' ').trim() ?? '',
    yearsExperience: explicitYears(text),
    skills: [...new Set(detected)].slice(0, 60),
    roleFamilies: families,
    roleTitles: titles,
  };
  return {
    values,
    evidence: {
      name: values.name ? 'resume-header' : null,
      location: values.location ? 'resume-header' : null,
      yearsExperience: values.yearsExperience === null ? null : 'explicit-resume-statement',
      skills: values.skills.length ? 'resume-text' : null,
      roleFamilies: values.roleFamilies.length ? 'resume-text-signals' : null,
      roleTitles: values.roleTitles.length ? 'resume-text' : null,
    },
    requiresConfirmation: ['name', 'location', 'yearsExperience', 'skills', 'roleFamilies', 'roleTitles'],
    notInferred: ['workRights', 'visaStatus', 'needsSponsorship', 'clearance', 'personalLimitations'],
  };
}
