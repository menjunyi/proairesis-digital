import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Eye,
  FileCheck2,
  Fingerprint,
  Gauge,
  LockKeyhole,
  MapPin,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';

const decisionRows = [
  {
    label: 'Work rights',
    value: 'Eligible',
    detail: 'Unrestricted Australian work rights accepted',
    tone: 'good',
  },
  {
    label: 'Citizenship',
    value: 'No gate found',
    detail: 'No citizenship requirement in the posting',
    tone: 'good',
  },
  {
    label: 'Location',
    value: 'Eligible',
    detail: 'Hybrid in Canberra, two days on site',
    tone: 'good',
  },
  {
    label: 'Clearance',
    value: 'Human check',
    detail: '“Ability to obtain Baseline” needs confirmation',
    tone: 'check',
  },
];

const steps = [
  {
    number: '01',
    title: 'Set your hard boundaries',
    body: 'Tell Pip your work rights, citizenship, clearance, location, seniority and sponsorship constraints once.',
    icon: Fingerprint,
  },
  {
    number: '02',
    title: 'Get a shortlist that shows its work',
    body: 'Every verdict includes the exact evidence from the posting, a fit rationale and the largest gap.',
    icon: SearchCheck,
  },
  {
    number: '03',
    title: 'Choose one worth pursuing',
    body: 'Pip prepares a truthful CV and cover-letter draft. You review every claim and make the final call.',
    icon: FileCheck2,
  },
];

const principles = [
  {
    title: 'Evidence, not a mystery score',
    body: 'See the sentence behind every eligibility decision and flag uncertainty instead of trusting a black box.',
    icon: Eye,
  },
  {
    title: 'Quality, not application volume',
    body: 'A short list of credible roles beats another feed of hundreds. Pip helps you apply less—and mean it more.',
    icon: Gauge,
  },
  {
    title: 'Human approval by design',
    body: 'No automatic declarations, invented achievements or final submit click. You remain accountable and in control.',
    icon: ShieldCheck,
  },
  {
    title: 'Privacy is part of the product',
    body: 'Built from a local-first system and designed to minimise the sensitive career data a service needs to retain.',
    icon: LockKeyhole,
  },
];

function Brand() {
  return (
    <a href="#top" className="flex items-center gap-3" aria-label="Pip home">
      <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-[#dff7ef] ring-1 ring-[#173c3e]/10">
        <img
          src="/pip-flight.gif"
          alt=""
          className="h-12 w-12 scale-125 object-contain"
        />
      </span>
      <span className="leading-none">
        <span className="block text-lg font-black tracking-[-0.04em] text-[#173c3e]">
          Pip
        </span>
        <span className="mt-1 block text-[9px] font-bold uppercase tracking-[0.18em] text-[#587174]">
          AI Job Search
        </span>
      </span>
    </a>
  );
}

export default function Home() {
  return (
    <main id="top" className="overflow-hidden">
      <header className="sticky top-0 z-50 border-b border-[#173c3e]/10 bg-[#fbf8ef]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-12">
          <Brand />
          <nav className="hidden items-center gap-8 text-sm font-semibold text-[#405f62] md:flex" aria-label="Main navigation">
            <a className="transition-colors hover:text-[#e55336]" href="#why">Why Pip</a>
            <a className="transition-colors hover:text-[#e55336]" href="#how">How it works</a>
            <a className="transition-colors hover:text-[#e55336]" href="#trust">Trust</a>
          </nav>
          <a
            href="#pilot"
            className="group inline-flex items-center gap-2 rounded-full bg-[#173c3e] px-5 py-3 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e55336]/25"
          >
            See the pilot
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>
      </header>

      <section className="relative bg-[#fbf8ef]">
        <div className="hero-orbit pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto grid min-h-[calc(100svh-76px)] max-w-7xl items-center gap-14 px-5 py-16 sm:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:px-12 lg:py-20">
          <div className="max-w-2xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#e55336]/20 bg-white/70 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-[#b83f28] shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
              Canberra pilot · eligibility first
            </div>
            <h1 className="max-w-[720px] text-[clamp(3.4rem,8vw,7.2rem)] font-black leading-[0.87] tracking-[-0.075em] text-[#173c3e]">
              Find the jobs you can{' '}
              <span className="relative inline-block text-[#e55336]">
                actually
                <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 220 16" aria-hidden="true">
                  <path d="M4 11C54 3 151 3 216 9" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
                </svg>
              </span>{' '}
              pursue.
            </h1>
            <p className="mt-9 max-w-xl text-lg leading-8 text-[#405f62] sm:text-xl">
              Pip checks work rights, citizenship, clearance, location and seniority before you spend hours applying—then gives you a short, evidence-backed shortlist and a truthful application draft for the role you choose.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                href="#how"
                className="group inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-[#e55336] px-7 text-base font-black text-white shadow-[0_12px_30px_rgba(229,83,54,0.24)] transition-transform hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e55336]/25"
              >
                See how Pip decides
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </a>
              <a
                href="#pilot"
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full border border-[#173c3e]/20 bg-white/50 px-7 text-base font-black text-[#173c3e] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#173c3e]/10"
              >
                Is this for me?
              </a>
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold text-[#587174]">
              <span className="flex items-center gap-2"><Check className="h-4 w-4 text-[#13866f]" /> No auto-apply</span>
              <span className="flex items-center gap-2"><Check className="h-4 w-4 text-[#13866f]" /> No invented claims</span>
              <span className="flex items-center gap-2"><Check className="h-4 w-4 text-[#13866f]" /> You approve everything</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[650px] lg:mx-0">
            <div className="signal-grid relative rounded-[2.4rem] bg-[#173c3e] p-4 shadow-[0_30px_80px_rgba(23,60,62,0.25)] sm:p-7">
              <div className="mb-5 flex items-center justify-between px-1 text-white/70">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em]">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#f5c85b]" />
                  Decision brief
                </div>
                <span className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-bold">Updated today</span>
              </div>

              <article className="rounded-[1.8rem] bg-[#fffdf7] p-5 shadow-2xl sm:p-7">
                <div className="flex flex-col justify-between gap-5 border-b border-[#173c3e]/10 pb-6 sm:flex-row sm:items-start">
                  <div>
                    <div className="mb-3 flex items-center gap-2 text-xs font-bold text-[#587174]">
                      <MapPin className="h-3.5 w-3.5" /> Canberra · Hybrid
                    </div>
                    <h2 className="text-2xl font-black tracking-[-0.035em] text-[#173c3e]">Data Platform Engineer</h2>
                    <p className="mt-1 text-sm font-semibold text-[#587174]">Infrastructure team · Permanent</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 rounded-2xl bg-[#dff7ef] px-4 py-3 text-[#0b6c59]">
                    <CheckCircle2 className="h-6 w-6" />
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.14em]">Verdict</div>
                      <div className="text-sm font-black">Worth a closer look</div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-2.5">
                  {decisionRows.map((row) => (
                    <div key={row.label} className="grid gap-2 rounded-2xl border border-[#173c3e]/8 bg-white px-4 py-3 sm:grid-cols-[116px_108px_1fr] sm:items-center">
                      <span className="text-xs font-black uppercase tracking-[0.08em] text-[#587174]">{row.label}</span>
                      <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black ${row.tone === 'good' ? 'bg-[#dff7ef] text-[#0b6c59]' : 'bg-[#fff0c8] text-[#8a5c00]'}`}>
                        {row.tone === 'good' ? <Check className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
                        {row.value}
                      </span>
                      <span className="text-xs leading-5 text-[#405f62]">{row.detail}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="rounded-2xl bg-[#f1eee4] px-4 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.13em] text-[#587174]">Largest fit gap</div>
                    <p className="mt-1 text-sm font-bold text-[#173c3e]">Kubernetes depth needs stronger evidence</p>
                  </div>
                  <div className="flex items-center justify-center rounded-2xl bg-[#e55336] px-5 py-3 text-white">
                    <span className="mr-2 text-3xl font-black tracking-[-0.06em]">86</span>
                    <span className="text-[10px] font-black uppercase leading-4 tracking-[0.11em]">Fit<br />score</span>
                  </div>
                </div>
              </article>

              <div className="absolute -right-4 -top-10 hidden h-32 w-32 overflow-hidden sm:block lg:-right-7">
                <img src="/pip-flight.gif" alt="Pip the courier bird flying with an application" className="h-full w-full object-contain drop-shadow-xl" />
              </div>
            </div>

            <div className="absolute -bottom-9 -left-3 rounded-2xl border border-[#173c3e]/10 bg-white px-5 py-4 shadow-xl sm:-left-8">
              <div className="text-3xl font-black tracking-[-0.05em] text-[#e55336]">43.5%</div>
              <div className="mt-1 max-w-[155px] text-xs font-bold leading-5 text-[#405f62]">of roles failed eligibility gates in the founder’s current dataset*</div>
            </div>
          </div>
        </div>
        <p className="mx-auto max-w-7xl px-5 pb-8 text-[11px] text-[#718386] sm:px-8 lg:px-12">*252 of 579 opportunities. Founder operating data, September 2026—not a customer outcome claim.</p>
      </section>

      <section id="why" className="bg-[#173c3e] px-5 py-24 text-white sm:px-8 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
            <div>
              <p className="section-kicker text-[#f5c85b]">Why Pip exists</p>
              <h2 className="mt-5 text-4xl font-black leading-[0.98] tracking-[-0.055em] sm:text-6xl">More jobs are not the answer.</h2>
            </div>
            <p className="max-w-2xl text-xl leading-8 text-white/66 sm:text-2xl sm:leading-10">
              Job boards optimise for showing you options. Generic AI tools optimise for producing documents. Neither begins with the decision that matters: <strong className="font-black text-white">is this role genuinely open to someone like me?</strong>
            </p>
          </div>

          <div className="mt-16 grid overflow-hidden rounded-[2rem] border border-white/12 md:grid-cols-3">
            <div className="border-b border-white/12 p-7 md:border-b-0 md:border-r lg:p-9">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e55336]/15 text-[#ff8c73]"><X className="h-5 w-5" /></span>
              <h3 className="mt-7 text-xl font-black">The hard gate is buried</h3>
              <p className="mt-3 leading-7 text-white/60">Citizenship, clearance, sponsorship and location requirements often appear deep inside the description.</p>
            </div>
            <div className="border-b border-white/12 p-7 md:border-b-0 md:border-r lg:p-9">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#f5c85b]/15 text-[#f5c85b]"><CircleAlert className="h-5 w-5" /></span>
              <h3 className="mt-7 text-xl font-black">A match score hides the why</h3>
              <p className="mt-3 leading-7 text-white/60">A high keyword score is useless if one non-negotiable condition makes the opportunity inaccessible.</p>
            </div>
            <div className="p-7 lg:p-9">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#72d6bd]/15 text-[#72d6bd]"><CheckCircle2 className="h-5 w-5" /></span>
              <h3 className="mt-7 text-xl font-black">Selective looks stronger</h3>
              <p className="mt-3 leading-7 text-white/60">Pip helps you invest in a few credible applications with evidence, care and your own voice.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="bg-[#f0ede3] px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="section-kicker text-[#b83f28]">How it works</p>
            <h2 className="mt-5 text-4xl font-black leading-tight tracking-[-0.055em] text-[#173c3e] sm:text-6xl">From noisy search to a defensible decision.</h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-[#587174]">The first product is intentionally small: fewer than five new roles, twice a week, with one review-ready application pack for the role you select.</p>
          </div>

          <div className="relative mt-16 grid gap-5 lg:grid-cols-3">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <article key={step.number} className="group relative rounded-[2rem] border border-[#173c3e]/10 bg-[#fffdf7] p-7 transition-transform hover:-translate-y-1 lg:p-9">
                  <div className="flex items-start justify-between">
                    <span className="font-mono text-sm font-black text-[#e55336]">{step.number}</span>
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#dff7ef] text-[#0b6c59] transition-transform group-hover:rotate-3"><Icon className="h-6 w-6" /></span>
                  </div>
                  <h3 className="mt-12 text-2xl font-black tracking-[-0.04em] text-[#173c3e]">{step.title}</h3>
                  <p className="mt-4 leading-7 text-[#587174]">{step.body}</p>
                </article>
              );
            })}
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-6 rounded-[2rem] bg-[#e55336] px-7 py-8 text-white sm:flex-row lg:px-10">
            <div className="flex items-start gap-4">
              <span className="mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/15"><ShieldCheck className="h-5 w-5" /></span>
              <div>
                <h3 className="text-xl font-black">The stop button is a feature.</h3>
                <p className="mt-1 max-w-2xl text-white/80">Uncertain requirement? Missing fact? Legal declaration? Pip stops and asks. It never guesses on your behalf.</p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-white px-5 py-2 text-sm font-black text-[#b83f28]">Human check required</span>
          </div>
        </div>
      </section>

      <section id="trust" className="bg-[#fffdf7] px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="section-kicker text-[#b83f28]">Built for trust</p>
              <h2 className="mt-5 max-w-md text-4xl font-black leading-[1.02] tracking-[-0.055em] text-[#173c3e] sm:text-6xl">AI that knows where its job ends.</h2>
              <p className="mt-6 max-w-md text-lg leading-8 text-[#587174]">The bright point is not automatic writing. It is transparent judgment, honest drafting and clear human accountability.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {principles.map((principle) => {
                const Icon = principle.icon;
                return (
                  <article key={principle.title} className="rounded-[1.7rem] border border-[#173c3e]/10 bg-[#fbf8ef] p-7">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#173c3e] text-white"><Icon className="h-5 w-5" /></span>
                    <h3 className="mt-8 text-xl font-black tracking-[-0.035em] text-[#173c3e]">{principle.title}</h3>
                    <p className="mt-3 leading-7 text-[#587174]">{principle.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[#173c3e]/10 bg-[#f5c85b] px-5 py-20 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="section-kicker text-[#704900]">Built from a real search</p>
            <h2 className="mt-4 max-w-4xl text-4xl font-black leading-[1.02] tracking-[-0.055em] text-[#173c3e] sm:text-6xl">579 opportunities in. The lesson is clear: filtering comes before writing.</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-[150px] rounded-2xl bg-[#fffdf7]/80 p-5">
              <div className="text-4xl font-black tracking-[-0.06em] text-[#e55336]">252</div>
              <p className="mt-1 text-xs font-bold leading-5 text-[#405f62]">eligibility failures</p>
            </div>
            <div className="min-w-[150px] rounded-2xl bg-[#173c3e] p-5 text-white">
              <div className="text-4xl font-black tracking-[-0.06em] text-[#72d6bd]">25</div>
              <p className="mt-1 text-xs font-bold leading-5 text-white/70">labelled high fit</p>
            </div>
          </div>
        </div>
        <p className="mx-auto mt-8 max-w-7xl text-xs font-semibold text-[#704900]">Founder operating data, not proof of customer demand or hiring outcomes. The pilot exists to test whether this value generalises.</p>
      </section>

      <section id="pilot" className="bg-[#173c3e] px-5 py-24 text-white sm:px-8 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-7xl">
          <div className="grid overflow-hidden rounded-[2.5rem] bg-[#fffdf7] text-[#173c3e] lg:grid-cols-[0.9fr_1.1fr]">
            <div className="relative flex min-h-[420px] flex-col justify-between overflow-hidden bg-[#e55336] p-8 text-white sm:p-12">
              <div className="pilot-rings pointer-events-none absolute inset-0" aria-hidden="true" />
              <div className="relative">
                <p className="section-kicker text-white/75">First pilot</p>
                <h2 className="mt-5 max-w-md text-4xl font-black leading-[1] tracking-[-0.055em] sm:text-6xl">A job search built around your constraints.</h2>
              </div>
              <img src="/pip-flight.gif" alt="Pip flying with an application" className="relative -mb-16 -ml-10 w-60 self-end drop-shadow-2xl sm:w-72" />
            </div>
            <div className="p-8 sm:p-12 lg:p-14">
              <p className="text-sm font-black uppercase tracking-[0.13em] text-[#b83f28]">You may be a fit if you</p>
              <ul className="mt-7 space-y-5">
                {[
                  'work in technology and are actively searching in Australia',
                  'hold work rights but face citizenship, clearance or sponsorship constraints',
                  'search in Canberra or another market with frequent hard gates',
                  'want to apply selectively—and review every AI-assisted claim',
                ].map((item) => (
                  <li key={item} className="flex gap-4 text-lg font-bold leading-7">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#dff7ef] text-[#0b6c59]"><Check className="h-3.5 w-3.5" /></span>
                    {item}
                  </li>
                ))}
              </ul>

              <div className="mt-9 rounded-2xl bg-[#f0ede3] p-5">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-[#587174]">Pilot promise</p>
                <p className="mt-2 font-bold leading-7">Up to five evidence-backed roles, twice weekly—plus one truthful, review-ready application pack for the role you choose.</p>
              </div>

              <a
                href="https://github.com/frJEN/ai-job-search-au-starter"
                target="_blank"
                rel="noreferrer"
                className="group mt-7 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-[#173c3e] px-7 text-base font-black text-white transition-transform hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#173c3e]/20 sm:w-auto"
              >
                Explore the open-source foundation
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </a>
              <p className="mt-4 text-xs leading-5 text-[#718386]">Pilot registration is coming next. No job, interview or visa outcome is promised.</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-[#102d2f] px-5 py-10 text-white/65 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <Brand />
          <p className="max-w-xl text-sm leading-6">An eligibility-first job-search product in validation. Human-reviewed, evidence-backed and deliberately not an auto-apply tool.</p>
          <a href="#top" className="inline-flex items-center gap-1 text-sm font-black text-white transition-colors hover:text-[#72d6bd]">Back to top <ChevronRight className="h-4 w-4 -rotate-90" /></a>
        </div>
      </footer>
    </main>
  );
}
