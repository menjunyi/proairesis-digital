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
  {name: 'Work rights', detail: 'Your right to work in Australia'},
  {name: 'Sponsorship', detail: 'Whether you need it now or later'},
  {name: 'Citizenship', detail: 'The citizenship you hold'},
  {name: 'Clearance', detail: 'Your current security clearance'},
  {name: 'Location', detail: 'Where you want to work'},
];
const steps = [
  {
    n: '01',
    icon: SlidersHorizontal,
    title: 'Start with your situation.',
    body: 'Set your citizenship, clearance, work rights and sponsorship needs, alongside your preferred locations and experience.',
  },
  {
    n: '02',
    icon: ScanLine,
    title: 'Bring the requirements together.',
    body: 'RoleClue aggregates job descriptions from supported sources, surfaces eligibility requirements and flags anything the listing leaves unclear.',
  },
  {
    n: '03',
    icon: FileText,
    title: 'Spend less time filtering.',
    body: 'Review a shortlist shaped by your situation instead of reading every listing yourself. Check the source wording and any uncertain requirements before you decide.',
  },
];
const questions = [
  ['What do I get for booking a conversation?', 'Everyone who books a conversation with me will be invited to join RoleClue’s first group of users and receive one month of free usage. I’ll send your early-access invitation to the email address used for your booking.'],
  ['Can I use RoleClue today?', 'RoleClue is a working personal project, not a publicly operating service yet. The screenshots show the system I use for my own search. Book a conversation to see the workflow, share your challenges and help shape what comes next.'],
  [
    'Who is RoleClue’s Australian job search for?',
    'RoleClue is for people seeking work in Australia who keep encountering requirements that make otherwise promising jobs unsuitable. This includes non-citizens, Australian citizens without the required security clearance, and people whose location, work rights, sponsorship needs or experience limit which roles fit. Your shortlist should reflect your situation. Citizenship and clearance are requirements to check in job ads, not requirements to use RoleClue.',
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
            <span className="pixel-dot" /> Australian jobs that fit your situation · In development
          </p>
          <h1>
            Your skills fit.
            <br />
            Do the
            <br />
            <span><em className="slogan-accent">requirements?</em></span>
          </h1>
        </div>
        <div className="hero-intro">
          <p>
            A promising job. Then you read <strong>“Australian citizens only”</strong> or
            <strong> “Current security clearance required.”</strong>{' '}
            RoleClue helps you find jobs that fit your situation, whether you’re a
            non-citizen, a citizen without clearance, or limited by location,
            work rights or the role’s experience requirements.
          </p>
          <div className="pip-actions">
            <Link className="pip-button" href="/book" data-analytics-location="hero">Help shape RoleClue <ArrowUpRight size={17} /></Link>
            <a className="pip-text-link" href="#in-use">Explore the features <ArrowDown size={17} /></a>
          </div>
          <p className="hero-stage-note">Share what you need in a 30-minute chat. Join the first users and get one month free when access opens.</p>
        </div>
      </section>
      <section className="founder-stats pip-wrap" aria-label="My job search in numbers">
        <div className="founder-stats-heading"><p className="pip-eyebrow">MY JOB SEARCH, IN NUMBERS</p><span>Snapshot · 14 September 2026</span></div>
        <dl>
          <div><dt>Jobs filtered out</dt><dd>914</dd></div>
          <div><dt>Applications submitted</dt><dd>18</dd></div>
          <div><dt>Reached interview</dt><dd>1</dd></div>
          <div><dt>Estimated reduction in manual screening</dt><dd>85%</dd></div>
        </dl>
        <p className="founder-stats-note">My personal tracker: jobs flagged for eligibility, language or location requirements. The interview is included in the 18 submissions.</p>
      </section>
      <section className="pip-section pip-wrap" id="in-use">
        <div className="section-title"><p className="pip-eyebrow">01 / Your search preferences</p><h2>Your filters.<br /><span>Your shortlist.</span></h2><p>Set your situation once. See relevant jobs and the requirements behind each match.</p></div>
        <div className="eligibility-settings">
          <h3>Choose what fits your situation.</h3>
          <dl>{checks.map(({name,detail})=><div key={name}><dt><SlidersHorizontal size={17} aria-hidden="true" />{name}</dt><dd>{detail}</dd></div>)}</dl>
          <p>Missing or unclear requirements stay flagged for you to check.</p>
        </div>


      </section>
      <section className="pip-section pip-wrap" id="decisions">
        <div className="section-title">
          <p className="pip-eyebrow">02 / Check the requirements</p>
          <h2>
            A great match.
            <br />
            <span>Until the fine print.</span>
          </h2>
          <p>
            Your skills match, but the listing requires Australian citizenship or a
            security clearance you don’t hold. Or the location or experience level doesn’t fit. You can spend hours
            finding these restrictions one listing at a time. RoleClue brings them
            into view sooner and flags unclear requirements for you to confirm.
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
          <article className="decision-card skill-fit-card">
            <div className="decision-state"><ScanLine size={19} /> Skill fit <span>03</span></div>
            <div className="role-body">
              <p className="role-meta">ILLUSTRATIVE ASSESSMENT · SOFTWARE ENGINEER</p>
              <h3>See how your skills match.</h3>
              <div className="skill-fit-score"><strong>82<span>%</span></strong><span>Estimated skill match</span></div>
              <meter className="skill-fit-meter" aria-label="Illustrative skill match" value={82} min={0} max={100}>82%</meter>
              <dl><div><dt>Strengths</dt><dd>Python, SQL and cloud experience</dd></div><div><dt>Gap to review</dt><dd>Production Kubernetes experience</dd></div></dl>
              <p className="decision-note">An estimated match to the role’s skills—not your chance of getting hired. Eligibility requirements are checked separately.</p>
            </div>
          </article>
          <article className="decision-card positive">
            <div className="decision-state">
              <Check size={19} /> Worth pursuing <span>04</span>
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
      <section className="pip-section pip-wrap" id="how">
        <div className="section-title">
          <p className="pip-eyebrow">03 / How it works</p>
          <h2>
            Set your filters.
            <br />
            <span>Review your matches.</span>
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
        {screenshotsReady && <div className="screen-story feature-story">
          {[
            {image:'opportunities-v2', number:'01', height:1000, title:'Find jobs that fit your filters.', body:'Compare opportunities in one shortlist, with unsuitable roles filtered out and unclear requirements flagged.', alt:'Opportunity shortlist with fit scores and flagged requirements.'},
            {image:'applications-assessment', number:'02', width:1712, height:925, title:'See why a role fits—or doesn’t.', body:'Review eligibility blockers, strengths and skill gaps alongside the job description before you apply.', alt:'Application assessment showing personal fit, blockers and a review timeline.'},
          ].map(screen=><figure className="screen-story-card" key={screen.image}><figcaption><span className="screen-number">{screen.number}</span><div><h3>{screen.title}</h3><p>{screen.body}</p></div></figcaption><a href={`/screenshots/${screen.image}.png`} target="_blank" rel="noopener noreferrer" aria-label={`Enlarge: ${screen.title}`}><img src={`/screenshots/${screen.image}.png`} width={screen.width || 1600} height={screen.height} alt={screen.alt} loading="lazy" /></a></figure>)}
        </div>}
        <p className="pip-caption">Screens from the working prototype. Public access is in development.</p>
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
              Your ideas.
              <br />
              <span>Let’s build them together.</span>
            </h2>
            <p>
              Looking for work in Australia? Tell me where citizenship, clearance,
              location or role requirements get in your way, and what would make your
              search easier. Help shape what I build next.
            </p>
            <p className="pricing-context">
              RoleClue is still in development. Join early and help decide what comes next.
            </p>
          </div>
          <article className="price-card">
            <div className="price-top">
              <span>IN DEVELOPMENT · LET’S TALK</span>
              <ArrowUpRight size={22} />
            </div>
            <h3>Tell me what you want to build.</h3>
            <p>
              Bring your ideas to a 30-minute chat. Let’s turn your job-search frustrations into useful features.
            </p>
            <ul>
              {[
                'Tell me what’s missing from your current tools',
                'Shape the filters and features you want',
                'Try what I build and help improve it',
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
            Australian jobs that fit your situation.
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
