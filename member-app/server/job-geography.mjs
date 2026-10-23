const REGION_BOUNDARY = String.raw`[\s,;:/()\[\]|–—•·-]`;
const AU_REGION_CODE = new RegExp(`(?:^|${REGION_BOUNDARY})AU(?:S)?(?=$|${REGION_BOUNDARY})`, 'i');
const NEUTRAL_REMOTE_LOCATION = /^(?:(?:apac|oceania|worldwide|global|anywhere|(?:fully\s+)?remote(?:\s+(?:job|role|position))?|aest|aedt|acst|acdt|awst)(?:[\s,;:/()[\]|–—-]+|$))+$/i;
const ROLE_ACRONYM_CODES = new Set(['AI', 'ML', 'IT', 'BI', 'QA', 'UI', 'UX', 'PM', 'PO', 'HR', 'PR', 'AR', 'VR', 'DB', 'OS', 'FE', 'BE', 'CI', 'CD', 'CX', 'ID', 'EE', 'ME', 'IS', 'SE', 'SA']);
const COMMON_MARKET_CODES = new Set(['US', 'USA', 'UK', 'GB', 'NZ', 'CA', 'SG', 'IN', 'DE', 'EU', 'FR', 'JP', 'CN']);
const COMMON_TWO_LETTER_WORDS = new Set(['OR', 'IN', 'ON', 'AT', 'BY', 'NO', 'AS', 'IS', 'TO', 'OF']);
const STREET_SUFFIX_CODES = new Set(['ST', 'RD', 'DR', 'CT', 'PL', 'LN', 'AV']);
const AU_COUNTRY_CODES = new Set(['AU', 'AUS', 'AUSTRALIA']);

const FOREIGN_SUBDIVISIONS = Object.freeze([
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia', 'Alberta', 'British Columbia', 'Manitoba',
  'New Brunswick', 'Newfoundland and Labrador', 'Nova Scotia', 'Ontario', 'Prince Edward Island', 'Quebec',
  'Saskatchewan', 'Northwest Territories', 'Nunavut', 'Yukon', 'England', 'Scotland', 'Wales', 'Northern Ireland',
  'Cape Breton', 'Derbyshire',
]);
const FOREIGN_CITIES = Object.freeze([
  'London', 'Toronto', 'Vancouver', 'Montreal', 'Bangalore', 'Bengaluru', 'Mumbai', 'Delhi', 'New Delhi',
  'Auckland', 'Wellington', 'Dublin', 'Berlin', 'Paris', 'Amsterdam', 'Seattle', 'San Francisco', 'Los Angeles',
  'Chicago', 'Boston', 'Austin', 'Dallas', 'Atlanta', 'Tokyo', 'Seoul', 'NYC',
  'New York City', 'Mexico City', 'Dubai',
  'Hyderabad', 'Pune', 'Chennai', 'São Paulo', 'Madrid', 'Barcelona', 'Warsaw', 'Prague', 'Tel Aviv',
  'San Jose', 'Manila', 'Jakarta', 'Bangkok', 'Kuala Lumpur', 'Taipei', 'Shanghai', 'Beijing', 'Shenzhen',
  'Lagos', 'Nairobi', 'Zurich', 'Rome', 'Lisbon', 'Manchester',
]);
const FOREIGN_REGIONS = Object.freeze([
  'Europe', 'European Union', 'EMEA', 'LATAM', 'Americas', 'North America', 'NAMER', 'AMER', 'DACH',
  'UK&I', 'ASEAN', 'SEA', 'MENA',
]);
const FOREIGN_SUBDIVISION_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
  'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WV', 'WI', 'WY', 'DC',
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);
const REGION_CODES = new Set(COMMON_MARKET_CODES);
const REGION_NAMES = (() => {
  const names = new Set(['United States', 'United Kingdom', 'New Zealand', 'European Union', 'Hong Kong', 'UAE', 'U.A.E.', 'U.S.', 'U.S.A.', 'U.K.', ...FOREIGN_REGIONS]);
  const display = new Intl.DisplayNames(['en'], {type: 'region'});
  for (let first = 65; first <= 90; first++) for (let second = 65; second <= 90; second++) {
    const code = String.fromCharCode(first, second);
    const name = display.of(code);
    if (name && name !== code && name !== 'Unknown Region') {
      if (name !== 'Australia') names.add(name);
      if (code !== 'AU' && !ROLE_ACRONYM_CODES.has(code)) REGION_CODES.add(code);
    }
  }
  return [...names].sort((left, right) => right.length - left.length);
})();

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternation = values => [...new Set(values)].sort((left, right) => right.length - left.length).map(escapeRegExp).join('|');
const FOREIGN_PLACE_ALTERNATION = alternation([...REGION_NAMES, ...FOREIGN_SUBDIVISIONS, ...FOREIGN_CITIES]);
const AMBIGUOUS_PRODUCT_REGIONS = new Set(['Jordan', 'Peru', 'Jersey', 'Monaco']);
const STRONG_PREFIX_ALTERNATION = alternation([
  ...REGION_NAMES.filter(name => !AMBIGUOUS_PRODUCT_REGIONS.has(name)),
  ...FOREIGN_SUBDIVISIONS, ...FOREIGN_CITIES, 'USA', 'U.S.', 'U.S.A.', 'UK', 'U.K.',
]);
const FOREIGN_LOCATION_NAME = new RegExp(`(?<![\\p{L}\\p{N}])(?:${FOREIGN_PLACE_ALTERNATION})(?![\\p{L}\\p{N}])`, 'iu');
const LOCATION_MARKET_CODE_ALTERNATION = alternation([...COMMON_MARKET_CODES].filter(code => code !== 'IN'));
const LOCATION_PUNCTUATED_CODE_ALTERNATION = alternation([...REGION_CODES, ...FOREIGN_SUBDIVISION_CODES]);
const LOCATION_CONTEXT_CODE_ALTERNATION = alternation(
  [...REGION_CODES, ...FOREIGN_SUBDIVISION_CODES].filter(code => !COMMON_TWO_LETTER_WORDS.has(code)),
);
const FOREIGN_LOCATION_COMMON_CODE = new RegExp(`(?:^|${REGION_BOUNDARY})(?:${LOCATION_MARKET_CODE_ALTERNATION})(?=$|${REGION_BOUNDARY})`, 'i');
// Less distinctive codes require either their original uppercase form, a complete value, or punctuation.
const FOREIGN_LOCATION_EXACT_CODE = new RegExp(`(?:^|${REGION_BOUNDARY})(?:${LOCATION_CONTEXT_CODE_ALTERNATION})(?=$|${REGION_BOUNDARY})`);
const FOREIGN_LOCATION_STANDALONE_CODE = new RegExp(`^(?:${LOCATION_PUNCTUATED_CODE_ALTERNATION})$`, 'i');
const FOREIGN_LOCATION_PUNCTUATED_CODE = new RegExp(`(?:[,;:/()\\[\\]|–—•·-])\\s*(?:${LOCATION_CONTEXT_CODE_ALTERNATION})(?=$|${REGION_BOUNDARY})`);
const STREET_ADDRESS_SUFFIX_CODE = /\b(\d{1,5}[A-Za-z]?(?:[-/]\d{1,5}[A-Za-z]?)?\s+(?:[\p{L}\p{N}'’.&-]+\s+){1,8})(?:ST|RD|DR|CT|PL|LN|AV)(?=$|[\s,;:/()[\]|\u2013\u2014-])/giu;
const TITLE_METADATA = String.raw`(?:\s*[\[(][^\]\)\r\n]{1,40}[\])])?`;
const TITLE_DELIMITER = String.raw`[-–—|/(,:;\[•·]`;
const TITLE_ROLE_WORD = String.raw`(?:remote|hybrid|on[- ]?site|software|data|cloud|platform|security|systems?|solutions?|support|product|design|engineer(?:ing)?|developer|analyst|architect|consultant|devops|sre|qa|frontend|backend|full[- ]stack|mobile|network|infrastructure|site reliability|quality)`;
const TITLE_SENIORITY = String.raw`(?:(?:senior|sr\.?|junior|lead|principal|staff|graduate|entry[- ]level|mid[- ]level|intermediate|associate|head|director)\s+)*`;
const TITLE_MARKET_DETAIL = String.raw`(?:(?:east|west|central|north|south)(?:ern)?\s+)?`;
const TITLE_SUFFIX_DETAIL = String.raw`(?:\s+(?:(?:east|west|central|north|south)(?:ern)?|US|USA|UK|GB|NZ|CA|SG|DE|EU|FR|JP|CN|office|region)){0,2}`;

const titleQualifierPattern = (values, flags = '') => new RegExp(
  `(?:^(?:${values})${TITLE_METADATA}\\s*[,;:|/–—-]|(?:${TITLE_DELIMITER}|\\b(?:in|for)\\b)\\s*[\\[(]?\\s*(?:(?:remote|hybrid|on[- ]?site)\\s+)?(?:${values})${TITLE_SUFFIX_DETAIL}\\s*(?=$|[,;:/()\\[\\]|–—•·-]|(?:remote|hybrid|on[- ]?site|based|only)\\b))`,
  flags,
);
const FOREIGN_TITLE_QUALIFIER = titleQualifierPattern(FOREIGN_PLACE_ALTERNATION, 'iu');
const FOREIGN_TITLE_PREFIX = new RegExp(`^(?:(?:remote|hybrid|on[- ]?site)\\s+)?(?:${STRONG_PREFIX_ALTERNATION})(?:[- ]?based|\\s+remote|\\s+hybrid|\\s+on[- ]?site|\\s+office|\\s+region)?\\s+${TITLE_MARKET_DETAIL}${TITLE_SENIORITY}(?=${TITLE_ROLE_WORD}\\b)`, 'iu');
const FOREIGN_TITLE_GENERIC_PREFIX = new RegExp(
  `^(?:(?:remote|hybrid|on[- ]?site)\\s+)?(?:${STRONG_PREFIX_ALTERNATION}|${LOCATION_MARKET_CODE_ALTERNATION})(?:[- ]?based|\\s+(?:only|remote|hybrid|on[- ]?site|office|region))?\\s+(?=\\S)`,
  'iu',
);
const FOREIGN_TITLE_MARKET_ATOM = String.raw`(?:${FOREIGN_PLACE_ALTERNATION}|${LOCATION_MARKET_CODE_ALTERNATION})`;
const FOREIGN_TITLE_CONNECTED_SUFFIX = new RegExp(
  `(?:${TITLE_DELIMITER}|\\b(?:in|for)\\b)\\s*[\\[(]?\\s*(?:${FOREIGN_TITLE_MARKET_ATOM})${TITLE_SUFFIX_DETAIL}\\s*(?:&|\\+|\\b(?:and|or)\\b)\\s*(?:(?:remote|hybrid|on[- ]?site)|(?:${FOREIGN_TITLE_MARKET_ATOM}))${TITLE_SUFFIX_DETAIL}\\s*(?=$|[,;:/()\\[\\]|–—•·-]|(?:based|only)\\b)`,
  'iu',
);
const FOREIGN_TITLE_CONNECTED_PREFIX = new RegExp(
  `^(?:(?:remote|hybrid|on[- ]?site)\\s+)?(?:${FOREIGN_TITLE_MARKET_ATOM})${TITLE_SUFFIX_DETAIL}\\s*(?:&|\\+|\\b(?:and|or)\\b)\\s*(?:${FOREIGN_TITLE_MARKET_ATOM})${TITLE_SUFFIX_DETAIL}\\s+${TITLE_SENIORITY}(?=${TITLE_ROLE_WORD}\\b)`,
  'iu',
);

const AU_CITY_NAMES = Object.freeze([
  'Sydney', 'Melbourne', 'Brisbane', 'Canberra', 'Adelaide', 'Perth', 'Hobart', 'Darwin', 'Gold Coast',
  'Sunshine Coast', 'Wollongong', 'Newcastle', 'Geelong', 'Cairns', 'Townsville', 'Toowoomba', 'Mackay',
  'Rockhampton', 'Bundaberg', 'Ballarat', 'Bendigo', 'Albury', 'Launceston', 'Alice Springs', 'Port Macquarie',
  'Coffs Harbour', 'Greater Sydney Area', 'Greater Melbourne Area', 'Greater Brisbane Area', 'Greater Perth Area',
  'Greater Adelaide Area',
]);
const AU_UNAMBIGUOUS_STATES = Object.freeze([
  'NSW', 'New South Wales', 'VIC', 'QLD', 'Queensland', 'ACT', 'Australian Capital Territory',
  'South Australia', 'Western Australia', 'TAS', 'Tasmania', 'Northern Territory',
]);
const AU_AMBIGUOUS_STATES = Object.freeze(['Victoria', 'SA', 'WA', 'NT']);
const AU_CITY = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation(AU_CITY_NAMES)})(?![\\p{L}\\p{N}])`, 'iu');
const AU_UNAMBIGUOUS_STATE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation(AU_UNAMBIGUOUS_STATES)})(?![\\p{L}\\p{N}])`, 'iu');
const AU_AMBIGUOUS_STATE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation(AU_AMBIGUOUS_STATES)})(?![\\p{L}\\p{N}])`, 'iu');
const AU_STRONG_ANCHOR = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation(['Australia', 'Australian', 'AU', 'AUS', ...AU_CITY_NAMES, ...AU_UNAMBIGUOUS_STATES])})(?![\\p{L}\\p{N}])`, 'giu');
const AU_CITY_FOREIGN_NAMESAKE = new RegExp(`(?:${alternation(AU_CITY_NAMES)})\\s*(?:,\\s*|\\s+)(?:${FOREIGN_PLACE_ALTERNATION})(?![\\p{L}\\p{N}])`, 'iu');
const AU_CITY_FOREIGN_CODE_NAMESAKE = new RegExp(`(?:${alternation(AU_CITY_NAMES)})\\s*(,\\s*|\\s+)([a-z](?:\\.?[a-z]){1,2}\\.?)(?![\\p{L}\\p{N}])`, 'iu');
const AU_CITY_FOREIGN_SUBDIVISION_CONNECTOR = new RegExp(
  `(?:${alternation(AU_CITY_NAMES)})\\s*(?:[/|&+\u2013\u2014-]|\\b(?:and|or)\\b)\\s*(?:${alternation([
    ...FOREIGN_SUBDIVISIONS, ...[...FOREIGN_SUBDIVISION_CODES]
      .filter(code => code !== 'WA' && !COMMON_TWO_LETTER_WORDS.has(code)),
  ])})(?![\\p{L}\\p{N}])`,
  'giu',
);
const FOREIGN_COMPOUND_NAMESAKE = /\b(?:Perth\s+and\s+Kinross(?:\s*,?\s*Scotland)?|Newcastle(?:\s+upon\s+Tyne|-under-Lyme|\s*,?\s*County\s+Down)|Sydney\s+Mines|Melbourne\s+Beach|Perth\s+Amboy|Victoria\s+Falls)\b/i;
const UNKNOWN_LOCATION = /\b(?:unknown|unspecified|not specified|multiple locations?)\b/i;
const AU_EXCLUSION = [
  /\b(?:except(?:\s+for)?|excluding|exclude(?:d|s)?|without|but|other than|apart from)\s*[:–—-]?\s*(?:(?:applications?|applicants?|candidates?|residents?)\s+(?:in|for|from)\s+)?(?:Australia|Australian|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /(?:^|[^\p{L}\p{N}])(?:Australia|Australian|AU(?:S)?)(?:\s+is)?(?:[^\p{L}\p{N}]+)(?:excluded|not included|not eligible|ineligible|not available|unavailable|not supported|unsupported|not open)(?![\p{L}\p{N}])/iu,
  /\bno\s+(?:hiring|roles?|jobs?|positions?|candidates?|availability)(?:\s+(?:are\s+)?available)?\s+(?:in|for|from)\s+(?:Australia|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /\bno\s+(?:applicants?|applications?|residents?)\s+(?:in|for|from)\s+(?:Australia|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /\b(?:we\s+)?do(?:es)?(?:\s+not|n['’]t)\s+hire\s+(?:in|for|from)\s+(?:Australia|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /\b(?:we\s+)?(?:are\s+not|aren['’]t)\s+hiring\s+(?:in|for|from)\s+(?:Australia|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /\b(?:we\s+)?can(?:not|['’]t)\s+hire\s+(?:in|for|from)\s+(?:Australia|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /\b(?:we\s+)?(?:are\s+)?unable\s+to\s+(?:hire|employ)(?:\s+(?:applicants?|candidates?|residents?))?\s+(?:in|for|from)\s+(?:Australia|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /\b(?:we\s+)?(?:(?:do(?:es)?(?:\s+not|n['’]t)\s+(?:accept|consider))|(?:(?:are|is)\s+not|aren['’]t|isn['’]t)\s+(?:accepting|considering))\s+(?:applications?|applicants?|candidates?)\s+(?:in|for|from)\s+(?:Australia|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /\b(?:applications?|applicants?|candidates?|residents?)\s+(?:(?:are|will\s+be)\s+)?not\s+(?:being\s+)?(?:accepted|considered)\s+(?:in|for|from)\s+(?:Australia|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /\b(?:just\s+)?not\s+(?:Australia|Australian|AU(?:S)?)(?![-\p{L}\p{N}])/iu,
  /\b(?:just\s+)?not\s+in\s+(?:Australia|AU(?:S)?)(?![-\p{L}\p{N}])/iu,
  /\b(?:not available|not eligible|not hiring|unavailable|ineligible)\s+(?:(?:to\s+)?candidates?\s+)?(?:in|for|from)\s+(?:Australia|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /\b(?:not available|not open)\s+(?:to|for)\s+(?:applicants?|candidates?)\s+(?:in|for|from)\s+(?:Australia|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /(?:^|[-–—|,;:(]\s*|\bbased\s+)outside(?:\s+of)?\s+(?:Australia|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /\bother than\s+(?:Australia|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /\bnot\s+open\s+to\s+(?:applicants?|candidates?)\s+(?:in|from)\s+(?:Australia|AU(?:S)?)(?![\p{L}\p{N}])/iu,
  /\b(?:applications?|applicants?|candidates?|residents?)\s+(?:(?:based|located)\s+)?(?:in|from|of)\s+(?:Australia|AU(?:S)?)\s+(?:(?:are\s+)?(?:not eligible|ineligible|not considered|not accepted|excluded)|will\s+not\s+be\s+(?:considered|accepted|eligible))(?![\p{L}\p{N}])/iu,
  /\b(?:applicants?|candidates?|residents?)\s+(?:(?:based|located)\s+)?(?:in|from|of)\s+(?:Australia|AU(?:S)?)\s+(?:cannot|can['’]t)\s+(?:apply|be\s+considered)(?![\p{L}\p{N}])/iu,
  /(?:^|[^\p{L}\p{N}])(?:Australia|Australian|AU(?:S)?)(?:[- ]based)?\s+(?:applications?|applicants?|candidates?|residents?)\s+(?:(?:are\s+)?(?:not eligible|ineligible|not considered|not accepted|excluded)|(?:cannot|can['’]t)\s+apply|will\s+not\s+be\s+(?:considered|accepted|eligible))(?![\p{L}\p{N}])/iu,
];

function countryCodes(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map(value => String(value ?? '').trim().toUpperCase()).filter(Boolean))];
}

function excludesAustralia(value) {
  const text = String(value ?? '').normalize('NFKC');
  return AU_EXCLUSION.some(pattern => pattern.test(text));
}

export function hasAustralianLabel(value) {
  const text = String(value ?? '').trim();
  return /\b(?:Australia|Australian)\b/i.test(text) || AU_REGION_CODE.test(text);
}

function hasForeignLocationLabel(value) {
  return FOREIGN_LOCATION_NAME.test(value) || FOREIGN_LOCATION_COMMON_CODE.test(value)
    || FOREIGN_LOCATION_EXACT_CODE.test(value) || FOREIGN_LOCATION_STANDALONE_CODE.test(value)
    || FOREIGN_LOCATION_PUNCTUATED_CODE.test(value);
}

function withoutStreetAddressSuffixCodes(value) {
  return value.replace(STREET_ADDRESS_SUFFIX_CODE, '$1');
}

function hasConnectedForeignSubdivisionNamesake(value) {
  for (const match of value.matchAll(AU_CITY_FOREIGN_SUBDIVISION_CONNECTOR)) {
    const start = match.index ?? 0;
    const remainder = `${value.slice(0, start)} ${value.slice(start + match[0].length)}`;
    if (!hasAustralianMarketSegment(remainder)) return true;
  }
  return false;
}

function hasForeignCityNamesake(value) {
  if (FOREIGN_COMPOUND_NAMESAKE.test(value) || AU_CITY_FOREIGN_NAMESAKE.test(value)) return true;
  const city = value.match(AU_CITY);
  if ((city?.index ?? 0) > 0 && hasForeignLocationLabel(value.slice(0, city.index))) return true;
  const match = value.match(AU_CITY_FOREIGN_CODE_NAMESAKE);
  const supplied = match?.[2] ?? '';
  const code = supplied.replace(/\./g, '').toUpperCase();
  const explicitlyCased = supplied === supplied.toUpperCase();
  const dotted = supplied.includes('.');
  const beforeCity = match ? value.slice(0, match.index) : '';
  const streetSuffix = STREET_SUFFIX_CODES.has(code) && !match?.[1].includes(',')
    && (!explicitlyCased || /\b\d+[A-Za-z]?\s*$/.test(beforeCity));
  const safelyCodeLike = !streetSuffix
    && (explicitlyCased || dotted || !COMMON_TWO_LETTER_WORDS.has(code));
  return Boolean(code && safelyCodeLike
    && (REGION_CODES.has(code) || FOREIGN_SUBDIVISION_CODES.has(code)));
}

function hasForeignAfterLastAustralianAnchor(value) {
  let anchorEnd = -1;
  let anchorStart = -1;
  for (const match of value.matchAll(AU_STRONG_ANCHOR)) {
    const end = (match.index ?? 0) + match[0].length;
    if (end > anchorEnd) {
      anchorEnd = end;
      anchorStart = match.index ?? 0;
    }
  }
  if (anchorEnd < 0) return true;
  const remainder = value.slice(anchorEnd);
  const streetSuffix = /^\s+(?:St|Rd|Dr|Ct|Pl|Ln|Av)\.?$/u.test(remainder)
    || (/^\s+(?:ST|RD|DR|CT|PL|LN|AV)\.?$/u.test(remainder)
      && /\d/.test(value.slice(0, anchorStart)));
  return !streetSuffix && hasForeignLocationLabel(remainder);
}

function hasAustralianMarketSegment(value) {
  const segment = String(value ?? '').trim();
  return /\bAustralia\b/i.test(segment) || AU_REGION_CODE.test(segment)
    || /(?:^|[-–—|/(,:;]\s*)(?:the\s+)?Australian(?:\s+(?:market|region|remote|based|only))?$/i.test(segment)
    || AU_CITY.test(segment) || AU_UNAMBIGUOUS_STATE.test(segment);
}

function hasExplicitMixedAustralianMarket(value) {
  if (FOREIGN_COMPOUND_NAMESAKE.test(value)) return false;
  let segments = value.split(/\s*(?:\/|\||;|&|\+|\bor\b|\band\b)\s*/i).filter(Boolean);
  if (segments.length < 2) {
    const commaSegments = value.split(/\s*,\s*/).filter(Boolean);
    const hasExplicitAustralianCountry = commaSegments.some(segment => /\bAustralia\b/i.test(segment) || AU_REGION_CODE.test(segment));
    const australianCityCount = commaSegments.filter(segment => AU_CITY.test(segment)).length;
    if (/^multiple locations?\s*:/i.test(value) || hasExplicitAustralianCountry || australianCityCount >= 2) {
      segments = commaSegments;
    }
  }
  if (segments.length < 2) return false;
  const australian = segments.some(hasAustralianMarketSegment);
  return australian && segments.some(segment => hasForeignLocationLabel(segment));
}

function hasMetadataTitlePrefix(value, codes) {
  const foreignCodes = codes.filter(code => !AU_COUNTRY_CODES.has(code)
    && !ROLE_ACRONYM_CODES.has(code) && /^[A-Z]{2,3}$/.test(code));
  if (!foreignCodes.length) return false;
  return new RegExp(
    `^(?:(?:Remote|Hybrid|On[- ]?site)\\s+)?(?:${alternation(foreignCodes)})(?:[- ]?based|\\s+(?:only|remote|hybrid|on[- ]?site|office|region))?\\s+(?=\\S)`,
  ).test(value);
}

function hasMetadataTitleSuffixCode(value, codes) {
  const foreignCodes = codes.filter(code => !AU_COUNTRY_CODES.has(code));
  if (!foreignCodes.length) return false;
  const match = value.match(/(?:\s[-–—|]\s*|,\s+|\s*(?:\(|\[)\s*)([^\r\n]{2,64}?)(?:\)|\])?$/u);
  const suffix = match?.[1]?.trim();
  return Boolean(suffix && /^[A-Z]{2,3}$/.test(suffix) && foreignCodes.includes(suffix));
}

function codeTitleQualifier(value, values, flags) {
  const suffix = titleQualifierPattern(values, flags).test(value);
  const prefix = new RegExp(`^(?:(?:remote|hybrid|on[- ]?site)\\s+)?(?:${values})(?:[- ]?based|\\s+remote|\\s+hybrid|\\s+on[- ]?site)?\\s+${TITLE_MARKET_DETAIL}${TITLE_SENIORITY}(?=${TITLE_ROLE_WORD}\\b)`, flags).test(value);
  return suffix || prefix;
}

function titleCodeQualifier(value, codes) {
  const candidates = new Set(REGION_CODES);
  for (const code of codes) {
    if (!AU_COUNTRY_CODES.has(code) && !ROLE_ACRONYM_CODES.has(code) && /^[A-Z]{2,3}$/.test(code)) candidates.add(code);
  }
  const codeAlternation = alternation(candidates);
  return codeTitleQualifier(value, alternation(COMMON_MARKET_CODES), 'i')
    || codeTitleQualifier(value, codeAlternation, '');
}

function hasForeignTitleLabel(value, codes) {
  return FOREIGN_TITLE_QUALIFIER.test(value) || FOREIGN_TITLE_PREFIX.test(value) || FOREIGN_TITLE_GENERIC_PREFIX.test(value)
    || FOREIGN_TITLE_CONNECTED_SUFFIX.test(value) || FOREIGN_TITLE_CONNECTED_PREFIX.test(value)
    || hasMetadataTitlePrefix(value, codes) || hasMetadataTitleSuffixCode(value, codes)
    || titleCodeQualifier(value, codes);
}

function isSupportedAmbiguousState(value) {
  const place = value.replace(/\b(?:remote|hybrid|on[- ]?site|based|office|region|only|residents?|applicants?|preferred|first|in|within|from|work)\b/gi, ' ')
    .replace(/[-–—|/:;,()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:Victoria|SA|WA|NT)$/i.test(place);
}

export function australianLocation(name, countries = []) {
  const value = String(name ?? '').normalize('NFKC').trim();
  if (!value || excludesAustralia(value)
    || (UNKNOWN_LOCATION.test(value) && !/^multiple locations?\b/i.test(value))) return false;
  const geographyValue = withoutStreetAddressSuffixCodes(value);
  const codes = countryCodes(countries);
  const hasAustralianCountry = codes.some(code => AU_COUNTRY_CODES.has(code));
  const hasForeignCountry = codes.some(code => !AU_COUNTRY_CODES.has(code));
  if (!hasAustralianCountry && codes.length) return false;
  const hasMixedAustralianMarket = hasExplicitMixedAustralianMarket(geographyValue);
  const hasCity = AU_CITY.test(geographyValue);
  const hasUnambiguousState = AU_UNAMBIGUOUS_STATE.test(geographyValue);
  const hasAmbiguousState = AU_AMBIGUOUS_STATE.test(geographyValue);
  const hasForeignLocation = hasForeignLocationLabel(geographyValue);
  if (hasConnectedForeignSubdivisionNamesake(geographyValue)) return false;
  if (hasForeignCityNamesake(geographyValue) && !hasMixedAustralianMarket) return false;
  if (hasForeignLocation && !hasMixedAustralianMarket && hasForeignAfterLastAustralianAnchor(geographyValue)) return false;
  if (hasAustralianLabel(geographyValue) || hasCity || hasUnambiguousState) return true;
  if (hasAmbiguousState) {
    return hasAustralianCountry && !hasForeignCountry && isSupportedAmbiguousState(geographyValue);
  }
  return hasAustralianCountry && (NEUTRAL_REMOTE_LOCATION.test(value) || !hasForeignCountry);
}

export function visibleGeographySupportsAustralia({title, location, countries = []}) {
  const visibleTitle = String(title ?? '').normalize('NFKC').trim();
  const visibleLocation = String(location ?? '').normalize('NFKC').trim();
  const codes = countryCodes(countries);
  if (excludesAustralia(visibleTitle) || excludesAustralia(visibleLocation)) return false;
  if (hasConnectedForeignSubdivisionNamesake(visibleTitle)) return false;
  const mixedAustralianTitle = hasExplicitMixedAustralianMarket(visibleTitle);
  if (hasForeignCityNamesake(visibleTitle) && !mixedAustralianTitle) return false;
  const hasForeignTitle = hasForeignTitleLabel(visibleTitle, codes);
  if (hasForeignTitle && !mixedAustralianTitle) return false;
  return australianLocation(visibleLocation, codes);
}
