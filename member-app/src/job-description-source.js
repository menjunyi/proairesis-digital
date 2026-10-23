import { HTML_ENTITIES } from "@xmldom/xmldom/lib/entities.js";

const UNSAFE_TAGS = new Set(["script", "style", "iframe", "object", "embed", "svg", "noscript", "template", "head", "title"]);
const INERT_TAGS = new Set(["audio", "button", "canvas", "datalist", "form", "map", "meter", "optgroup", "option", "picture", "progress", "select", "textarea", "video"]);
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const PRESENTATION_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "audio", "b", "base", "bdi", "bdo", "blockquote", "body", "br", "button", "canvas", "caption", "cite", "code", "col", "colgroup",
  "data", "datalist", "dd", "del", "details", "dialog", "div", "dl", "dt", "em", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
  "head", "header", "hr", "html", "i", "img", "input", "ins", "kbd", "label", "legend", "li", "link", "main", "map", "mark", "menu", "meta", "meter", "nav", "ol", "optgroup",
  "option", "output", "p", "picture", "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "section", "select", "slot", "small", "source", "span", "strong", "sub",
  "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr",
]);
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "body", "caption", "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "head", "header", "html", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);
const TAG_SOURCE = String.raw`<\/?([A-Za-z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>`;
const OPENING_TAG_SOURCE = String.raw`<([A-Za-z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>`;
const componentSpelling = (name, lower) => name !== name.toUpperCase() && name === `${lower[0].toUpperCase()}${lower.slice(1)}`;
const LEGACY_ENTITY_NAMES = new Set([
  "AElig", "AMP", "Aacute", "Acirc", "Agrave", "Aring", "Atilde", "Auml", "COPY", "Ccedil", "ETH", "Eacute", "Ecirc", "Egrave", "Euml", "GT", "Iacute", "Icirc", "Igrave", "Iuml", "LT", "Ntilde", "Oacute", "Ocirc", "Ograve", "Oslash", "Otilde", "Ouml", "QUOT", "REG", "THORN", "Uacute", "Ucirc", "Ugrave", "Uuml", "Yacute",
  "aacute", "acirc", "acute", "aelig", "agrave", "amp", "aring", "atilde", "auml", "brvbar", "ccedil", "cedil", "cent", "copy", "curren", "deg", "divide", "eacute", "ecirc", "egrave", "eth", "euml", "frac12", "frac14", "frac34", "gt", "iacute", "icirc", "iexcl", "igrave", "iquest", "iuml", "laquo", "lt", "macr", "micro", "middot", "nbsp", "not", "ntilde", "oacute", "ocirc", "ograve", "ordf", "ordm", "oslash", "otilde", "ouml", "para", "plusmn", "pound", "quot", "raquo", "reg", "sect", "shy", "sup1", "sup2", "sup3", "szlig", "thorn", "times", "uacute", "ucirc", "ugrave", "uml", "uuml", "yacute", "yen", "yuml",
]);
const ENTITY_NAME_LIMIT = Math.max(...Object.keys(HTML_ENTITIES).map(name => name.length));
const CONTROL_REPLACEMENTS = new Map([
  [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e], [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021],
  [0x88, 0x02c6], [0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152], [0x8e, 0x017d], [0x91, 0x2018],
  [0x92, 0x2019], [0x93, 0x201c], [0x94, 0x201d], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014], [0x98, 0x02dc],
  [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a], [0x9c, 0x0153], [0x9e, 0x017e], [0x9f, 0x0178],
]);

function decodeCodePoint(value) {
  let point = value;
  if (!Number.isInteger(point) || point === 0 || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff) return "\ufffd";
  point = CONTROL_REPLACEMENTS.get(point) ?? point;
  try { return String.fromCodePoint(point); } catch { return "\ufffd"; }
}

function decodeEntities(value, attribute = false) {
  const text = String(value ?? "");
  if (!text.includes("&")) return text;
  let output = "", index = 0;
  while (index < text.length) {
    const ampersand = text.indexOf("&", index);
    if (ampersand < 0) return output + text.slice(index);
    output += text.slice(index, ampersand);
    let cursor = ampersand + 1;
    if (text[cursor] === "#") {
      cursor += 1;
      const hexadecimal = text[cursor] === "x" || text[cursor] === "X";
      if (hexadecimal) cursor += 1;
      const digits = cursor;
      const validDigit = hexadecimal ? /[\da-f]/i : /\d/;
      while (cursor < text.length && validDigit.test(text[cursor])) cursor += 1;
      if (cursor === digits) {
        output += "&";
        index = ampersand + 1;
        continue;
      }
      const point = Number.parseInt(text.slice(digits, cursor), hexadecimal ? 16 : 10);
      if (text[cursor] === ";") cursor += 1;
      output += decodeCodePoint(point);
      index = cursor;
      continue;
    }

    let end = cursor;
    while (end < text.length && end - cursor < ENTITY_NAME_LIMIT && /[\da-z]/i.test(text[end])) end += 1;
    let matched = false;
    for (let candidateEnd = end; candidateEnd > cursor; candidateEnd -= 1) {
      const name = text.slice(cursor, candidateEnd);
      if (!Object.hasOwn(HTML_ENTITIES, name)) continue;
      const semicolon = text[candidateEnd] === ";";
      if (!semicolon && !LEGACY_ENTITY_NAMES.has(name)) continue;
      if (attribute && !semicolon && /[=\da-z]/i.test(text[candidateEnd] ?? "")) continue;
      output += HTML_ENTITIES[name];
      index = candidateEnd + (semicolon ? 1 : 0);
      matched = true;
      break;
    }
    if (matched) continue;
    output += "&";
    index = ampersand + 1;
  }
  return output;
}

function hasHiddenAttributes(tail) {
  const normalized = decodeEntities(tail, true).replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([\da-f]{1,6})[ \t\r\n\f]?/gi, (match, point) => {
      try { return String.fromCodePoint(Number.parseInt(point, 16)); } catch { return ""; }
    })
    .replace(/\\([^\r\n\f])/g, "$1");
  // A missing numeric-reference semicolon can leave both the decoded colon and the literal delimiter.
  return /(?:^|\s)hidden(?:\s|=|$)/i.test(normalized)
    || /\baria-hidden\s*=\s*(?:"true"|'true'|true)(?:\s|$)/i.test(normalized)
    || /\bstyle\s*=\s*(?:"[^"]*(?:display\s*:+\s*none|visibility\s*:+\s*hidden)[^"]*"|'[^']*(?:display\s*:+\s*none|visibility\s*:+\s*hidden)[^']*'|[^\s>]*(?:display\s*:+\s*none|visibility\s*:+\s*hidden)[^\s>]*)/i.test(normalized);
}

function separator(name, closing, structured) {
  if (!structured) return " ";
  const lower = name.toLowerCase();
  if (lower === "li") return closing ? "\n" : "\n- ";
  if (/^h[1-6]$/.test(lower)) return closing ? "\n" : "\n## ";
  if (lower === "br" || lower === "hr" || BLOCK_TAGS.has(lower)) return "\n";
  return " ";
}

function stripUnterminatedTags(input) {
  const text = String(input ?? "");
  let output = "", copyCursor = 0, searchCursor = 0;
  while (searchCursor < text.length) {
    const start = text.indexOf("<", searchCursor);
    if (start < 0) break;
    let nameStart = start + 1;
    if (text[nameStart] === "/") nameStart += 1;
    if (!/[A-Za-z]/.test(text[nameStart] ?? "")) {
      searchCursor = start + 1;
      continue;
    }
    let nameEnd = nameStart + 1;
    while (/[\w-]/.test(text[nameEnd] ?? "")) nameEnd += 1;
    const name = text.slice(nameStart, nameEnd), lower = name.toLowerCase();
    const markerEnd = Math.min(text.length, nameEnd + 512);
    const marker = text.slice(nameEnd, markerEnd);
    const attributeLike = /^\s+(?:(?:hidden|open)\b|["']|[A-Za-z_:][\w:.-]*\s*=)/i.test(marker);
    const probableHtml = name === lower && (UNSAFE_TAGS.has(lower) || INERT_TAGS.has(lower)
      || VOID_TAGS.has(lower) || PRESENTATION_TAGS.has(lower)) || attributeLike;
    if (!probableHtml) {
      searchCursor = start + 1;
      continue;
    }
    let quote = "", end = -1, nested = -1;
    for (let cursor = nameEnd; cursor < text.length; cursor += 1) {
      const character = text[cursor];
      if (quote) {
        if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      else if (character === ">") { end = cursor; break; }
      else if (character === "<") { nested = cursor; break; }
    }
    if (end >= 0) {
      searchCursor = end + 1;
      continue;
    }
    output += `${text.slice(copyCursor, start)} `;
    if (nested < 0) return output;
    copyCursor = nested;
    searchCursor = nested;
  }
  return output + text.slice(copyCursor);
}

function stripMarkup(input, { consumeUnclosed, structured }) {
  let text = stripUnterminatedTags(input).replace(/<!--[\s\S]*?(?:-->|$)/g, " ");
  const attributeTail = (tag, name) => tag.slice(1 + name.length, -1).replace(/\/\s*$/, "").trim();
  const blockEnds = new Map(), blockStacks = new Map(), blockTags = new RegExp(TAG_SOURCE, "g");
  for (let tag = blockTags.exec(text); tag; tag = blockTags.exec(text)) {
    const lower = tag[1].toLowerCase();
    if (tag[0].startsWith("</")) {
      const stack = blockStacks.get(lower);
      const opening = stack?.pop();
      if (opening !== undefined) blockEnds.set(opening, tag.index + tag[0].length);
    } else if (!/\/\s*>$/.test(tag[0]) || !VOID_TAGS.has(lower)) {
      const stack = blockStacks.get(lower) ?? [];
      stack.push(tag.index);
      blockStacks.set(lower, stack);
    }
  }

  let cleaned = "", cursor = 0;
  const openings = new RegExp(OPENING_TAG_SOURCE, "g");
  for (let opening = openings.exec(text); opening; opening = openings.exec(text)) {
    const name = opening[1], lower = name.toLowerCase(), tail = attributeTail(opening[0], name);
    const conditionallyHidden = (lower === "dialog" || lower === "details") && !/(?:^|\s)open(?:\s|=|$)/i.test(decodeEntities(tail, true));
    const unsafe = UNSAFE_TAGS.has(lower) || INERT_TAGS.has(lower) || conditionallyHidden, hidden = hasHiddenAttributes(tail);
    if (!unsafe && !hidden) continue;
    const end = blockEnds.get(opening.index) ?? -1;
    const following = text[opening.index + opening[0].length] ?? "";
    if (!hidden && end < 0 && !tail && componentSpelling(name, lower) && (!following || /^[,.;:!?)]/.test(following))) continue;
    cleaned += `${text.slice(cursor, opening.index)} `;
    if (VOID_TAGS.has(lower) || end < 0 && !consumeUnclosed) {
      cursor = opening.index + opening[0].length;
      openings.lastIndex = cursor;
      continue;
    }
    cursor = end > 0 ? end : text.length;
    openings.lastIndex = cursor;
  }
  text = cleaned + text.slice(cursor);

  const paired = new Set(), stacks = new Map(), tags = new RegExp(TAG_SOURCE, "g");
  for (let tag = tags.exec(text); tag; tag = tags.exec(text)) {
    const lower = tag[1].toLowerCase();
    if (tag[0].startsWith("</")) {
      const stack = stacks.get(lower);
      if (stack?.length) paired.add(stack.pop());
    } else if (!/\/\s*>$/.test(tag[0]) || !VOID_TAGS.has(lower)) {
      const stack = stacks.get(lower) ?? [];
      stack.push(tag.index);
      stacks.set(lower, stack);
    }
  }

  return text.replace(new RegExp(TAG_SOURCE, "g"), (match, name, offset) => {
    const closing = match.startsWith("</"), lower = name.toLowerCase();
    if (closing) return separator(name, true, structured);
    const tail = attributeTail(match, name);
    const known = UNSAFE_TAGS.has(lower) || PRESENTATION_TAGS.has(lower);
    const safeBare = !tail && !paired.has(offset) && !/\/\s*>$/.test(match)
      && ((!known && /^[A-Z][A-Za-z\d]*$/.test(name)) || known && componentSpelling(name, lower));
    return safeBare ? match : separator(name, false, structured);
  });
}

function stripMarkdownDestinations(value) {
  const text = String(value ?? "");
  let output = "", index = 0;
  const closing = (start, open, close) => {
    let depth = 1;
    for (let cursor = start + 1; cursor < text.length; cursor += 1) {
      if (text[cursor] === "\\") { cursor += 1; continue; }
      if (text[cursor] === open) depth += 1;
      else if (text[cursor] === close && --depth === 0) return cursor;
    }
    return -1;
  };
  while (index < text.length) {
    const image = text[index] === "!" && text[index + 1] === "[";
    if (text[index] !== "[" && !image) { output += text[index]; index += 1; continue; }
    const bracket = image ? index + 1 : index;
    const labelEnd = closing(bracket, "[", "]");
    if (labelEnd < 0) { output += text.slice(index); break; }
    if (text[labelEnd + 1] !== "(") {
      output += text.slice(index, labelEnd + 1);
      index = labelEnd + 1;
      continue;
    }
    const destinationEnd = closing(labelEnd + 1, "(", ")");
    if (destinationEnd < 0) { output += text.slice(index); break; }
    const adjacent = !image && index > 0 && /[\p{L}\p{N}_$\])]/u.test(text[index - 1]);
    const destination = text.slice(labelEnd + 2, destinationEnd).trim();
    const linkLike = /^(?:[a-z][a-z\d+.-]*:|\/|#|www\.|(?:[a-z\d-]+\.)+[a-z]{2,}(?:\/|$))/i.test(destination);
    if (adjacent && !linkLike) output += text.slice(index, destinationEnd + 1);
    else output += `${adjacent ? " " : ""}${text.slice(bracket + 1, labelEnd)}`;
    index = destinationEnd + 1;
  }
  return output;
}

function stripMarkdownReferences(value) {
  const definitions = new Set();
  const normalized = (label) => label.trim().replace(/\s+/g, " ").toLowerCase();
  const lines = String(value ?? "").split("\n"), kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    const definition = lines[index].match(/^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*(.*)$/);
    if (!definition) {
      kept.push(lines[index]);
      continue;
    }
    definitions.add(normalized(definition[1]));
    let hasDestination = Boolean(definition[2].trim());
    const next = () => lines[index + 1] ?? "";
    if (!hasDestination && /^[ \t]{0,3}(?:<[^>\n]+>|\S+)[ \t]*$/.test(next())) {
      index += 1;
      hasDestination = true;
    }
    if (/^[ \t]{0,3}(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\))[ \t]*$/.test(next())) index += 1;
    kept.push("");
  }
  let text = kept.join("\n");
  if (!definitions.size) return text;
  text = text.replace(/!?\[([^\]\n]{1,999})\]\[([^\]\n]{0,999})\]/g, (match, label, reference) =>
    definitions.has(normalized(reference || label)) ? label : match);
  return text.replace(/!?\[([^\]\n]{1,999})\](?![[(])/g, (match, label) =>
    definitions.has(normalized(label)) ? label : match);
}

function formatMarkdownBlocks(value) {
  const lines = String(value ?? "").split("\n"), tableRows = new Set(), tableSeparators = new Set();
  const separator = (line) => /^(?:\|\s*)?:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+(?:\s*\|)?$/.test(line.trim());
  for (let index = 0; index < lines.length; index += 1) {
    if (!separator(lines[index])) continue;
    tableSeparators.add(index);
    if (index > 0 && lines[index - 1].includes("|")) tableRows.add(index - 1);
    for (let row = index + 1; row < lines.length && lines[row].trim() && lines[row].includes("|"); row += 1) tableRows.add(row);
  }
  return lines.map((line, index) => {
    const text = line.trim();
    if (/^(?:`{3,}|~{3,})[\w-]*$/.test(text) || tableSeparators.has(index)) return "";
    if (!tableRows.has(index)) return line;
    const cells = text.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()).filter(Boolean);
    return cells.length ? `- ${cells.join(" — ")}` : "";
  }).join("\n");
}

function isTechnicalUnderscorePair(content) {
  const words = String(content ?? "").match(/[A-Za-z$][\w$]*/g) ?? [];
  if (words.length < 3) return false;
  if (!/^[a-z$][\w$]*$/.test(words[0]) || !/^[a-z$][\w$]*$/.test(words.at(-1))) return false;
  const middle = words.slice(1, -1).join(" ");
  return /\b(?:arguments?|attributes?|classes?|columns?|constants?|fields?|functions?|hooks?|identifiers?|keys?|members?|methods?|names?|objects?|parameters?|propert(?:y|ies)|props?|symbols?|tokens?|variables?)\b/i.test(middle);
}

export function stripJobDescriptionEmphasis(value) {
  return String(value ?? "")
    .replace(/(^|[\s([{:])\*\*\*([^*\s](?:[^*\n]*?[^*\s])?)\*\*\*(?=$|[\s)\]},.;:!?])/g, "$1$2")
    .replace(/(^|[\s([{:])___([^_\s](?:[^_\n]*?[^_\s])?)___(?=$|[\s)\]},.;:!?])/g, "$1$2")
    .replace(/(^|[\s([{:])~~([^~\s](?:[^~\n]*?[^~\s])?)~~(?=$|[\s)\]},.;:!?])/g, "$1$2")
    .replace(/(^|[\s([{:])==([^=\s](?:[^=\n]*?[^=\s])?)==(?=$|[\s)\]},.;:!?])/g, "$1$2")
    .replace(/(^|[\s([{:])\*\*([^*\s](?:[^*\n]*?[^*\s])?)\*\*(?=$|[\s)\]},.;:!?])/g, "$1$2")
    .replace(/(^|[\s([{:])__([^_\s](?:[^_\n]*?[^_\s])?)__(?=$|[\s)\]},.;:!?])/g, (match, prefix, content) =>
      /^[a-z][a-z\d_]*$/i.test(content) && !/[A-Z\s]/.test(content) ? match : `${prefix}${content}`)
    .replace(/(^|[\s([{:])\*([^*\s](?:[^*\n]*?[^*\s])?)\*(?=$|[\s)\]},.;:!?])/g, "$1$2")
    .replace(/(^|[\s([{:])_([^_\s](?:[^_\n]*?[^_\s])?)_(?=$|[\s)\]},.;:!?])/g, (match, prefix, content) =>
      /^[a-z][a-z\d]*(?:(?:,\s+|\s+and\s+)[a-z][a-z\d]*)+$/i.test(content) || isTechnicalUnderscorePair(content)
        ? match
        : `${prefix}${content}`);
}

function protectTechnicalContent(value) {
  let text = String(value ?? ""), nonce = 0;
  while (text.includes(`\uE000ROLECLUE_${nonce}_`)) nonce += 1;
  const prefix = `\uE000ROLECLUE_${nonce}_`, suffix = "\uE001", values = [];
  const stash = content => {
    const token = `${prefix}${values.length}${suffix}`;
    values.push(content);
    return token;
  };
  text = text.replace(/<code\b([^>]{0,2048})>([\s\S]*?)<\/code\s*>/gi, (match, attributes, content) =>
    hasHiddenAttributes(attributes) ? match : stash(decodeEntities(content)));
  text = text.replace(/(`+)([\s\S]*?)\1/g, match => stash(decodeEntities(match)));
  let genericOutput = "", genericCursor = 0;
  for (let index = 1; index < text.length; index += 1) {
    if (text[index] !== "<" || !/[A-Za-z0-9_$)\]]/.test(text[index - 1])) continue;
    let depth = 1, end = -1;
    for (let cursor = index + 1; cursor < text.length && cursor - index <= 500; cursor += 1) {
      const character = text[cursor];
      if (character === "\n" || !/[A-Za-z0-9_$.:,[\]\s<>&|?=]/.test(character)) break;
      if (character === "<") depth += 1;
      if (character === ">" && --depth === 0) { end = cursor; break; }
    }
    if (end < 0) continue;
    const match = text.slice(index, end + 1), type = match.slice(1, -1).trim();
    const firstType = type.match(/^[A-Za-z_$][\w$]*/)?.[0]?.toLowerCase();
    if (!firstType || PRESENTATION_TAGS.has(firstType) && firstType !== "object") continue;
    if (UNSAFE_TAGS.has(firstType) && firstType !== "object") continue;
    if (new RegExp(`<\\/${firstType}\\s*>`, "i").test(text.slice(end + 1))) continue;
    genericOutput += text.slice(genericCursor, index) + stash(match);
    genericCursor = end + 1;
    index = end;
  }
  text = genericOutput + text.slice(genericCursor);
  return {
    text,
    restore(output) {
      let restored = String(output ?? "");
      for (let index = 0; index < values.length; index += 1) restored = restored.split(`${prefix}${index}${suffix}`).join(values[index]);
      return restored;
    },
  };
}

export function sanitizeJobDescriptionSource(value, { structured = false } = {}) {
  const protectedContent = protectTechnicalContent(value);
  const raw = stripMarkup(protectedContent.text, { consumeUnclosed: true, structured });
  const decodedContent = protectTechnicalContent(decodeEntities(raw));
  const cleaned = stripMarkup(decodedContent.text, { consumeUnclosed: true, structured });
  return protectedContent.restore(decodedContent.restore(cleaned));
}

export function sanitizeJobDescriptionContent(value, options) {
  const withoutDestinations = stripMarkdownReferences(stripMarkdownDestinations(sanitizeJobDescriptionSource(value, options)))
    .replace(/\b(?:https?|ftp):\/\/[^\s<>"'`]+/gi, " ")
    .replace(/\bmailto:[^\s<>"'`]+/gi, " ")
    .replace(/\bwww\.[^\s<>"'`]+/gi, " ")
    .replace(/\b(?:[a-z\d](?:[a-z\d-]{0,62}[a-z\d])?\.)+(?:com(?:\.au)?|org|net(?:\.au)?|io|ai|dev|jobs|careers|co(?:\.uk|\.au)?|gov\.au|edu\.au|test)\/[^\s<>"'`]*/g, " ")
    .replace(/\b[a-z\d._%+-]+@[a-z\d.-]+\.[a-z]{2,63}\b/gi, " ");
  return formatMarkdownBlocks(withoutDestinations);
}
