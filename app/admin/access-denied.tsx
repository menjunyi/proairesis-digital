import { ArrowLeft, LockKeyhole, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { chatGPTSignOutPath } from '@/app/chatgpt-auth';

export function AdminAccessDenied() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f1e8] px-5 text-[#173c3e]">
      <section className="w-full max-w-lg rounded-[2rem] border border-[#173c3e]/10 bg-[#fffdf7] p-8 text-center shadow-[0_24px_70px_rgba(23,60,62,0.12)] sm:p-10">
        <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-[#ffe5dc] text-[#b83f28]">
          <ShieldAlert className="size-8" />
        </span>
        <p className="mt-6 text-xs font-black uppercase tracking-[0.15em] text-[#e55336]">Protected workspace</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.045em]">Admin access required</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#587174]">
          You are signed in, but this account does not have permission to manage the RoleClue platform.
        </p>
        <div className="mt-6 flex items-center gap-2 rounded-xl bg-[#edf1eb] px-4 py-3 text-left text-xs leading-5 text-[#587174]">
          <LockKeyhole className="size-4 shrink-0 text-[#315f5f]" />
          Super-admin access is allowlisted and every administrative action is recorded.
        </div>
        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          <Link href="/" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#173c3e]/15 bg-white px-4 text-sm font-bold">
            <ArrowLeft className="size-4" /> Back to RoleClue
          </Link>
          <a href={chatGPTSignOutPath('/')} target="_top" className="inline-flex h-10 items-center justify-center rounded-xl bg-[#173c3e] px-4 text-sm font-bold text-white">
            Use another account
          </a>
        </div>
      </section>
    </main>
  );
}
