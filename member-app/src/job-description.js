const SECTION_DEFINITIONS = {
  responsibilities: { title: "What you'll do", order: 2 },
  requirements: { title: "What they're looking for", order: 3 },
  work: { title: "Work setup and eligibility", order: 1 },
  benefits: { title: "Benefits", order: 4 },
  company: { title: "About the company", order: 5 },
  other: { title: "Other details", order: 6 },
};

const BLOCK_TAGS = /<\/?(?:address|article|aside|blockquote|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|header|hr|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;
const HTML_TAGS = /<\/?(?:a|abbr|audio|b|base|bdi|bdo|body|button|canvas|caption|cite|code|col|colgroup|data|datalist|del|details|dialog|em|head|html|i|img|input|ins|kbd|label|legend|link|map|mark|menu|meta|meter|optgroup|option|output|picture|progress|q|rp|rt|ruby|s|samp|select|slot|small|source|span|strong|sub|summary|sup|template|textarea|time|title|track|u|var|video|wbr)\b[^>]*>/gi;
const UNSAFE_BLOCKS = /<(script|style|iframe|object|embed|svg|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;

function decodeEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    ldquo: "“",
    lsquo: "‘",
    nbsp: " ",
    ndash: "–",
    quot: '"',
    rdquo: "”",
    rsquo: "’",
    lt: "<",
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const point = entity[1].toLowerCase() === "x"
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    if (!Number.isInteger(point) || point < 32 || point > 0x10ffff) return "";
    try {
      return String.fromCodePoint(point);
    } catch {
      return "";
    }
  });
}

function sourceLines(source) {
  return decodeEntities(String(source || "").replace(/\r\n?/g, "\n"))
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(UNSAFE_BLOCKS, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<h[1-6]\b[^>]*>/gi, "\n## ")
    .replace(/<\/h[1-6]\s*>/gi, "\n")
    .replace(BLOCK_TAGS, "\n")
    .replace(HTML_TAGS, " ")
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
}

function cleanInline(value) {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s*/, "")
    .replace(/[\t ]+/g, " ")
    .trim();
}

function comparisonKey(value) {
  return cleanInline(value)
    .toLocaleLowerCase("en-AU")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function clip(value, limit) {
  const text = cleanInline(value);
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit - 1).replace(/\s+\S*$/, "").trimEnd();
  return `${clipped || text.slice(0, limit - 1)}…`;
}

function unique(values, limit, size) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = clip(value, size);
    const key = comparisonKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

const ABBREVIATION_END = /(?:\b(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|approx|inc|pty|ltd|st|mt|rd|ave|hwy|ct|pl|a\.m|p\.m)|\b[A-Z])\.$/i;

function sentenceList(value) {
  const text = cleanInline(value);
  if (!text) return [];
  const sentences = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!/[.!?]/.test(text[index])) continue;
    let end = index + 1;
    while (end < text.length && /[.!?]/.test(text[end])) end += 1;
    if (end < text.length && !/\s/.test(text[end])) {
      index = end - 1;
      continue;
    }
    const candidate = text.slice(start, end).trim();
    if (text[index] === "." && ABBREVIATION_END.test(candidate)) {
      index = end - 1;
      continue;
    }
    if (candidate) sentences.push(candidate);
    while (end < text.length && /\s/.test(text[end])) end += 1;
    start = end;
    index = end - 1;
  }
  const remainder = text.slice(start).trim();
  if (remainder) sentences.push(remainder);
  return sentences;
}

function classifyHeading(value, company) {
  const text = comparisonKey(value);
  const companyKey = comparisonKey(company);
  if (/\b(responsibilit(?:y|ies)|what you will do|what you ll do|your impact|day to day|key duties|duties|role includes)\b/.test(text)) return "responsibilities";
  if (/\b(requirements?|qualifications?|what you will bring|what you ll bring|what we are looking|what we re looking|what you need|what you ll need|about you|experience and skills|skills and experience|skills?|selection criteria|essential criteria|must have|ideal candidate|who you are)\b/.test(text)) return "requirements";
  if (/\b(work setup|work arrangement|working arrangement|location|workplace|work rights|visa|sponsorship|eligibility|security clearance|role details|compensation|salary)\b/.test(text)) return "work";
  if (/\b(benefits?|perks|what we offer|rewards|why join)\b/.test(text)) return "benefits";
  if (/^(about us|about the company|our company|who we are)$/.test(text)) return "company";
  if (text.startsWith("about ") && companyKey && text.includes(companyKey)) return "company";
  if (/\b(role overview|about the role|about the opportunity|the opportunity)\b/.test(text)) return "overview";
  return null;
}

function isRecognisedPlainHeading(value, company) {
  const text = comparisonKey(value);
  const companyKey = comparisonKey(company);
  if (/^(?:key )?(?:responsibility|responsibilities|duties)$/.test(text)) return true;
  if (/^(?:key )?responsibilities (?:will )?include$/.test(text)) return true;
  if (/^(?:what you will do|what you ll do|your impact|day to day|role includes)$/.test(text)) return true;
  if (/^(?:(?:key |essential )?requirements?|qualifications?|about you|must have|ideal candidate|who you are|(?:key |technical |required )?skills|(?:essential |key )?selection criteria|essential criteria)$/.test(text)) return true;
  if (/^(?:what you will bring|what you ll bring)(?: to (?:the )?role)?$/.test(text)) return true;
  if (/^(?:what we are looking for|what we re looking for)(?: in you)?$/.test(text)) return true;
  if (/^(?:what you need|what you ll need)$/.test(text)) return true;
  if (/^(?:experience and skills|skills and experience)$/.test(text)) return true;
  if (/^(?:work setup|work arrangement|working arrangement|location|workplace|work rights|visa|sponsorship|eligibility|security clearance|role details|compensation|salary)$/.test(text)) return true;
  if (/^(?:benefit|benefits|perks|what we offer|rewards|why join)$/.test(text)) return true;
  if (/^(?:about us|about the company|our company|who we are|role overview|about the role|about the opportunity|the opportunity)$/.test(text)) return true;
  return Boolean(text.startsWith("about ") && companyKey && text === `about ${companyKey}`);
}

function headingFromLine(original, cleaned, company) {
  const explicitMarkdown = /^\s*#{1,6}\s+/.test(original);
  const colon = cleaned.endsWith(":");
  const text = cleaned.replace(/:\s*$/, "").trim();
  const kind = classifyHeading(text, company);
  const structuralHeading = explicitMarkdown || colon;
  if (kind && isRecognisedPlainHeading(text, company)) {
    return { kind, title: text };
  }
  if (kind && structuralHeading) {
    return {
      kind,
      title: kind === "overview" ? "Role overview" : SECTION_DEFINITIONS[kind].title,
      content: text,
    };
  }
  const looksLikeHeading = text.length <= 80
    && !/[.!?]$/.test(text)
    && text.split(/\s+/).length <= 10
    && structuralHeading;
  return looksLikeHeading
    ? { kind: "other", title: SECTION_DEFINITIONS.other.title, content: text }
    : null;
}

const WORK_PATTERN = /(?:\b(?:hybrid|work(?:ing)? from home|wfh|on[ -]?site)\b|\b(?:fully |primarily )?remote(?: role| position| work| working| option| arrangement| eligible| within| from|$)|\bwork(?:ing)? remotely\b|\boffice (?:attendance|days?|based|location|presence|work(?:ing)?)\b|\b(?:in|at) (?:the|our|an?) office\b|\bdays? (?:a|per) week\b|\blocation\s*:|\b(?:based|located) in\b|\brelocat(?:e|es|ed|ing|ion)\b|\bvisa\b|\bsponsor(?:ship|ed|ing|s)?\b|\bwork rights?\b|\b(?:australian )?citizen(?:ship)?\b|\bpermanent residen(?:t|ce|cy)\b|\bsecurity clearance\b|\bnv[12]\b|\b(?:salary|compensation)\b|\b(?:full|part)[ -]?time\b)/i;
const REQUIREMENT_PATTERN = /\b(?:required|must|needs? to|minimum|experience|proficien(?:t|cy)|knowledge|skills?|degree|qualifications?|familiar(?:ity)?|ability to|years?|you have|you bring)\b/i;
const RESPONSIBILITY_PATTERN = /\b(?:you will|responsibilit(?:y|ies)|develop(?:s|ed|ing|ment)?|build(?:s|ing|t)?|design(?:s|ed|ing)?|maintain(?:s|ed|ing)?|lead(?:s|ing)?|manage(?:s|d|ment|ing)?|creat(?:e|es|ed|ing)|deliver(?:s|ed|ing|y)?|implement(?:s|ed|ing|ation)?|analys(?:e|es|ed|ing|is)|analyz(?:e|es|ed|ing)|collaborat(?:e|es|ed|ing|ion)|support(?:s|ed|ing)?|review(?:s|ed|ing)?|optimis(?:e|es|ed|ing|ation)|optimiz(?:e|es|ed|ing|ation)|translat(?:e|es|ed|ing|ion)|engag(?:e|es|ed|ing|ement))\b/i;
const BENEFIT_PATTERN = /\b(?:benefits?|bonus|leave|wellbeing|insurance|allowance|discount|pension|superannuation|learning budget)\b/i;

function sectionRecord(kind, title) {
  return {
    kind,
    title: kind === "other" ? title || SECTION_DEFINITIONS.other.title : SECTION_DEFINITIONS[kind].title,
    paragraphs: [],
    items: [],
  };
}

function tokenise(job) {
  const titleKey = comparisonKey(job.title);
  const companyKey = comparisonKey(job.company);
  const tokens = [];
  let current = { kind: "overview", title: "Role overview" };
  const lines = sourceLines(job.description);
  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index];
    const bullet = original.match(/^\s*(?:[-+*•·]|\d+[.)])\s+(.+)$/);
    const withoutHeadingMarker = original.replace(/^\s*#{1,6}\s+/, "");
    const cleaned = cleanInline(bullet ? bullet[1] : withoutHeadingMarker);
    const key = comparisonKey(cleaned.replace(/:\s*$/, ""));
    if (!cleaned || key === titleKey || key === companyKey) continue;
    if (!bullet) {
      let heading = headingFromLine(original, cleaned, job.company);
      const nextIsBullet = /^\s*(?:[-+*•·]|\d+[.)])\s+/.test(lines[index + 1] || "");
      if (!heading && nextIsBullet && cleaned.length <= 80 && cleaned.split(/\s+/).length <= 10 && !/[.!?]$/.test(cleaned)) {
        const kind = classifyHeading(cleaned, job.company);
        if (kind && isRecognisedPlainHeading(cleaned, job.company)) {
          heading = { kind, title: cleaned };
        } else if (!kind) {
          heading = { kind: "other", title: cleaned };
        }
      }
      if (heading) {
        current = heading;
        if (heading.content) {
          tokens.push({
            kind: current.kind,
            heading: current.title,
            type: "paragraph",
            text: heading.content,
          });
        }
        continue;
      }
    }
    tokens.push({
      kind: current.kind,
      heading: current.title,
      type: bullet ? "item" : "paragraph",
      text: cleaned,
    });
  }
  return tokens;
}

export function processJobDescription(job = {}) {
  const original = String(job.description || "");
  const tokens = tokenise({ ...job, description: original });
  if (!tokens.length) return { overview: [], sections: [], sourceAvailable: false };

  const overviewCandidates = [];
  const records = new Map();
  const otherRecords = [];
  const recordFor = (kind, heading) => {
    if (kind === "other") {
      const key = comparisonKey(heading) || "other details";
      let record = otherRecords.find((entry) => comparisonKey(entry.title) === key);
      if (!record) {
        record = sectionRecord("other", clip(heading, 80));
        otherRecords.push(record);
      }
      return record;
    }
    if (!records.has(kind)) records.set(kind, sectionRecord(kind));
    return records.get(kind);
  };

  for (const token of tokens) {
    if (token.kind === "overview") {
      if (token.type === "item") {
        if (WORK_PATTERN.test(token.text)) recordFor("work").items.push(token.text);
        else if (BENEFIT_PATTERN.test(token.text)) recordFor("benefits").items.push(token.text);
        else if (REQUIREMENT_PATTERN.test(token.text)) recordFor("requirements").items.push(token.text);
        else if (RESPONSIBILITY_PATTERN.test(token.text)) recordFor("responsibilities").items.push(token.text);
        else recordFor("other", "Other details").items.push(token.text);
      } else {
        overviewCandidates.push(token.text);
      }
      continue;
    }
    const record = recordFor(token.kind, token.heading);
    record[token.type === "item" ? "items" : "paragraphs"].push(token.text);
  }

  const work = recordFor("work");
  const moveWorkItems = (record) => {
    record.items = record.items.filter((item) => {
      if (!WORK_PATTERN.test(item)) return true;
      work.items.push(item);
      return record.kind === "work";
    });
    record.paragraphs = record.paragraphs.filter((paragraph) => {
      if (!WORK_PATTERN.test(paragraph)) return true;
      work.paragraphs.push(paragraph);
      return record.kind === "work";
    });
  };
  for (const record of [...records.values(), ...otherRecords]) {
    if (record.kind !== "work") moveWorkItems(record);
  }
  const retainedOverview = [];
  for (const paragraph of overviewCandidates) {
    const sentences = sentenceList(paragraph);
    if (sentences.length <= 1) {
      if (WORK_PATTERN.test(paragraph)) work.items.push(paragraph);
      else retainedOverview.push(paragraph);
      continue;
    }
    const retainedSentences = [];
    for (const sentence of sentences) {
      if (WORK_PATTERN.test(sentence)) work.items.push(sentence);
      else retainedSentences.push(sentence);
    }
    if (retainedSentences.length) retainedOverview.push(retainedSentences.join(" "));
  }

  const hasNamedSections = tokens.some((token) => token.kind !== "overview" && token.kind !== "work");
  if (!hasNamedSections) {
    const sentences = retainedOverview.flatMap(sentenceList);
    for (const sentence of sentences) {
      if (BENEFIT_PATTERN.test(sentence)) recordFor("benefits").items.push(sentence);
      else if (REQUIREMENT_PATTERN.test(sentence)) recordFor("requirements").items.push(sentence);
      else if (RESPONSIBILITY_PATTERN.test(sentence)) recordFor("responsibilities").items.push(sentence);
    }
  }

  const overviewSource = retainedOverview.length
    ? retainedOverview
    : overviewCandidates.length
      ? overviewCandidates
      : tokens.map((token) => token.text);
  let overview = unique(overviewSource, 2, 560);
  if (overview.length === 1 && overview[0].length > 260) {
    overview = unique(sentenceList(overview[0]), 2, 560);
  }
  if (!overview.length) {
    const firstRecord = [...records.values(), ...otherRecords].find((record) => record.paragraphs.length || record.items.length);
    overview = firstRecord ? unique([...firstRecord.paragraphs, ...firstRecord.items], 1, 560) : [];
  }

  const sections = [...records.values(), ...otherRecords]
    .map((record) => ({
      ...record,
      paragraphs: unique(record.paragraphs, 2, 560),
      items: unique(record.items, 8, 320),
    }))
    .filter((record) => record.paragraphs.length || record.items.length)
    .sort((a, b) => {
      const aOrder = SECTION_DEFINITIONS[a.kind]?.order ?? SECTION_DEFINITIONS.other.order;
      const bOrder = SECTION_DEFINITIONS[b.kind]?.order ?? SECTION_DEFINITIONS.other.order;
      return aOrder - bOrder;
    })
    .slice(0, 7);

  return { overview, sections, sourceAvailable: true };
}
