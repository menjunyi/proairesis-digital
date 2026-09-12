export function RoleClueMark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <path d="M24 6H12a6 6 0 0 0-6 6v18h8V14h10V6Z" fill="currentColor" />
    <path d="M24 42h12a6 6 0 0 0 6-6V18h-8v16H24v8Z" fill="currentColor" />
    <circle cx="24" cy="24" r="5" fill="currentColor" />
  </svg>;
}
