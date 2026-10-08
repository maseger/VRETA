// Logotypen enligt den grafiska profilen: bladmärket i skogsgrönt, VRETA i rost och REGENERATIVE INITIATIVE
// i skogsgrönt under. Profilens logofiler är lågupplösta platshållare, så märket ritas här som vektor tills
// originalfilerna finns. Ordet VRETA skrivs med versaler bara i logotypen; i löpande text heter det Vreta.

export function LeafMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path d="M24 45c0-6 0-11 .4-16" fill="none" stroke="#1F4D2E" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M23 30C12 30 4.5 22 4.5 9.5 16 9.5 23.5 17 23 30Z" fill="#1F4D2E" />
      <path d="M25.5 28C26 15 33 6.5 45 4c1 13.5-6.5 23-19.5 24Z" fill="#1F4D2E" />
      <path d="M21.8 28.5C17 23 11.5 16.5 7.5 12.5M25.5 27.5C31 19.5 36.5 12 43.5 6.5" fill="none" stroke="#5E8A68" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

// Märke + VRETA + REGENERATIVE INITIATIVE (sidhuvud och meny)
export function Lockup({ size = "md" }: { size?: "sm" | "md" }) {
  const leaf = size === "sm" ? 26 : 34;
  return (
    <span className="inline-flex items-center gap-2" aria-label="Vreta Regenerative Initiative">
      <LeafMark size={leaf} />
      <span className="flex flex-col leading-none" aria-hidden="true">
        <span className={`font-extrabold tracking-[-0.02em] text-rust ${size === "sm" ? "text-[21px]" : "text-[27px]"}`}>VRETA</span>
        <span className={`mt-[3px] whitespace-nowrap font-bold uppercase tracking-[0.08em] text-forest ${size === "sm" ? "text-[7.5px]" : "text-[9.5px]"}`}>Regenerative Initiative</span>
      </span>
    </span>
  );
}

// Titellockup: "Vreta" i rost ovanför "Regenerative Initiative" i skogsgrönt, båda i tung sans
export function TitleLockup({ className = "" }: { className?: string }) {
  return (
    <div className={`leading-[0.95] tracking-[-0.03em] ${className}`}>
      <div className="text-[56px] font-extrabold text-rust">Vreta</div>
      <div className="text-[32px] font-extrabold text-forest">Regenerative Initiative</div>
    </div>
  );
}
