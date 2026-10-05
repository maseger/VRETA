export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <rect width="512" height="512" rx="96" fill="#8C2F1D" />
      <path d="M96 300 256 156l160 144" fill="none" stroke="#F4EFE4" strokeWidth="28" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M146 268v120h220V268" fill="none" stroke="#F4EFE4" strokeWidth="28" strokeLinejoin="round" />
      <path d="M256 388c0-62 20-96 64-118-46 2-70 30-76 58-8-24-28-40-58-42 34 16 54 48 70 102z" fill="#E3C27E" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="font-serif text-[22px] font-semibold tracking-[0.12em] text-sot">VRETA</span>
    </span>
  );
}
