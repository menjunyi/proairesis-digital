/* Public screenshots are deliberately unoptimised static export assets. */
/* eslint-disable next/no-img-element */
import { RoleClueMark } from '@/components/roleclue-mark';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleHelp,
  FileText,
  Globe2,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import Link from 'next/link';
import './landing.css';
import { getContactDetails } from '@/lib/contact';

// Real screenshots captured from the founder’s working dashboard.
const screenshotsReady = true;
const checks = [
  'Work rights',
  'Sponsorship',
  'Citizenship',
  'Clearance',
  'Location',
];
const steps = [
  {
    n: '01',
    icon: SlidersHorizontal,
    title: 'Start with your situation.',
    body: 'Your work rights, sponsorship needs, preferred locations and experience. The details a CV match can miss.',
  },
  {
    n: '02',
    icon: ScanLine,
    title: 'See what the job really requires.',
    body: 'RoleClue checks the wording, highlights the blockers and brings unclear conditions to your attention.',
  },
  {
    n: '03',
    icon: FileText,
    title: 'Put your effort in the right place.',
    body: 'Choose a role worth pursuing. Prepare a tailored résumé and cover letter using your actual experience, then review and apply.',
  },
];
const questions = [
  ['What do I get for booking a conversation?', 'Everyone who books a conversation with me will be invited to join RoleClue’s first group of users and receive one month of free usage. I’ll send your early-access invitation to the email address used for your booking.'],
  ['Can I use RoleClue today?', 'RoleClue is a working personal project, not a publicly operating service yet. The screenshots show the system I use for my own search. Book a conversation to see the workflow, share your challenges and help shape what comes next.'],
  [
    'Who is RoleClue’s Australian job search for?',
    'RoleClue is for professionals exploring Australian jobs, whether you already live in Australia or are applying from overseas. Your preferred cities, relocation plans and work arrangements shape what is relevant to you.',
  ],
  [
    'Can RoleClue help me assess jobs that may require visa sponsorship?',
    'Sponsorship is one of the requirements RoleClue helps you examine. An employer accepting temporary work rights today is different from offering sponsorship later. If the advertisement does not make that clear, the decision should stay uncertain until you confirm it with the employer.',
  ],
  [
    'Does a positive decision mean I will get the job?',
    'No. It means the available job requirements appear compatible with the profile being checked. Employers make hiring decisions. A good skills match, or an employer having sponsored before, does not guarantee an interview, sponsorship or an offer.',
  ],
  [
    'Will RoleClue find every available job?',
    'No. Coverage depends on the supported sources and the job information available. You should keep using your existing job boards and alerts, and check the original listing before applying.',
  ],
  [
    'Does RoleClue apply on my behalf?',
    'You stay in control. Review the evidence, edit any drafts and submit the application yourself. RoleClue does not invent experience or answer work-rights declarations for you.',
  ],
];
function Brand() {
  return (
    <a className="pip-brand" href="#top" aria-label="RoleClue home">
      <RoleClueMark className="roleclue-mark" />
      RoleClue<span className="brand-caption">Job eligibility</span>
    </a>
  );
}
export default function Home() {
  const { email } = getContactDetails();
  return (
    <main id="top" className="pip-landing">
      <a href="#main-content" className="pip-skip">
        Skip to content
      </a>
      <header className="pip-header">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="#in-use">See it in use</a>
          <a href="#how">How it works</a>
          <a href="#contact">Contact</a>
          <a href="#questions">FAQs</a>
        </nav>
        <Link
          className="pip-button small"
          href="/book"
          data-analytics-location="header"
        >
          Let’s talk <ArrowUpRight size={16} />
        </Link>
      </header>
      <section className="pip-hero pip-wrap" id="main-content">
        <div className="hero-heading">
          <p className="pip-eyebrow">
            <span className="pixel-dot" /> Australian job search · In development
          </p>
          <h1>
            Find the jobs
            <br />
            you can actually
            <br />
            <span>pursue.</span>
          </h1>
        </div>
        <div className="hero-intro">
          <p>
            Find the requirements that matter <strong>before you apply.</strong>{' '}
            RoleClue checks work rights, sponsorship, citizenship, clearance and
            location to help you spend less time filtering opportunities yourself and more time on applications worth pursuing.
          </p>
          <div className="pip-actions">
            <Link className="pip-button" href="/book" data-analytics-location="hero">Help shape what I build <ArrowUpRight size={17} /></Link>
            <a className="pip-text-link" href="#in-use">See the real workflow <ArrowDown size={17} /></a>
          </div>
          <p className="hero-stage-note">Book 30 minutes with me and tell me what you need. Your input will shape RoleClue, and I’ll build features around the needs of the people who book with me. 🎁 You’ll also get one month of free usage.</p>
          <p className="hero-audience">
            For professionals in Australia.
            <br />
            And those planning their next move here.
          </p>
        </div>
        <figure className="live-hero-preview">
          <div className="screen-label"><span className="pixel-dot" /> THE PROJECT I’M BUILDING <span>Real dashboard / in development</span></div>
          {screenshotsReady ? <a href="#in-use"><img src="/screenshots/today-masked.png" width="1600" height="1100" alt="The working dashboard showing search totals, the application review queue and the next scheduled workflow." fetchPriority="high" /></a> : <div className="screenshot-pending">Discover opportunities. Check requirements. Track your next move.</div>}
          <figcaption>This is the dashboard I use for my own Australian job search. It puts applications awaiting review and the next scheduled workflow up front, with discovery and retrieval details further down.</figcaption>
        </figure>
        <div className="check-strip">
          <span>Checked before fit.</span>
          {checks.map((x) => (
            <span key={x}>
              <span className="tiny-cross">+</span>
              {x}
            </span>
          ))}
        </div>
      </section>
      <section className="pip-section pip-wrap" id="in-use">
        <div className="section-title"><p className="pip-eyebrow">01 / The project I’m building</p><h2>Built for my search.<br /><span>Shaped by yours.</span></h2><p>I built this because checking every promising job by hand takes time. The system gathers opportunities, flags requirements that may rule a role out, and shows what still needs my attention. These are real screens from my own search.</p></div>
        {screenshotsReady ? <div className="screen-story">
          {[
            {image:'opportunities-v2', number:'01', height:1000, title:'Choose where to put your effort.', body:'With unsuitable roles out of the way, I can compare the remaining opportunities by fit, check flagged requirements and see which applications are ready for review. I decide what to pursue before spending time on the next application.', alt:'Real opportunity shortlist filtered to suitable roles, with fit scores, flagged requirements and ranked or prepared statuses.'},
            {image:'applications-assessment', number:'02', width:1712, height:925, title:'See the reasoning before you apply.', body:'My real application workspace keeps the documents, personal fit assessment, blockers and timeline together. I can review the strengths and gaps before deciding whether to submit. Only the résumé preview is omitted here.', alt:'Real application workspace showing the personal fit assessment, blockers, timeline and application list; résumé preview omitted.'},
          ].map(screen=><figure className="screen-story-card" key={screen.image}><figcaption><span className="screen-number">{screen.number}</span><div><h3>{screen.title}</h3><p>{screen.body}</p></div><a href={`/screenshots/${screen.image}.png`} target="_blank" rel="noopener noreferrer" aria-label={`Enlarge: ${screen.title}`}>Enlarge <ArrowUpRight size={16}/></a></figcaption><a href={`/screenshots/${screen.image}.png`} target="_blank" rel="noopener noreferrer" aria-label={`Open full screenshot: ${screen.title}`}><img src={`/screenshots/${screen.image}.png`} width={screen.width || 1600} height={screen.height} alt={screen.alt} loading="lazy" /></a></figure>)}
        </div> : <div className="screenshot-pending light">A walkthrough of the working project is being prepared. Book a conversation to see it together.</div>}
        <article className="assessment-walkthrough">
          <div><p className="pip-eyebrow">A closer look / My own assessment</p><h3>The score is only<br/>the starting point.</h3><p>This is my assessment for a Mission Critical Azure Delivery Engineer role. It recognises my consultancy and Terraform experience, but flags gaps in deep Azure and SRE experience.</p><ul><li><strong>Personal fit:</strong> strengths and gaps explained in plain language.</li><li><strong>Blockers:</strong> this application currently has no open blockers. That does not mean every skill requirement is met.</li><li><strong>Timeline:</strong> the recorded creation event shows when this application entered the workflow.</li></ul><p className="pip-caption">A real system assessment of my profile, shared with my permission. It is not an employer’s assessment or evidence of an interview.</p></div>
          <a href="/screenshots/assessment-detail-v2.png" target="_blank" rel="noopener noreferrer" aria-label="Enlarge my personal fit assessment, blockers and timeline"><img src="/screenshots/assessment-detail-v2.png" width="1280" height="1458" loading="lazy" alt="Close-up of my personal strengths and gaps, no open blockers, and application-created timeline entry on 12 September 2026."/></a>
        </article>
        {screenshotsReady && <p className="pip-caption">Real personal-workflow screenshots, captured 12 September 2026. My personal fit assessments, blocker status and timeline are shown. The résumé preview is omitted. Counts and assessments change as the search progresses; these screens are not evidence of employer responses.</p>}
        <div className="walkthrough-invite"><p>Book a conversation. Join the first group of users and get one month free when you receive access.</p><Link className="pip-button" href="/book">Let’s talk <ArrowUpRight size={18}/></Link></div>
      </section>
      <section className="pip-section pip-wrap" id="decisions">
        <div className="section-title">
          <p className="pip-eyebrow">01 / The decision comes first</p>
          <h2>
            A great match.
            <br />
            <span>Until the fine print.</span>
          </h2>
          <p>
            You find a promising role. Then comes “citizenship required” or “no
            sponsorship.” RoleClue brings those conditions to the surface before you
            invest in an application.
          </p>
        </div>
        <div className="decision-grid">
          <article className="decision-card">
            <div className="decision-state">
              <X size={19} /> Requirement not met <span>01</span>
            </div>
            <div className="role-body">
              <p className="role-meta">ILLUSTRATIVE ROLE · CLOUD ENGINEER</p>
              <h3>
                The skills fit.
                <br />
                The citizenship rule doesn’t.
              </h3>
              <blockquote>“Applicants must be Australian citizens.”</blockquote>
              <dl>
                <div>
                  <dt>Your profile</dt>
                  <dd>Not an Australian citizen</dd>
                </div>
                <div>
                  <dt>RoleClue’s decision</dt>
                  <dd>Skip this role</dd>
                </div>
              </dl>
              <p className="decision-note">
                An explicit requirement conflicts with your profile.
              </p>
            </div>
          </article>
          <article className="decision-card">
            <div className="decision-state">
              <CircleHelp size={19} /> Needs clarification <span>02</span>
            </div>
            <div className="role-body">
              <p className="role-meta">ILLUSTRATIVE ROLE · DATA ANALYST</p>
              <h3>
                Good fit today.
                <br />
                Sponsorship is unclear.
              </h3>
              <blockquote>
                “Applicants must have current Australian work rights.”
              </blockquote>
              <dl>
                <div>
                  <dt>Your profile</dt>
                  <dd>Work rights now; sponsorship later</dd>
                </div>
                <div>
                  <dt>RoleClue’s decision</dt>
                  <dd>Ask the employer</dd>
                </div>
              </dl>
              <p className="decision-note">
                The advertisement doesn’t say whether future sponsorship is
                available.
              </p>
            </div>
          </article>
          <article className="decision-card positive">
            <div className="decision-state">
              <Check size={19} /> Worth pursuing <span>03</span>
            </div>
            <div className="role-body">
              <p className="role-meta">ILLUSTRATIVE ROLE · SOFTWARE ENGINEER</p>
              <h3>
                A role that fits
                <br />
                your next move.
              </h3>
              <blockquote>
                “Overseas applicants welcome. Visa sponsorship available.”
              </blockquote>
              <dl>
                <div>
                  <dt>Your profile</dt>
                  <dd>Overseas; open to relocation</dd>
                </div>
                <div>
                  <dt>RoleClue’s decision</dt>
                  <dd>Explore this opportunity</dd>
                </div>
              </dl>
              <p className="decision-note">
                The stated sponsorship condition aligns. Confirm the remaining
                requirements.
              </p>
            </div>
          </article>
        </div>
        <p className="pip-caption">
          Examples demonstrate the approach, not live vacancies. Missing
          information is flagged for clarification; it is never treated as proof
          of eligibility.
        </p>
      </section>
      <section className="audience-section">
        <div className="pip-wrap audience-inner">
          <p className="pip-eyebrow">Built around your situation</p>
          <h2>
            Your next chapter.
            <br />
            Your real-world requirements.
          </h2>
          <div className="audience-grid">
            <article>
              <Globe2 />
              <h3>Already in Australia</h3>
              <p>
                Find roles compatible with your current work rights, location
                and plans for what comes next.
              </p>
              <span>Temporary residents · International graduates</span>
            </article>
            <article>
              <ArrowUpRight />
              <h3>Looking from overseas</h3>
              <p>
                Spot explicit sponsorship and relocation signals, and know when
                you need to ask for more information.
              </p>
              <span>Skilled professionals · Sponsorship seekers</span>
            </article>
            <article>
              <ShieldCheck />
              <h3>Navigating hard requirements</h3>
              <p>
                Bring citizenship, clearance and workplace conditions into the
                decision alongside your experience.
              </p>
              <span>Your skills are only part of the picture</span>
            </article>
          </div>
        </div>
      </section>
      <section className="pip-section pip-wrap" id="how">
        <div className="section-title">
          <p className="pip-eyebrow">02 / A more considered search</p>
          <h2>
            Less second-guessing.
            <br />
            <span>More forward motion.</span>
          </h2>
        </div>
        <div className="steps-grid">
          {steps.map((s) => (
            <article key={s.n}>
              <div className="step-top">
                <span>{s.n}</span>
                <s.icon size={25} />
              </div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </article>
          ))}
        </div>
        <div className="control-note">
          <ShieldCheck size={22} />
          <p>
            <strong>You make the final call.</strong> See the evidence, question
            a verdict and review every application before it goes out.
          </p>
        </div>
      </section>
      <section className="pip-section pip-wrap" id="contact">
        <div className="pricing-layout">
          <div className="section-title">
            <p className="pip-eyebrow">04 / Let’s talk</p>
            <h2>
              Your search.
              <br />
              <span>A real conversation.</span>
            </h2>
            <p>
              Tell me about the roles you’re looking for and the requirements
              getting in your way. We’ll talk through your situation and whether
              RoleClue could help.
            </p>
            <p className="pricing-context">
              RoleClue is not operating as a public service yet. This is a conversation about the project and your needs, with no obligation to join.
            </p>
          </div>
          <article className="price-card">
            <div className="price-top">
              <span>IN DEVELOPMENT · LET’S TALK</span>
              <ArrowUpRight size={22} />
            </div>
            <h3>Let’s talk about your job search.</h3>
            <p>
              Book a 30-minute conversation to see the project and talk through your search. Available daily, 8 am–8 pm Sydney time.
            </p>
            <ul>
              {[
                'Share your target roles and preferred locations',
                'Discuss work-rights and sponsorship questions in job listings',
                'See whether the eligibility-first approach fits your search',
              ].map((x) => (
                <li key={x}>
                  <Check size={16} />
                  {x}
                </li>
              ))}
            </ul>
            <Link className="pip-button" href="/book" data-analytics-location="contact">
              Let’s talk — choose a time <ArrowUpRight size={18} />
            </Link>
            {email && (
              <p>
                <a className="pip-text-link" href={`mailto:${email}`}>
                  {email}
                </a>
              </p>
            )}
            <p className="pip-caption">
              Review the available booking options on the next page.{' '}
              Please don’t send passport numbers, identity documents or other
              sensitive information.
            </p>
          </article>
        </div>
      </section>
      <section className="pip-section pip-wrap faq-section" id="questions">
        <div className="section-title">
          <p className="pip-eyebrow">05 / A few things worth knowing</p>
          <h2>
            Before your
            <br />
            <span>next move.</span>
          </h2>
        </div>
        <div className="faq-list">
          {questions.map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="closing-section">
        <div className="pip-wrap">
          <p className="pip-eyebrow">Your time deserves a better shortlist.</p>
          <h2>
            See the requirements.
            <br />
            See your next move.
          </h2>
          <div className="pip-actions">
            <Link className="pip-button light" href="/book">
              Let’s talk <ArrowUpRight size={18} />
            </Link>
            <Link
              className="pip-text-link"
              href="#in-use"
              data-analytics-location="footer"
            >
              See the project in use <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>
      <footer className="pip-footer pip-wrap">
        <div className="footer-top">
          <Brand />
          <p>
            Job eligibility for your next move in Australia.
            <br />
            Clearer decisions. Applications in your hands.
          </p>
          <a href="#top" className="pip-text-link">
            Back to top <ArrowUpRight size={16} />
          </a>
        </div>
        <nav aria-label="Legal and billing">
          {[
            ['Terms & Conditions', '/terms'],
            ['Membership Agreement', '/membership-agreement'],
            ['Privacy', '/privacy'],
            ['Refunds & Cancellation', '/refunds'],
            ['Cookies', '/cookies'],
            ['Disclaimer', '/disclaimer'],
          ].map(([label, href]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <p className="pip-caption">
          RoleClue does not provide migration or clearance advice, or guarantee jobs,
          interviews or sponsorship.
        </p>
      </footer>
    </main>
  );
}
