import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
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
    body: 'Pip checks the wording, highlights the blockers and brings unclear conditions to your attention.',
  },
  {
    n: '03',
    icon: FileText,
    title: 'Put your effort in the right place.',
    body: 'Choose a role worth pursuing. Prepare a tailored résumé and cover letter using your actual experience, then review and apply.',
  },
];
const questions = [
  [
    'Is Pip only for people in Canberra?',
    'No. Pip is for professionals exploring Australian jobs, whether you already live in Australia or are applying from overseas. Your preferred cities, relocation plans and work arrangements shape what is relevant to you.',
  ],
  [
    'Can I use Pip if I need visa sponsorship?',
    'Sponsorship is one of the requirements Pip helps you examine. An employer accepting temporary work rights today is different from offering sponsorship later. If the advertisement does not make that clear, the decision should stay uncertain until you confirm it with the employer.',
  ],
  [
    'Does a positive decision mean I will get the job?',
    'No. It means the available job requirements appear compatible with the profile being checked. Employers make hiring decisions. A good skills match, or an employer having sponsored before, does not guarantee an interview, sponsorship or an offer.',
  ],
  [
    'Will Pip find every available job?',
    'No. Coverage depends on the supported sources and the job information available. You should keep using your existing job boards and alerts, and check the original listing before applying.',
  ],
  [
    'Does Pip apply on my behalf?',
    'You stay in control. Review the evidence, edit any drafts and submit the application yourself. Pip does not invent experience or answer work-rights declarations for you.',
  ],
];
function Brand() {
  return (
    <a className="pip-brand" href="#top" aria-label="Pip home">
      <span className="pip-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      Pip<span className="brand-caption">Job eligibility</span>
    </a>
  );
}
export default function Home() {
  const { email, meetingHref, hasBookingLink } = getContactDetails();
  return (
    <main id="top" className="pip-landing">
      <a href="#main-content" className="pip-skip">
        Skip to content
      </a>
      <header className="pip-header">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="#decisions">Why Pip</a>
          <a href="#how">How it works</a>
          <a href="#contact">Contact</a>
          <a href="#questions">FAQs</a>
        </nav>
        <Link
          className="pip-button small"
          href="#contact"
          data-analytics-location="header"
        >
          Book a conversation <ArrowUpRight size={16} />
        </Link>
      </header>
      <section className="pip-hero pip-wrap" id="main-content">
        <div className="hero-heading">
          <p className="pip-eyebrow">
            <span className="pixel-dot" /> A clearer way to find your next role
          </p>
          <h1>
            Your skills fit.
            <br />
            Does the <span>job?</span>
          </h1>
        </div>
        <div className="hero-intro">
          <p>
            Find the requirements that matter <strong>before you apply.</strong>{' '}
            Pip checks work rights, sponsorship, citizenship, clearance and
            location—so you can focus on jobs worth your time.
          </p>
          <div className="pip-actions">
            <a className="pip-button" href="#decisions">
              See how Pip decides <ArrowDown size={17} />
            </a>
            <Link
              className="pip-text-link"
              href="#contact"
              data-analytics-location="hero"
            >
              Let’s talk <ArrowUpRight size={17} />
            </Link>
          </div>
          <p className="hero-audience">
            For professionals in Australia.
            <br />
            And those planning their next move here.
          </p>
        </div>
        <div
          className="signal-stage"
          aria-label="Illustrative diagram: job requirements checked against your situation"
        >
          <div className="stage-top">
            <span>FROM SEARCH RESULTS TO A CLEARER DECISION</span>
            <span>THE PIP APPROACH ↗</span>
          </div>
          <div className="signal-input">
            <span className="pip-eyebrow">Your next opportunity</span>
            <div className="signal-lines">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <p>More than a keyword match.</p>
          </div>
          <div className="signal-engine">
            <div className="engine-grid" aria-hidden="true">
              {Array.from({ length: 81 }, (_, i) => (
                <i
                  key={i}
                  className={
                    i % 9 > 1 &&
                    i % 9 < 7 &&
                    Math.floor(i / 9) > 1 &&
                    Math.floor(i / 9) < 7
                      ? 'filled'
                      : ''
                  }
                />
              ))}
            </div>
            <span className="engine-label">Pip / eligibility engine</span>
          </div>
          <div className="signal-output">
            <div>
              <CheckCheck size={19} />
              <span>Worth pursuing</span>
              <ArrowUpRight size={18} />
            </div>
            <div>
              <CircleHelp size={19} />
              <span>Needs a closer look</span>
              <span>?</span>
            </div>
            <div>
              <X size={19} />
              <span>A requirement rules it out</span>
              <span>−</span>
            </div>
          </div>
          <div className="stage-bottom">
            <span>YOUR PROFILE × THE JOB REQUIREMENTS</span>
            <span>Illustrative workflow</span>
          </div>
        </div>
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
            sponsorship.” Pip brings those conditions to the surface before you
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
                  <dt>Pip’s decision</dt>
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
                  <dt>Pip’s decision</dt>
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
                  <dt>Pip’s decision</dt>
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
      <section className="data-section pip-wrap" aria-labelledby="data-title">
        <div>
          <p className="pip-eyebrow">03 / What the data shows</p>
          <h2 id="data-title">
            Eligibility deserves
            <br />a place in your search.
          </h2>
          <p>
            In an analysed dataset, more than a third of opportunities were
            marked as failing an eligibility requirement.
          </p>
        </div>
        <div className="data-stat">
          <strong>
            36.1<span>%</span>
          </strong>
          <span>352 of 976 opportunities</span>
          <p>Marked as eligibility failures</p>
        </div>
        <p className="pip-caption data-footnote">
          Data snapshot: 9 September 2026. A single search dataset with
          automated classifications; not a representative labour-market sample
          or evidence of hiring outcomes. Results vary with the profile and
          sources used.
        </p>
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
              Pip could help.
            </p>
            <p className="pricing-context">
              An introductory product conversation—not migration advice, a job
              placement or a promise of sponsorship.
            </p>
          </div>
          <article className="price-card">
            <div className="price-top">
              <span>CONTACT & BOOKING</span>
              <ArrowUpRight size={22} />
            </div>
            <h3>Let’s talk about your job search.</h3>
            <p>
              Reach me directly to arrange a time that works for both of us.
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
            {meetingHref ? (
              <a
                className="pip-button"
                href={meetingHref}
                data-analytics-location="contact"
                {...(hasBookingLink
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                {hasBookingLink
                  ? 'Choose a time to talk'
                  : 'Email to arrange a time'}{' '}
                <ArrowUpRight size={18} />
              </a>
            ) : (
              <p className="contact-unavailable">
                Contact and booking details will be available here soon.
              </p>
            )}
            {email && (
              <p>
                <a className="pip-text-link" href={`mailto:${email}`}>
                  {email}
                </a>
              </p>
            )}
            <p className="pip-caption">
              {hasBookingLink
                ? 'Choose an available slot on the booking page.'
                : 'Suggest a few suitable times and your time zone. Your meeting is only booked once we confirm it by email.'}{' '}
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
            <a className="pip-button light" href="#decisions">
              Explore the decisions <ArrowRight size={18} />
            </a>
            <Link
              className="pip-text-link"
              href="#contact"
              data-analytics-location="footer"
            >
              Talk about your search <ArrowUpRight size={18} />
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
            ['Billing', '/billing'],
          ].map(([label, href]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <p className="pip-caption">
          Pip does not provide migration or clearance advice, or guarantee jobs,
          interviews or sponsorship.
        </p>
      </footer>
    </main>
  );
}
