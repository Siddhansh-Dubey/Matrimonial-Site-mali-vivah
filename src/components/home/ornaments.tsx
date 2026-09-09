export function LeafSprig({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 120" fill="none" aria-hidden className={className}>
      <path
        d="M30 115C30 80 30 45 30 8"
        stroke="#c9a24b"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M30 95c-8-2-14-8-16-17 8 2 14 8 16 17Z" stroke="#c9a24b" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M30 95c8-2 14-8 16-17-8 2-14 8-16 17Z" stroke="#c9a24b" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M30 68c-7-2-12-7-14-15 7 2 12 7 14 15Z" stroke="#c9a24b" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M30 68c7-2 12-7 14-15-7 2-12 7-14 15Z" stroke="#c9a24b" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M30 42c-6-2-10-6-12-12 6 2 10 6 12 12Z" stroke="#c9a24b" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M30 42c6-2 10-6 12-12-6 2-10 6-12 12Z" stroke="#c9a24b" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M30 20c-4-3-6-7-6-11 4 1 6 5 6 11Z" stroke="#c9a24b" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M30 20c4-3 6-7 6-11-4 1-6 5-6 11Z" stroke="#c9a24b" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}
