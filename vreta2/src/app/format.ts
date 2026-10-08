// Svenska format för datum, tal och pengar.
const dateFmt = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", year: "numeric" });
const shortFmt = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("sv-SE", { weekday: "long", day: "numeric", month: "long" });
const numFmt = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 });

export function d(v?: string | null): string {
  if (!v) return "";
  const x = new Date(v);
  if (Number.isNaN(x.getTime())) return v;
  return x.getFullYear() === new Date().getFullYear() ? shortFmt.format(x) : dateFmt.format(x);
}
export function dt(v?: string | null): string {
  if (!v) return "";
  const x = new Date(v);
  return `${d(v)} ${timeFmt.format(x)}`;
}
export function time(v?: string | null): string {
  return v ? timeFmt.format(new Date(v)) : "";
}
export function today(): string {
  const s = weekdayFmt.format(new Date());
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function ago(v?: string | null): string {
  if (!v) return "";
  const diff = (Date.now() - new Date(v).getTime()) / 1000;
  const future = diff < 0;
  const a = Math.abs(diff);
  const unit = a < 3600 ? [Math.max(1, Math.round(a / 60)), "min"] : a < 86400 ? [Math.round(a / 3600), "tim"] : a < 86400 * 45 ? [Math.round(a / 86400), "dag"] : a < 86400 * 365 ? [Math.round(a / (86400 * 30)), "mån"] : [Math.round(a / (86400 * 365)), "år"];
  const [n, u] = unit as [number, string];
  const word = u === "dag" ? (n === 1 ? "dag" : "dagar") : u === "mån" ? (n === 1 ? "månad" : "månader") : u === "tim" ? (n === 1 ? "timme" : "timmar") : u === "år" ? "år" : "min";
  return future ? `om ${n} ${word}` : `för ${n} ${word} sedan`;
}
export function num(v?: number | string | null): string {
  if (v === null || v === undefined || v === "") return "";
  return numFmt.format(Number(v));
}
export function kr(v?: number | string | null): string {
  if (v === null || v === undefined || v === "") return "";
  return `${numFmt.format(Number(v))} kr`;
}
export function isoDate(v: Date = new Date()): string {
  return v.toISOString().slice(0, 10);
}
export function localDateTimeInput(v: Date = new Date()): string {
  const off = v.getTimezoneOffset() * 60000;
  return new Date(v.getTime() - off).toISOString().slice(0, 16);
}
