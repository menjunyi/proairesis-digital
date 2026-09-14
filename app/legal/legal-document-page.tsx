import { RoleClueMark } from '@/components/roleclue-mark';
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
          className="font-bold text-[#245c54] underline decoration-[#236451]/35 underline-offset-4 hover:text-[#236451]"
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
          className="max-w-4xl text-3xl font-semibold leading-[1.12] tracking-[-0.055em] text-[#062f3b] sm:text-5xl"
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
          className="mt-12 scroll-mt-28 border-t border-[#062f3b]/10 pt-9 text-2xl font-semibold tracking-[-0.035em] text-[#062f3b] sm:text-3xl"
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
          className="mt-8 text-lg font-semibold text-[#062f3b]"
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
          className="my-5 space-y-3 pl-6 text-[0.98rem] leading-7 text-[#526d70] marker:text-[#236451]"
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
          className="my-5 list-decimal space-y-3 pl-6 text-[0.98rem] leading-7 text-[#526d70] marker:font-semibold marker:text-[#236451]"
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
        className="my-4 text-[0.98rem] leading-7 text-[#526d70]"
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
    <main className="min-h-screen bg-[#fbf4e8] text-[#062f3b]">
      <header className="border-b border-[#062f3b]/10 bg-[#fbf4e8]/95 px-5 py-4 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center">
              <RoleClueMark className="size-8 text-[#c34527]" />
            </span>
            <span className="text-[28px] font-extrabold tracking-[-0.04em] text-[#c34527]">
              RoleClue
            </span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#526d70] transition-colors hover:text-[#236451]"
          >
            <ArrowLeft className="h-4 w-4" /> Back to RoleClue
          </Link>
        </div>
      </header>

      <nav
        aria-label="Legal documents"
        className="sticky top-0 z-10 border-b border-[#062f3b]/10 bg-[#fbf4e8]/95 px-5 py-3 backdrop-blur sm:px-8 lg:px-12"
      >
        <div className="mx-auto flex max-w-[1200px] flex-wrap gap-1 sm:gap-2">
          {legalLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.href === activeHref ? 'page' : undefined}
              className={`shrink-0 rounded-full px-3 py-2 text-xs sm:text-sm font-semibold transition-colors ${
                item.href === activeHref
                  ? 'bg-[#062f3b] text-white'
                  : 'text-[#526d70] hover:bg-[#f2e8d8] hover:text-[#062f3b]'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      <div className="px-5 py-8 sm:px-8 sm:py-10 lg:px-12">
        <div className="mx-auto max-w-[1200px]">
          <div className="mb-6 flex gap-4 rounded-2xl border border-[#236451]/20 bg-[#d9eee3]/55 p-5 text-[#245c54]">
            <Scale className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm font-medium leading-6">
              These policies cover the current public website and free introductory
              conversations. RoleClue is still in development; paid services are not available.
            </p>
          </div>

          <article className="rounded-[20px] border border-[#062f3b]/10 bg-[#fffaf2] px-6 py-7 sm:px-10 sm:py-9 lg:px-12">
            <MarkdownDocument source={source} />
          </article>
        </div>
      </div>

      <footer className="bg-[#062f3b] px-5 py-9 text-white/70 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
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
