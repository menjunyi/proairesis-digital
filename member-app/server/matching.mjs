export const VERSION='roleclue-evidence-v1';
export const ROLE_FAMILIES=['software','data','cloud','security','quality','product','design','it-support','business-analysis'];
const SKILLS=['JavaScript','TypeScript','Python','Java','C#','C++','React','Angular','Vue','Node.js','SQL','PostgreSQL','MySQL','AWS','Azure','GCP','Docker','Kubernetes','Terraform','Linux','Git','CI/CD','REST','GraphQL','HTML','CSS','Figma','Power BI','Tableau','Excel','Agile','Scrum','Selenium','Playwright','Cypress','Jest','Go','Rust','Ruby','PHP','Swift','Kotlin','SAP','ServiceNow','Salesforce','Machine Learning','Data Analysis','Business Analysis','Cybersecurity'];
function pattern(skill){return new RegExp(`(^|[^a-z0-9])${skill.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^a-z0-9]|$)`,'i');}
export const hasSkill=(text,skill)=>pattern(skill).test(text);
export function detectSkills(text){return SKILLS.filter(skill=>hasSkill(text,skill));}
function evidence(text,skill){return text.split(/(?<=[.!?])\s+|\n/).find(line=>hasSkill(line,skill))?.trim().slice(0,700)??'';}
function normalSeniority(value) {
  const label = String(value ?? '').trim().toLowerCase().replace(/[\s_\u2010-\u2015]+/g, '-');
  return label.replace(/^(junior|mid|senior)-?level$/, '$1') || 'unknown';
}
function evaluate(profile, job, now, explain) {
  const unknown = [], gaps = [], matches = [];
  if (job.source === 'user-provided') unknown.push({
    text: 'Confirm that the role is still open and the pasted description is complete and current.',
    jobEvidence: 'This description was supplied by you; RoleClue has not fetched or verified the source website.',
  });
  const reject = (reason, gap, score = null) => explain ? {
    job, score, label: 'Not shortlisted', matches,
    gaps: gap ? [...gaps, gap] : gaps, needsConfirmation: unknown,
    matchingVersion: VERSION, highFit: false, reason,
  } : null;
  const proof = (key, fallback) => job.requirementEvidence?.[key] || fallback;
  if (!ROLE_FAMILIES.includes(job.roleFamily)) return reject('This job is outside the supported technology role families.');
  if (!job.australia) return reject('An Australian job location has not been established.');
  if (!job.description || job.description.length < 120) return reject('The supplied job description is too short for an evidence-based assessment.');
  if (job.expiresAt && Date.parse(job.expiresAt) <= now) return reject('This opportunity has expired.');
  if (profile.roleFamilies?.length && !profile.roleFamilies.includes(job.roleFamily)) {
    return reject('This role family is outside your selected target roles.', {text: 'The role family differs from your profile.', jobEvidence: job.roleFamily});
  }
  const pref = profile.preferences ?? {}, req = job.requirements ?? {};
  if (req.citizenship === 'required' && ['permanent-resident', 'visa', 'visa-unrestricted', 'visa-limited', 'none'].includes(profile.workRights)) {
    return reject('The stated Australian-citizenship requirement conflicts with your reviewed work-rights status.', {
      text: 'Australian citizenship is required by the supplied job information.', jobEvidence: proof('citizenship', 'The source marks citizenship as required.'),
    });
  }
  if (req.sponsorship === 'unavailable' && ['yes', 'now'].includes(profile.needsSponsorship)) {
    return reject('You need sponsorship, but the supplied job information explicitly rules it out.', {
      text: 'Visa sponsorship is unavailable for this role.', jobEvidence: proof('sponsorship', 'The source marks sponsorship as unavailable.'),
    });
  }
  if (profile.workRights === 'none' && req.sponsorship === 'unavailable') {
    return reject('Your profile records no current work rights and this role does not offer sponsorship.', {
      text: 'The supplied job information rules out sponsorship.', jobEvidence: proof('sponsorship', 'The source marks sponsorship as unavailable.'),
    });
  }
  const clearanceLevels = ['none', 'baseline', 'nv1', 'nv2', 'pv'];
  const normalClearance = value => String(value ?? 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
  const have = normalClearance(profile.clearance), needed = normalClearance(req.clearance);
  if (needed !== 'unknown' && needed !== 'none' && have !== 'unknown'
    && clearanceLevels.includes(needed) && clearanceLevels.includes(have)
    && clearanceLevels.indexOf(have) < clearanceLevels.indexOf(needed)) {
    return reject('The stated clearance requirement exceeds the clearance recorded in your reviewed profile.', {
      text: `The role requires ${req.clearance} clearance.`, jobEvidence: proof('clearance', evidence(job.description, 'clearance')),
    });
  }
  const locationMatches = pref.locations?.some(value => job.location.toLowerCase().includes(value.toLowerCase()));
  const includedRemote = pref.includeRemote === true && job.workplaceType === 'remote';
  if (pref.locationsRequired && pref.locations?.length && !locationMatches && !includedRemote) {
    return reject('The advertised location does not match your required locations.', {text: 'The location conflicts with a must-have preference.', jobEvidence: job.location});
  }
  if (pref.workplaceRequired && pref.workplaceTypes?.length && job.workplaceType !== 'unknown'
    && !pref.workplaceTypes.includes(job.workplaceType)) {
    return reject('The workplace arrangement does not match your required arrangement.', {text: 'The workplace arrangement conflicts with a must-have preference.', jobEvidence: job.workplaceType});
  }
  if (pref.minimumSalaryRequired && pref.minimumSalary && job.salaryMax
    && job.salaryPeriod === pref.salaryPeriod && job.salaryMax < pref.minimumSalary) {
    return reject('The disclosed salary maximum is below your required minimum in the same salary period.', {
      text: 'The advertised pay conflicts with a must-have preference.', jobEvidence: `${job.salaryMax} per ${job.salaryPeriod}`,
    });
  }
  if (pref.minimumSalaryRequired && pref.minimumSalary && (!job.salaryMax || job.salaryPeriod !== pref.salaryPeriod)) {
    unknown.push({text: 'Confirm whether pay meets your minimum in the selected salary period.', jobEvidence: 'A directly comparable salary range is not available.'});
  }
  if (pref.workplaceRequired && pref.workplaceTypes?.length && job.workplaceType === 'unknown') {
    unknown.push({text: 'Confirm whether the workplace arrangement meets your requirement.', jobEvidence: 'The workplace arrangement is not specified.'});
  }
  if (pref.limitations?.trim()) unknown.push({text: `Confirm your practical limitation with the employer: ${pref.limitations.trim().slice(0, 1000)}`, jobEvidence: 'This free-text limitation has not been automatically assessed.'});
  if (profile.visaLimitations?.trim()) unknown.push({text: `Confirm your visa work limitation with the employer: ${profile.visaLimitations.trim().slice(0, 1000)}`, jobEvidence: 'This user-supplied limitation has not been automatically assessed.'});
  if (req.citizenship === 'required' && profile.workRights === 'unknown') unknown.push({text: 'Confirm whether you meet the citizenship requirement.', jobEvidence: evidence(job.description, 'citizen') || 'The source marks citizenship as required.'});
  if (req.citizenship === 'unknown') unknown.push({text: 'Confirm any citizenship or residency restrictions with the employer.', jobEvidence: 'Citizenship restrictions are not specified.'});
  if (req.sponsorship === 'unknown' || ['unknown', 'later'].includes(profile.needsSponsorship)) unknown.push({text: 'Confirm sponsorship and work-rights eligibility with the employer.', jobEvidence: 'Sponsorship eligibility is not established by the supplied information.'});
  if (needed !== 'unknown' && needed !== 'none' && (have === 'unknown' || !clearanceLevels.includes(needed) || !clearanceLevels.includes(have))) unknown.push({text: `Confirm the required ${req.clearance} clearance.`, jobEvidence: evidence(job.description, 'clearance')});
  if (req.clearance === 'unknown') unknown.push({text: 'Confirm whether this role has a clearance requirement.', jobEvidence: 'Clearance requirements are not specified.'});
  const skills = (job.skills?.length ? job.skills : detectSkills(job.description)).filter(skill => hasSkill(job.description, skill)).slice(0, 40);
  if (skills.length < 2) return reject('The supplied description contains too little recognized skill evidence to establish high fit.');
  for (const skill of skills) {
    const resumeProof = evidence(profile.resumeText ?? '', skill), jobProof = evidence(job.description, skill);
    if (resumeProof) matches.push({text: `${skill} appears in your resume and the job requirements.`, resumeEvidence: resumeProof, jobEvidence: jobProof});
    else gaps.push({text: `${skill} is not evidenced in your resume.`, jobEvidence: jobProof});
  }
  const ratio = matches.length / skills.length;
  if (matches.length < 2 || ratio < 0.6) return reject('Your resume does not evidence enough of the recognized job skills for the high-fit shortlist. This does not mean you lack those skills.');
  let experience = 0;
  if (Number.isFinite(req.minimumYears) && Number.isFinite(profile.yearsExperience)) {
    if (profile.yearsExperience < req.minimumYears) {
      return reject('The explicit minimum experience requirement exceeds the years recorded in your reviewed profile.', {
        text: `The role requires at least ${req.minimumYears} years of experience.`, jobEvidence: proof('minimumYears', evidence(job.description, 'years') || 'The source records a minimum experience requirement.'),
      });
    }
    experience = 5;
  }
  if (Number.isFinite(req.minimumYears) && !Number.isFinite(profile.yearsExperience)) unknown.push({text: `Confirm the required ${req.minimumYears} years of experience; your experience length has not been confirmed.`, jobEvidence: evidence(job.description, 'years') || 'The source records a minimum experience requirement.'});
  const seniority = normalSeniority(job.seniority);
  if (['senior', 'lead', 'principal', 'staff', 'executive'].includes(seniority)
    && Number.isFinite(profile.yearsExperience) && profile.yearsExperience < 3) {
    return reject('The current matching rule does not shortlist senior roles for profiles with under three years of experience; this is not an employer-stated minimum.', {text: 'Advertised seniority is above the current early-career matching threshold.', jobEvidence: job.seniority});
  }
  let preferencePenalty = 0;
  const preferenceGap = text => {
    gaps.push({text, jobEvidence: `${job.title}; ${job.location}; ${job.employmentType}; ${job.workplaceType}; ${job.seniority}`});
    preferencePenalty += 3;
  };
  if (pref.roleTitles?.length && !pref.roleTitles.some(title => job.title.toLowerCase().includes(title.toLowerCase()))) preferenceGap('The title differs from your preferred role titles.');
  if (pref.seniority?.length && seniority !== 'unknown' && !pref.seniority.some(value => normalSeniority(value) === seniority)) preferenceGap('The advertised seniority differs from your preference.');
  if (pref.employmentTypes?.length && job.employmentType !== 'unknown' && !pref.employmentTypes.includes(job.employmentType)) preferenceGap('The employment type differs from your preference.');
  if (pref.workplaceTypes?.length && job.workplaceType !== 'unknown' && !pref.workplaceTypes.includes(job.workplaceType)) preferenceGap('The workplace arrangement differs from your preference.');
  if (pref.locations?.length && !locationMatches && !includedRemote) preferenceGap('The advertised location differs from your preference.');
  const score = Math.min(98, Math.round(55 + ratio * 35 + experience - preferencePenalty));
  if (score < 75) return reject('The fit estimate falls below the shortlist threshold after considering your preferences.', null, score);
  return {job, score, label: unknown.length ? 'Needs confirmation' : 'Strong fit', matches, gaps, needsConfirmation: unknown, matchingVersion: VERSION};
}

export function assess(profile, job, now = Date.now()) {
  return evaluate(profile, job, now, false);
}

export function assessWithReasons(profile, job, now = Date.now()) {
  const result = evaluate(profile, job, now, true);
  return result.highFit === false ? result : {...result, highFit: true, reason: null};
}
export function normalizeJob(raw,source,now=new Date().toISOString()) {
  if(!raw||typeof raw.id!=='string'||typeof raw.title!=='string'||typeof raw.description!=='string')return null;
  const country=String(raw.country??'').toUpperCase(); if(!['AU','AUSTRALIA'].includes(country))return null;
  if(!ROLE_FAMILIES.includes(raw.roleFamily))return null;
  let url;try{url=new URL(raw.url);if(url.protocol!=='https:'||url.username||url.password)return null;}catch{return null;}
  let sourceUrl=url.href;try{const parsed=new URL(raw.sourceUrl);if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password)sourceUrl=parsed.href;}catch{}
  if(raw.description.length>30000||Buffer.byteLength(raw.description,'utf8')>60000||raw.title.length>250)return null;
  const requirement=raw.requirements??{},requirements={citizenship:['required','not-required'].includes(requirement.citizenship)?requirement.citizenship:'unknown',sponsorship:['available','unavailable'].includes(requirement.sponsorship)?requirement.sponsorship:'unknown',clearance:typeof requirement.clearance==='string'?requirement.clearance.slice(0,100):'unknown',minimumYears:Number.isFinite(requirement.minimumYears)&&requirement.minimumYears>=0?requirement.minimumYears:null};
  const job={id:`${source}:${raw.id}`.replace(/[^a-zA-Z0-9:_-]/g,'_').slice(0,180),title:raw.title,company:String(raw.company??'').slice(0,250),location:String(raw.location??'Australia').slice(0,250),australia:true,workplaceType:raw.workplaceType==='onsite'?'on-site':['remote','hybrid','on-site'].includes(raw.workplaceType)?raw.workplaceType:'unknown',employmentType:typeof raw.employmentType==='string'?raw.employmentType.slice(0,60):'unknown',description:raw.description,url:url.href,source,sourceUrl,updatedAt:now,expiresAt:raw.expiresAt&&Number.isFinite(Date.parse(raw.expiresAt))?new Date(raw.expiresAt).toISOString():null,skills:Array.isArray(raw.skills)?raw.skills.filter(x=>typeof x==='string').map(x=>x.slice(0,100)).slice(0,40):detectSkills(raw.description),roleFamily:raw.roleFamily,seniority:typeof raw.seniority==='string'?raw.seniority.slice(0,60):'unknown',salaryMin:Number.isFinite(raw.salaryMin)?raw.salaryMin:null,salaryMax:Number.isFinite(raw.salaryMax)?raw.salaryMax:null,salaryPeriod:raw.salaryPeriod??'year',requirements};
  return Buffer.byteLength(JSON.stringify(job),'utf8')<=90000?job:null;
}
