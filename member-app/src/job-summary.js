const pointText = (point) => typeof point === "string" ? point : point?.text || "";
const list = (items) => new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(items);

export function jobBrief(job) {
  const text = String(job.description || "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*#_`]/g, "")
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-•]\s*/, "").trim())
    .filter((line) => line.length > 0 && !line.endsWith(":") && line.toLowerCase() !== String(job.title || "").toLowerCase())
    .join(" ");
  if (!text) return "A job overview is not available. Open the original listing for details.";
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text];
  let brief = sentences[0].trim();
  if (sentences[1] && brief.length + sentences[1].length < 480) brief += ` ${sentences[1].trim()}`;
  if (brief.length > 480) brief = `${brief.slice(0, 477).replace(/\s+\S*$/, "")}…`;
  return brief;
}

export function matchSummary(match) {
  if (!match) return { fit: "A match assessment is not available yet.", gaps: "Review the job requirements against your experience before applying." };
  const matches = (match.matches || []).map(pointText).filter(Boolean);
  const skills = matches.map((text) => text.match(/^(.+) appears in your resume and the job requirements\.$/)?.[1]).filter(Boolean);
  const fit = skills.length
    ? `Your resume shows ${list(skills.slice(0, 5))}${skills.length > 5 ? ` and ${skills.length - 5} other matching skills` : ""} required by this role.`
    : matches[0] || "No supporting match evidence is recorded.";
  const gaps = (match.gaps || []).map(pointText).filter(Boolean);
  const missing = gaps.map((text) => text.match(/^(.+) is not evidenced in your resume\.$/)?.[1]).filter(Boolean);
  const other = gaps.filter((text) => !/^(.+) is not evidenced in your resume\.$/.test(text));
  const unknown = (match.needsConfirmation || []).map(pointText).filter(Boolean);
  const standardQuestions = new Map([
    ["Confirm any citizenship or residency restrictions with the employer.", "citizenship or residency restrictions"],
    ["Confirm sponsorship and work-rights eligibility with the employer.", "sponsorship and work rights"],
    ["Confirm whether this role has a clearance requirement.", "security clearance"],
  ]);
  const topics = unknown.filter((text) => standardQuestions.has(text)).map((text) => standardQuestions.get(text));
  const parts = [
    ...(missing.length ? [`Your resume does not yet evidence ${list(missing)}.`] : []),
    ...other,
    ...(!gaps.length ? ["No specific gaps are recorded."] : []),
    ...(topics.length ? [`Confirm ${list(topics)} with the employer.`] : []),
    ...unknown.filter((text) => !standardQuestions.has(text)),
  ];
  return { fit, gaps: parts.join(" ") };
}
