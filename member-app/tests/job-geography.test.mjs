import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleGeographySupportsAustralia} from '../server/job-geography.mjs';

const supports = (title, location, countries) => visibleGeographySupportsAustralia({title, location, countries});

test('Australian exclusions take precedence over positive country metadata', () => {
  for (const [title, location] of [
    ['Software Engineer', 'Global (except Australia)'],
    ['Software Engineer', 'Remote - Australia excluded'],
    ['Software Engineer', 'Worldwide, excluding AU'],
    ['Software Engineer', 'Remote; not available in Australia'],
    ['Software Engineer - US (Australia not eligible)', 'Remote'],
    ['Australia excluded - Software Engineer', 'Remote'],
    ['Software Engineer', 'Global except for Australia'],
    ['Software Engineer', 'Everywhere but Australia'],
    ['Software Engineer', 'Australia is not eligible'],
    ['Software Engineer', 'Not available to candidates in Australia'],
    ['Software Engineer', 'Worldwide, excludes: Australia'],
    ['Software Engineer', 'Remote - not open to applicants in Australia'],
    ['AU-based candidates are not eligible - Software Engineer', 'Remote'],
    ['Australian applicants not considered - Software Engineer', 'Remote'],
    ['Software Engineer', 'No roles available in Australia'],
    ['Software Engineer', 'We do not hire in Australia'],
    ['Software Engineer', 'Australia is not included'],
    ['Software Engineer', 'All locations apart from Australia'],
    ['Software Engineer', 'Applicants in Australia are not eligible'],
    ['Software Engineer', 'Candidates from Australia are not eligible'],
    ['Software Engineer', 'We cannot hire in Australia'],
    ['Software Engineer', "We can't hire in Australia"],
    ['Software Engineer', 'We can’t hire in Australia'],
    ['Software Engineer', 'We are unable to hire in Australia'],
    ['Software Engineer', 'We are not accepting applications from Australia'],
    ['Software Engineer', 'Applications are not accepted from Australia'],
    ['Software Engineer', 'We do not accept applicants from Australia'],
    ['Software Engineer', 'Candidates based in Australia are not eligible'],
    ['Software Engineer', 'Applicants located in Australia cannot apply'],
    ['Software Engineer', 'Remote excluding applicants in Australia'],
    ['Software Engineer', 'Not open for applicants in Australia'],
    ['Software Engineer', 'Not available for applicants in Australia'],
    ['Software Engineer', 'Australia-based applicants will not be considered'],
    ['Software Engineer', 'Remote - not Australia'],
    ['Software Engineer', 'Not Australia'],
    ['Software Engineer', 'United States only — not Australia'],
    ['Software Engineer', 'US, not AU'],
    ['Software Engineer', 'Anywhere, just not Australia'],
    ['Software Engineer', 'No applicants from Australia'],
    ['Software Engineer', 'Applicants in Australia cannot apply'],
    ['Software Engineer', 'Based outside of Australia'],
    ['Software Engineer', 'We don’t hire in Australia'],
    ['Software Engineer', 'Applications from Australia will not be accepted'],
    ['Software Engineer', 'Applicants from Australia will not be accepted'],
    ['Software Engineer', 'Residents of Australia are not eligible'],
    ['Software Engineer', 'Australian residents are ineligible'],
    ['Software Engineer', 'Remote, not in Australia'],
    ['Software Engineer', 'Not in Australia'],
    ['Software Engineer', 'We aren’t hiring in Australia'],
    ['Software Engineer', 'Australia not open'],
    ['Software Engineer', 'AU candidates cannot apply'],
  ]) assert.equal(supports(title, location, ['au', 'us']), false, `${title} / ${location}`);

  for (const [title, location] of [
    ['Software Engineer', 'Remote - Australia (no sponsorship)'],
    ['Software Engineer - AU / US', 'Remote'],
    ['Software Engineer [AU/US]', 'Remote'],
    ['[AUS/US] Software Engineer', 'Remote'],
  ]) assert.equal(supports(title, location, ['au', 'us']), true, `${title} / ${location}`);

  for (const location of [
    'We accept applicants from Australia', 'Candidates based in Australia are eligible',
    'Applications are accepted from Australia', 'Remote excluding applicants outside Australia',
    'We cannot sponsor applicants in Australia', 'Remote - Australia (no sponsorship)',
  ]) assert.equal(supports('Software Engineer', location, ['au']), true, location);
});

test('current Australian provider location formats remain eligible', () => {
  const accepted = [
    'Melbourne, Australia; Perth, Australia; Sydney, Australia', 'Sydney, NSW, Australia', 'Sydney CBD Area',
    'West End, Brisbane', 'AUS - QLD - BRISBANE', 'Adelaide - 21 Third Avenue', 'Remote - Australia',
    'Australia, Pyrmont, New South Wales', 'Sydney, Australia Office', 'Sydney, NSW (Hybrid)',
    'Hybrid - Sydney', 'Sydney / Melbourne', 'Brisbane, QLD | Hybrid', 'APAC Remote', 'Remote',
    'AUS', 'Remote - AUS', 'Remote (AU / US)', 'Hybrid', 'On-site',
    'Multiple Locations - Australia', 'Multiple locations: Sydney, Melbourne', 'Sydney or Singapore',
    'Sydney, on-site', 'Sydney - on site', 'Sydney, in office', 'Sydney, or Melbourne',
    'Melbourne, at office', 'Brisbane, no relocation',
    'London & Sydney', 'Tokyo & Sydney', 'Hong Kong & Sydney',
    'Sydney - ON SITE', 'Sydney - IN OFFICE', 'Sydney - AT OFFICE', 'Sydney - OR REMOTE',
    'Sydney - NO RELOCATION', 'Sydney - TO BE CONFIRMED', 'Sydney - AS NEEDED',
    'Sydney - BY ARRANGEMENT', 'Sydney (ON SITE)',
    'Rydalmere', '242 Exhibition St', 'Mulgrave', 'Rockingham', 'Erina', 'Richmond', 'Mascot',
    'Joondalup', 'Corp Office - Apex Radiology',
    'Australia | SEQ | Brisbane - 99 Melbourne St', 'Sydney St', '12 Melbourne CT', 'Sydney Pl',
    'Rockingham - 44b Tesla Road',
    '242 Exhibition ST', 'Adelaide - 21 King ST', 'Sydney, NSW - 123 George ST',
    '242 Exhibition ST, Melbourne VIC 3000', '21 King ST, Adelaide SA 5000',
    '1 Martin PL, Sydney NSW 2000',
    'Parramatta', 'Chatswood', 'Macquarie Park', 'Barangaroo', 'Surry Hills', 'Alexandria', 'Bella Vista',
    'Frenchs Forest', 'Southbank', 'Docklands', 'Cremorne', 'Abbotsford', 'Fortitude Valley', 'Acton',
    'Subiaco', 'Osborne Park', 'Kent Town', 'Woden', 'Belconnen', 'Robina', 'Maroochydore',
    'Dandenong', 'Clayton',
    'Multiple Locations: Australia, New Zealand', 'Australia, New Zealand, Singapore',
    'Sydney, Melbourne, Singapore',
  ];
  for (const location of accepted) {
    assert.equal(supports('Software Engineer', location, ['au']), true, location);
  }
  for (const location of ['Remote job', 'Remote role', 'Remote position', 'Fully remote job']) {
    assert.equal(supports('Software Engineer', location, ['au', 'ca', 'gb', 'nz', 'us']), true, location);
  }
  for (const location of ['Corp Office - Apex Radiology', 'Hybrid']) {
    assert.equal(supports('Software Engineer', location, ['au', 'gb', 'jp']), false, location);
  }
  for (const [location, countries] of [
    ['Melbourne, FL - 123 Main ST', ['au', 'us']],
    ['Sydney, NS - 10 Main ST', ['au', 'ca']],
    ['US-FL-MELBOURNE-307 ~ 1100 W Hibiscus Blvd', ['au', 'us']],
    ['123 Main ST', ['au', 'us']], ['123 Main ST', ['us']],
  ]) assert.equal(supports('Software Engineer', location, countries), false, location);
});

test('foreign-only title qualifiers are rejected but mixed Australian markets remain eligible', () => {
  const rejected = [
    'Senior Software Engineer, AI Training - United States', 'Software Engineer - London',
    'Software Engineer - Toronto', 'Software Engineer - Bangalore', 'US Based Software Engineer',
    'United States Remote Software Engineer', 'Software Engineer (Singapore)', 'Germany Software Engineer',
    'US Remote Software Engineer', 'Software Engineer - Remote Germany', 'Software Engineer - Remote US',
    'Software Engineer - EMEA', 'Software Engineer - Europe', 'Software Engineer - LATAM',
    'Software Engineer - Texas', 'US Senior Software Engineer', 'Germany Senior Software Engineer',
    'EMEA Senior Software Engineer', 'Remote US Senior Software Engineer', 'Texas Software Engineer',
    'Brazil Software Engineer', 'Spain Software Engineer', 'Sweden Software Engineer',
    'Software Engineer - Tokyo', 'Software Engineer - Seoul', 'NYC Software Engineer',
    'US East Software Engineer', 'Senior Engineer, Australian Payments - United States',
    'US Sr Software Engineer', 'US DevOps Engineer', 'Germany Backend Engineer', 'EMEA SRE',
    'Texas Frontend Engineer', 'Remote US QA Engineer', 'London Full Stack Engineer',
    'Software Engineer - US East', 'Software Engineer - United States East',
    'Software Engineer - New York US', 'Software Engineer - London UK',
    'Software Engineer - London and New York', 'Software Engineer - US & Canada',
    'Software Engineer - London + Remote', 'London & New York Software Engineer',
    'Software Engineer - London or Remote', 'Software Engineer - US or Canada',
    'London or New York Software Engineer',
    'Software Engineer - Hong Kong', 'Software Engineer - Australia (United States only)',
    'Software Engineer - AU - US only',
    'Software Engineer - New York City', 'Software Engineer - Mexico City',
    'Software Engineer - Dubai', 'Software Engineer - UAE', 'Software Engineer - London Office',
    'Software Engineer - Tokyo Office', 'New York City Software Engineer', 'Dubai Software Engineer',
    'US Engineer', 'US Staff Engineer', 'US Java Developer', 'Germany iOS Developer',
    'Texas Cybersecurity Engineer', 'US Only Software Engineer', 'Software Engineer - Madrid',
    'Software Engineer - Hyderabad', 'Software Engineer - Pune', 'Software Engineer - Chennai',
    'Software Engineer - São Paulo', 'Software Engineer - Barcelona', 'Software Engineer - Warsaw',
    'Software Engineer - Prague', 'Software Engineer - Tel Aviv', 'Software Engineer - San Jose',
    'Software Engineer - Manila', 'Software Engineer - Jakarta', 'Software Engineer - Bangkok',
    'Software Engineer - Kuala Lumpur', 'Software Engineer - Taipei', 'Software Engineer - Shanghai',
    'Software Engineer - Beijing', 'Software Engineer - Shenzhen', 'Software Engineer - Lagos',
    'Software Engineer - Nairobi', 'Software Engineer - Americas', 'Software Engineer - North America',
    'Software Engineer - NAMER', 'Software Engineer - AMER', 'Software Engineer - DACH',
    'Software Engineer - UK&I', 'Software Engineer - ASEAN', 'Software Engineer - SEA',
    'Software Engineer - MENA', 'Software Engineer - Sydney / Nova Scotia',
    'Software Engineer - Melbourne / Florida',
    'Software Engineer - Lisbon', 'Software Engineer - Manchester',
  ];
  for (const title of rejected) assert.equal(supports(title, 'Remote', ['au', 'us']), false, title);

  for (const title of [
    'Software Engineer - London / Sydney', 'Software Engineer - Jordan Platform',
    'Software Engineer - Monaco Design System', 'Sr Solution Consultant', 'Sr Systems Engineer',
    'Software Engineer - Melbourne, Florida / Sydney, Australia', 'Software Engineer - Australian / US',
    'Software Engineer - Sydney & London', 'Software Engineer - AU & US',
    'Software Engineer - London or Sydney',
    'Software Engineer - Australia, New Zealand',
    'Software Engineer - No AU sponsorship', 'Software Engineer - No AU citizenship required',
  ]) assert.equal(supports(title, 'Sydney, AU', ['au', 'gb']), true, title);
});

test('country metadata disambiguates bare state names without overriding visible contradictions', () => {
  const cases = [
    ['WA', ['au'], true], ['WA', ['au', 'us'], false], ['Perth, WA, AU', ['au', 'sa', 'us'], true],
    ['Victoria', ['au'], true], ['Victoria', ['au', 'ca'], false],
    ['Melbourne, Victoria', ['au', 'ca'], true], ['SA', ['au', 'sa'], false],
    ['Adelaide, SA', ['au', 'sa'], true], ['Sydney, Nova Scotia', ['au'], false],
    ['Melbourne, Florida', ['au'], false], ['Remote - United States', ['au', 'us'], false],
    ['Sydney, Canada', ['au', 'ca'], false], ['Sydney, United States', ['au', 'us'], false],
    ['Melbourne, New Zealand', ['au', 'nz'], false], ['Perth, Germany', ['au', 'de'], false],
    ['United States-Florida-Melbourne', ['au', 'us'], false],
    ['US-FL-MELBOURNE-307 ~ 1100 W Hibiscus Blvd', ['au', 'us'], false],
    ['Victoria, BC', ['au', 'ca'], false], ['Victoria (Hybrid)', ['au', 'ca'], false],
    ['WA Remote', ['au', 'us'], false], ['Remote WA', ['au', 'us'], false],
    ['Remote (WA)', ['au', 'us'], false], ['Hybrid SA', ['au', 'sa'], false],
    ['Melbourne, fl', ['au', 'us'], false], ['Sydney, ns', ['au', 'ca'], false],
    ['Sydney, N.S.', ['au', 'ca'], false], ['Perth and Kinross, Scotland', ['au', 'gb'], false],
    ['WA-based', ['au', 'us'], false], ['WA Office', ['au', 'us'], false],
    ['Remote WA-based', ['au', 'us'], false], ['Victoria Office', ['au', 'ca'], false],
    ['SA Region', ['au', 'sa'], false], ['Melbourne fl', ['au', 'us'], false],
    ['Sydney ns', ['au', 'ca'], false],
    ['Australia (United States only)', ['au', 'us'], false],
    ['NSW, United States', ['au', 'us'], false],
    ['Sydney, NSW, United States', ['au', 'us'], false],
    ['Queensland - London', ['au', 'gb'], false],
    ['Sydney, Hong Kong', ['au', 'hk'], false],
    ['Newcastle upon Tyne', ['au', 'gb'], false],
    ['Newcastle-under-Lyme', ['au', 'gb'], false],
    ['Sydney, Cape Breton', ['au', 'ca'], false],
    ['Melbourne, Derbyshire', ['au', 'gb'], false],
    ['WA only', ['au', 'us'], false], ['WA residents only', ['au', 'us'], false],
    ['Remote in WA', ['au', 'us'], false], ['Work from WA', ['au', 'us'], false],
    ['Victoria only', ['au', 'ca'], false], ['Victoria Remote First', ['au', 'ca'], false],
    ['Remote within Victoria', ['au', 'ca'], false], ['SA applicants', ['au', 'sa'], false],
    ['NT preferred', ['au', 'us'], false],
    ['Madrid', ['au'], false], ['Zurich', ['au'], false], ['Rome', ['au'], false],
    ['Remote - North America', ['au'], false],
    ['Sydney Mines', ['au'], false], ['Melbourne Beach', ['au'], false],
    ['Perth Amboy', ['au'], false], ['Victoria Falls', ['au'], false],
    ['Newcastle, County Down', ['au', 'gb'], false],
    ['Sydney / Nova Scotia', ['au', 'ca'], false],
    ['Melbourne / Florida', ['au', 'us'], false],
    ['Melbourne | FL', ['au', 'us'], false],
    ['Sydney & Nova Scotia', ['au', 'ca'], false],
    ['Melbourne and Florida', ['au', 'us'], false],
    ['Sydney or Nova Scotia', ['au', 'ca'], false],
    ['WA', [], false], ['SA', [], false], ['NT', [], false], ['Victoria', [], false],
    ['WA Remote', [], false], ['Victoria Office', [], false],
  ];
  for (const [location, countries, expected] of cases) {
    assert.equal(supports('Software Engineer', location, countries), expected, String(location));
  }
  assert.equal(supports('Software Engineer', 'Sydney, Australia', ['us']), false);

  for (const code of ['SA', 'SE', 'IT', 'HR', 'ID', 'AR', 'CI', 'CD', 'CX', 'EE', 'ME', 'PM', 'BE']) {
    assert.equal(supports(`Software Engineer - ${code}`, 'Remote', ['au', code.toLowerCase()]), false, code);
  }
  for (const [title, code] of [['IT Engineer', 'it'], ['HR Systems Engineer', 'hr'], ['AR Developer', 'ar'], ['ID Engineer', 'id'], ['SE Engineer', 'se']]) {
    assert.equal(supports(title, 'Sydney, Australia', ['au', code]), true, title);
  }

  for (const location of ['Sydney / Singapore', 'Sydney and London', 'London / Sydney', 'Perth / WA']) {
    assert.equal(supports('Software Engineer', location, ['au', 'gb', 'sg', 'us']), true, location);
  }
  assert.equal(supports('Software Engineer - Melbourne, Florida / Sydney, Australia', 'Remote', ['au', 'us']), true);
});
