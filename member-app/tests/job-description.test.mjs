import test from "node:test";
import assert from "node:assert/strict";
import { processJobDescription } from "../src/job-description.js";

const screenshotDescription = `*Software Engineer*

*We’re currently looking for a Software Engineer to join Pixel Pioneers, an Australian boutique firm building gaming and e-commerce products.*

*In this role, you will work closely with the Engineering Manager and guide engineering and design teams through execution.*

Please note: This position requires office attendance 4 days a week in Perth, with Friday WFH flexibility.

*Key responsibilities will include:*

* Developing and maintaining backend services and frontend frameworks using TypeScript and JavaScript with React or Vue.
* Refactoring and scaling large existing codebases and monorepos.
* Translating Figma designs into performant interfaces.

*What you will bring to the role:*

* 1-3 years of commercial experience and solid engineering fundamentals.
* Daily hands-on experience with Git, pull requests, and peer code reviews.
* Based in Perth and available to work in our office four days a week.

*About VGW*

VGW is an interactive entertainment company.`;

test("formats screenshot-style Markdown into a role overview and grouped key points", () => {
  const job = { title: "Software Engineer", company: "VGW", description: screenshotDescription };
  const result = processJobDescription(job);
  assert.equal(result.sourceAvailable, true);
  assert.match(result.overview.join(" "), /Pixel Pioneers/);
  assert.doesNotMatch(JSON.stringify(result), /\*Software Engineer\*/);
  assert.deepEqual(result.sections.map((section) => section.kind), ["work", "responsibilities", "requirements", "company"]);
  const work = result.sections.find((section) => section.kind === "work");
  assert.match([...work.paragraphs, ...work.items].join(" "), /4 days a week in Perth/);
  assert.match([...work.paragraphs, ...work.items].join(" "), /Based in Perth/);
  assert.equal(result.sections.find((section) => section.kind === "responsibilities").items.length, 3);
  assert.equal(job.description, screenshotDescription);
});

test("converts safe HTML structure and removes executable or embedded blocks", () => {
  const result = processJobDescription({
    title: "Engineer",
    description: `<h2>Responsibilities</h2><ul><li>Build React interfaces &amp; APIs.</li></ul><script>window.evil=1</script><style>body{display:none}</style><iframe src="https://evil.test">secret</iframe><h2>Requirements</h2><p>Three years of experience required.</p>`,
  });
  const output = JSON.stringify(result);
  assert.match(output, /Build React interfaces & APIs/);
  assert.match(output, /Three years of experience required/);
  assert.doesNotMatch(output, /window\.evil|display:none|evil\.test|secret|<script|<iframe/);

  const inline = JSON.stringify(processJobDescription({
    description: '<p>Build <strong>React</strong> products with <a href="https://example.com/jobs/1">TypeScript</a>.</p>',
  }));
  assert.match(inline, /Build React products with TypeScript\./);
  assert.doesNotMatch(inline, /TypeScript \./);
});

test("classifies useful sentences in an unstructured plain-text description", () => {
  const result = processJobDescription({
    description: "Build and maintain TypeScript services. Five years of commercial experience is required. This is a hybrid full-time role with two office days each week. A learning allowance is included.",
  });
  assert.deepEqual(result.sections.map((section) => section.kind), ["work", "responsibilities", "requirements", "benefits"]);
  assert.match(result.sections.find((section) => section.kind === "responsibilities").items[0], /Build and maintain/);
  assert.match(result.sections.find((section) => section.kind === "requirements").items[0], /Five years/);
});

test("preserves facts that contain heading keywords instead of discarding them as headings", () => {
  const result = processJobDescription({
    description: "Location: Sydney\nVisa sponsorship is available.\nResponsibilities include building APIs.",
  });
  const output = JSON.stringify(result);
  assert.match(output, /Location: Sydney/);
  assert.match(output, /Visa sponsorship is available/);
  assert.match(output, /Responsibilities include building APIs/);
  const workText = Object.values(result.sections.find((section) => section.kind === "work"))
    .flat()
    .join(" ");
  assert.match(workText, /Location: Sydney/);
  assert.match(result.sections.find((section) => section.kind === "responsibilities").items.join(" "), /building APIs/);
});

test("still recognises plain unmarked section headings", () => {
  const result = processJobDescription({
    description: "About the role\nJoin a product team building reliable services.\nResponsibilities\nBuild accessible React interfaces.\nRequirements\nThree years of TypeScript experience.",
  });
  assert.match(result.overview.join(" "), /Join a product team/);
  assert.match(result.sections.find((section) => section.kind === "responsibilities").paragraphs.join(" "), /Build accessible React/);
  assert.match(result.sections.find((section) => section.kind === "requirements").paragraphs.join(" "), /Three years/);
});

test("keeps every terse bullet under common plain-text requirement headings", () => {
  for (const heading of ["Skills", "Key requirements", "Essential selection criteria", "What you'll need"]) {
    const result = processJobDescription({ description: `${heading}\n- React\n- TypeScript\n- AWS\n- SQL` });
    const requirements = result.sections.find((section) => section.kind === "requirements");
    assert.deepEqual(requirements?.items, ["React", "TypeScript", "AWS", "SQL"], heading);
  }
});

test("keeps every headingless terse bullet in Other details", () => {
  const result = processJobDescription({ description: "- React\n- TypeScript\n- AWS\n- SQL" });
  const other = result.sections.find((section) => section.kind === "other");
  assert.deepEqual(other?.items, ["React", "TypeScript", "AWS", "SQL"]);
});

test("does not consume factual lines as headings merely because bullets follow", () => {
  const cases = [
    {
      description: "Visa sponsorship is not available\n- React\n- TypeScript",
      fact: /Visa sponsorship is not available/,
      bullets: ["React", "TypeScript"],
    },
    {
      description: "Salary $120,000\n- Superannuation included\n- Learning allowance",
      fact: /Salary \$120,000/,
      bullets: ["Superannuation included", "Learning allowance"],
    },
    {
      description: "Responsibilities include API development\n- Build services\n- Review code",
      fact: /Responsibilities include API development/,
      bullets: ["Build services", "Review code"],
    },
  ];
  for (const entry of cases) {
    const result = processJobDescription({ description: entry.description });
    const output = JSON.stringify(result);
    assert.match(output, entry.fact);
    for (const bullet of entry.bullets) assert.match(output, new RegExp(bullet));
  }
});

test("keeps decimals, dotted technology names and abbreviations intact", () => {
  const result = processJobDescription({
    description: "You need 1.5 years of experience. Build Node.js services. Use e.g. React for interfaces. AWS Lambda (e.g. Node.js runtimes) supports delivery.",
  });
  const output = JSON.stringify(result);
  assert.match(output, /1\.5 years/);
  assert.match(output, /Build Node\.js services/);
  assert.match(output, /Use e\.g\. React/);
  assert.match(output, /AWS Lambda \(e\.g\. Node\.js runtimes\)/);
  assert.doesNotMatch(output, /"5 years/);
});

test("keeps Australian place names with dotted abbreviations intact", () => {
  const result = processJobDescription({
    description: "Based in St. Leonards, NSW. Build reliable systems. Work with teams in St. Kilda and Mt. Gravatt.",
  });
  const output = JSON.stringify(result);
  assert.match(output, /Based in St\. Leonards, NSW\./);
  assert.match(output, /St\. Kilda and Mt\. Gravatt/);
  assert.doesNotMatch(output, /Based in St\."/);
});

test("does not confuse technical uses of office or remote with workplace setup", () => {
  const result = processJobDescription({
    description: "Proficiency with Microsoft Office is required. Develop Office 365 integrations and support users. Build remote-control software for laboratory devices.",
  });
  const work = result.sections.find((section) => section.kind === "work");
  assert.equal(work, undefined);
  assert.match(result.sections.find((section) => section.kind === "requirements").items.join(" "), /Microsoft Office/);
  const responsibilities = result.sections.find((section) => section.kind === "responsibilities").items.join(" ");
  assert.match(responsibilities, /Office 365/);
  assert.match(responsibilities, /remote-control software/);
});

test("classifies complete word forms and keeps emphasised eligibility facts", () => {
  const result = processJobDescription({
    description: "*Must have React experience*\n**Visa sponsorship is not available**\n_Hybrid role in Sydney_\n*Competitive salary*\n**Join our engineering team**\nProficiency in TypeScript.\nCollaborating with designers and engaging with users.",
  });
  const output = JSON.stringify(result);
  assert.match(output, /Must have React experience/);
  assert.match(output, /Visa sponsorship is not available/);
  assert.match(output, /Hybrid role in Sydney/);
  assert.match(output, /Competitive salary/);
  assert.match(output, /Join our engineering team/);
  const workText = Object.values(result.sections.find((section) => section.kind === "work")).flat().join(" ");
  assert.match(workText, /sponsorship/);
  assert.match(result.sections.find((section) => section.kind === "requirements").items.join(" "), /Proficiency/);
  assert.match(result.sections.find((section) => section.kind === "responsibilities").items.join(" "), /Collaborating/);
});

test("keeps factual Markdown and HTML headings as visible key points", () => {
  const result = processJobDescription({
    description: "<h3>Salary $120,000</h3>\n## Hybrid role – 3 office days\n## Responsibilities\nBuild APIs.",
  });
  const output = JSON.stringify(result);
  assert.match(output, /Salary \$120,000/);
  assert.match(output, /Hybrid role – 3 office days/);
  assert.match(result.sections.find((section) => section.kind === "responsibilities").paragraphs.join(" "), /Build APIs/);
});

test("keeps code-like angle brackets while removing recognised HTML markup", () => {
  const result = processJobDescription({
    description: "<p>Build React <Suspense> boundaries with Array<T>, Array<string>, Promise<void>, Record<string, object>, List<int>, f<T extends React.Component>, Map<string, Array<number>>, Dictionary<string, List<int>>, Promise<Result<User>>, and Foo<T = string> utilities.</p><p>Integrate A < B and C > D safely.</p><img src=x onerror=alert(1)>",
  });
  const output = JSON.stringify(result);
  assert.match(output, /React <Suspense>/);
  assert.match(output, /Array<T>/);
  assert.match(output, /Array<string>/);
  assert.match(output, /Promise<void>/);
  assert.match(output, /Record<string, object>/);
  assert.match(output, /List<int>/);
  assert.match(output, /f<T extends React\.Component>/);
  assert.match(output, /Map<string, Array<number>>/);
  assert.match(output, /Dictionary<string, List<int>>/);
  assert.match(output, /Promise<Result<User>>/);
  assert.match(output, /Foo<T = string>/);
  assert.match(output, /A < B and C > D/);
  assert.doesNotMatch(output, /<p>|<img|onerror/);
});

test("turns task lists, fenced examples and Markdown tables into readable key points", () => {
  const result = processJobDescription({
    description: [
      "## Requirements",
      "- [x] AWS",
      "- [ ] React",
      "- ~~SQL~~",
      "- ==TypeScript==",
      "```",
      "* TypeScript delivery experience",
      "```",
      "| Skill | Requirement |",
      "| --- | --- |",
      "| SQL | Required |",
    ].join("\n"),
  });
  const output = JSON.stringify(result);
  assert.match(output, /AWS/);
  assert.match(output, /React/);
  assert.match(output, /SQL/);
  assert.match(output, /TypeScript/);
  assert.match(output, /TypeScript delivery experience/);
  assert.match(output, /Skill — Requirement/);
  assert.match(output, /SQL — Required/);
  assert.doesNotMatch(output, /\[x\]|\[ \]|```|\| ---|\| Skill|~~|==/);

  const compactTable = JSON.stringify(processJobDescription({description: "Tool | Usage\n--- | ---\nNode.js | Services"}));
  assert.match(compactTable, /Tool — Usage/);
  assert.match(compactTable, /Node\.js — Services/);
  assert.doesNotMatch(compactTable, /\|/);
});

test("keeps common technical paths while removing adjacent link destinations", () => {
  const result = processJobDescription({
    description: "Use Node.js/Express, React.js/Next.js, Vue.js/Nuxt, ASP.NET/Core, System.Net/Http, and org.springframework/boot. Learn[more](https://example.test/React/AWS) and See[apply](/React/AWS). Keep arr[0](value).",
  });
  const output = JSON.stringify(result);
  for (const value of ["Node.js/Express", "React.js/Next.js", "Vue.js/Nuxt", "ASP.NET/Core", "System.Net/Http", "org.springframework/boot", "arr[0](value)"]) assert.ok(output.includes(value), value);
  assert.match(output, /Learn more/);
  assert.match(output, /See apply/);
  assert.doesNotMatch(output, /example\.test|\/React\/AWS|Learn\[more\]|See\[apply\]/);
});

test("preserves operators, identifiers, globs and qualified C++ templates", () => {
  const description = "Use 2 * 3 * 4, 2 ** 3 ** 4, 2*3*4, foo*bar*baz, src/*/index*/file, _private, snake_, and std::vector<std::pair<string, int>> in C++ services.";
  const output = JSON.stringify(processJobDescription({description}));
  for (const value of ["2 * 3 * 4", "2 ** 3 ** 4", "2*3*4", "foo*bar*baz", "src/*/index*/file", "_private", "snake_", "std::vector<std::pair<string, int>>"]) assert.ok(output.includes(value), value);
});

test("distinguishes paired underscored identifiers from Markdown emphasis", () => {
  const result = processJobDescription({
    description: "Use Python *args and React _private methods with snake_. Use _emphasis_ only for prose.",
  });
  const output = JSON.stringify(result);
  assert.match(output, /Use Python \*args and React _private methods with snake_\./);
  assert.match(output, /Use emphasis only for prose\./);
  assert.doesNotMatch(output, /_emphasis_/);
});

test("removes hidden source metadata while preserving visible technical examples", () => {
  const hidden = "Australian citizenship is required. React and AWS are mandatory.";
  const result = processJobDescription({
    description: [
      `<template>${hidden}</template>`,
      `<div hidden>${hidden}</div>`,
      `<div aria-hidden="tr&#x75;e">${hidden}</div>`,
      `<div style="display:/**/none">${hidden}</div>`,
      `<font title="${hidden}">Visible employer copy.</font>`,
      `[candidate]: <https://example.test/apply>`,
      `  "${hidden}"`,
      "Security work includes safely escaping `<script>` strings in JavaScript.",
      "> > * [x] ***Build React*** interfaces with ___TypeScript___ and AWS.",
      "Use arr[0](value) when processing application data.",
      "<img hidden src=x> Continue with visible delivery documentation.",
    ].join("\n"),
  });
  const output = JSON.stringify(result);
  assert.match(output, /Visible employer copy/);
  assert.match(output, /escaping <script> strings/);
  assert.match(output, /Build React interfaces with TypeScript and AWS/);
  assert.match(output, /arr\[0\]\(value\)/);
  assert.match(output, /Continue with visible delivery documentation/);
  assert.doesNotMatch(output, /Australian citizenship|aria-hidden|display:|candidate|example\.test|\[x\]|\*\*\*/);
});

test("removes hidden styles encoded with browser character references", () => {
  const styles = [
    "display&colon;none",
    "display&Tab;:none",
    "display&NewLine;:none",
    "display&bsol;3a none",
    "display&sol;&ast;&ast;&sol;:none",
    "display&#58:none",
    "display&#x3a:none",
    "d&#105splay:none",
  ];
  const hidden = styles.map((style, index) => `<p style="${style}">Encoded hidden ${index}: Australian citizenship and Python.</p>`);
  const result = processJobDescription({
    description: [...hidden, "<p>Visible TypeScript delivery work remains available.</p>"].join("\n"),
  });
  const output = JSON.stringify(result);
  assert.match(output, /Visible TypeScript delivery work remains available/);
  assert.doesNotMatch(output, /Encoded hidden|Australian citizenship|Python|display&/);
});

test("removes Markdown image decoration before processing its alt text", () => {
  const result = processJobDescription({
    description: "![Company logo](https://example.test/logo.png) Build accessible products.",
  });
  const output = JSON.stringify(result);
  assert.match(output, /Company logo Build accessible products/);
  assert.doesNotMatch(output, /!Company logo|example\.test/);
});

test("does not duplicate one unstructured work-setup sentence inside its key-point card", () => {
  const result = processJobDescription({ description: "This is a hybrid role." });
  const work = result.sections.find((section) => section.kind === "work");
  const occurrences = [...work.paragraphs, ...work.items].filter((value) => value === "This is a hybrid role.");
  assert.equal(occurrences.length, 1);
});

test("returns an accessible empty state contract for missing or unsafe-only input", () => {
  assert.deepEqual(processJobDescription({}), { overview: [], sections: [], sourceAvailable: false });
  assert.deepEqual(processJobDescription({ description: "<script>alert(1)</script>" }), { overview: [], sections: [], sourceAvailable: false });
});

test("preserves literal asterisks, bounds long output and returns fresh deterministic data", () => {
  const description = `## Details\nUse 2 * 3 worker groups when testing.\n${"A long requirement with useful context ".repeat(80)}`;
  const job = { description };
  const first = processJobDescription(job);
  const second = processJobDescription(job);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(job.description, description);
  assert.match(JSON.stringify(first), /2 \* 3/);
  assert.ok(first.overview.every((paragraph) => paragraph.length <= 560));
  assert.ok(first.sections.every((section) => section.items.length <= 8 && section.paragraphs.length <= 2));
  assert.ok(first.sections.flatMap((section) => section.items).every((item) => item.length <= 320));
});
