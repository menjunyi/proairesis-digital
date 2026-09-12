import type { ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Scale } from 'lucide-react';
import Link from 'next/link';

const legalLinks = [
  { href: '/terms', label: 'Terms' },
  { href: '/membership-agreement', label: 'Membership Agreement' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/refunds', label: 'Refunds' },
  { href: '/cookies', label: 'Cookies' },
  { href: '/disclaimer', label: 'Disclaimer' },
];

function renderInline(source: string): ReactNode[] {
  const parts = source.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);

  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const external = /^https?:\/\//.test(link[2]);
      return (
        <a
          key={index}
          href={link[2]}
          className="font-bold text-[#245f8e] underline decoration-[#286b9e]/35 underline-offset-4 hover:text-[#286b9e]"
          {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
        >
          {link[1]}
          {external && <ArrowUpRight className="ml-1 inline h-3.5 w-3.5" />}
        </a>
      );
    }

    return part;
  });
}

function MarkdownDocument({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    if (line.startsWith('# ')) {
      blocks.push(
        <h1
          key={`h1-${index}`}
          className="max-w-4xl text-4xl font-semibold leading-[1.02] tracking-[-0.055em] text-[#17324d] sm:text-6xl"
        >
          {renderInline(line.slice(2))}
        </h1>,
      );
      continue;
    }

    if (line.startsWith('## ')) {
      blocks.push(
        <h2
          key={`h2-${index}`}
          className="mt-12 scroll-mt-28 border-t border-[#17324d]/10 pt-9 text-2xl font-semibold tracking-[-0.035em] text-[#17324d] sm:text-3xl"
        >
          {renderInline(line.slice(3))}
        </h2>,
      );
      continue;
    }

    if (line.startsWith('### ')) {
      blocks.push(
        <h3
          key={`h3-${index}`}
          className="mt-8 text-lg font-semibold text-[#17324d]"
        >
          {renderInline(line.slice(4))}
        </h3>,
      );
      continue;
    }

    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('- ')) {
        items.push(lines[index].trim().slice(2));
        index += 1;
      }
      index -= 1;
      blocks.push(
        <ul
          key={`ul-${index}`}
          className="my-5 space-y-3 pl-6 text-[0.98rem] leading-7 text-[#425e75] marker:text-[#286b9e]"
        >
          {items.map((item, itemIndex) => (
            <li key={itemIndex} className="pl-1">
              {renderInline(item)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s/, ''));
        index += 1;
      }
      index -= 1;
      blocks.push(
        <ol
          key={`ol-${index}`}
          className="my-5 list-decimal space-y-3 pl-6 text-[0.98rem] leading-7 text-[#425e75] marker:font-semibold marker:text-[#286b9e]"
        >
          {items.map((item, itemIndex) => (
            <li key={itemIndex} className="pl-1">
              {renderInline(item)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    blocks.push(
      <p
        key={`p-${index}`}
        className="my-4 text-[0.98rem] leading-7 text-[#425e75]"
      >
        {renderInline(line.replace(/\s{2}$/, ''))}
      </p>,
    );
  }

  return <>{blocks}</>;
}

export function LegalDocumentPage({
  source,
  activeHref,
}: {
  source: string;
  activeHref: string;
}) {
  return (
    <main className="min-h-screen bg-[#f3f8fc] text-[#17324d]">
      <header className="border-b border-[#17324d]/10 bg-[#f3f8fc]/95 px-5 py-4 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-[#deeffc]">
              <span aria-hidden="true" className="text-xl font-semibold">
                R
              </span>
            </span>
            <span className="text-xl font-semibold tracking-[-0.04em]">
              RoleClue
            </span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#425e75] transition-colors hover:text-[#286b9e]"
          >
            <ArrowLeft className="h-4 w-4" /> Back to RoleClue
          </Link>
        </div>
      </header>

      <nav
        aria-label="Legal documents"
        className="sticky top-0 z-10 border-b border-[#17324d]/10 bg-[#f3f8fc]/95 px-5 py-3 backdrop-blur sm:px-8 lg:px-12"
      >
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto">
          {legalLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.href === activeHref ? 'page' : undefined}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                item.href === activeHref
                  ? 'bg-[#17324d] text-white'
                  : 'text-[#536d83] hover:bg-[#e7f1f9] hover:text-[#17324d]'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      <div className="px-5 py-12 sm:px-8 sm:py-16 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 flex gap-4 rounded-2xl border border-[#286b9e]/20 bg-[#deeffc]/55 p-5 text-[#245f8e]">
            <Scale className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm font-bold leading-6">
              Working draft: bracketed business details must be completed and
              Australian and New Zealand lawyers should review this document
              before launch.
            </p>
          </div>

          <article className="rounded-[2rem] border border-[#17324d]/10 bg-[#ffffff] px-6 py-9 shadow-[0_24px_70px_rgba(45,91,126,0.07)] sm:px-10 sm:py-12 lg:px-16">
            <MarkdownDocument source={source} />
          </article>
        </div>
      </div>

      <footer className="bg-[#17324d] px-5 py-9 text-white/70 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">RoleClue legal and policy documents</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold">
            {legalLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
