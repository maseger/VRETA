// Formulärfält med mikrofonknapp (diktering i alla textfält, R1.1 7.5) och väljare för personer, platser och projekt.
import { useId, useMemo, useState, type ReactNode } from "react";
import { Mic, MicOff, Search } from "lucide-react";
import { useDictation } from "../services/speech";
import { useQuery } from "../app/AppContext";

export function Field({ label, children, hint, id }: { label: ReactNode; children: ReactNode; hint?: ReactNode; id?: string }) {
  return (
    <div className="mb-3">
      <label className="label" htmlFor={id}>{label}</label>
      {children}
      {hint && <div className="mt-1 text-sm text-sot-3">{hint}</div>}
    </div>
  );
}

function MicButton({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [base, setBase] = useState("");
  const d = useDictation((t) => onChange((base ? base + " " : "") + t));
  if (!d.available) return null;
  return (
    <button type="button" className={`absolute right-1.5 top-1.5 rounded-md p-2 ${d.listening ? "bg-falu text-kalk" : "text-sot-3 hover:bg-kalk-2"}`}
      aria-label={d.listening ? "Sluta diktera" : "Diktera"} aria-pressed={d.listening}
      onClick={() => { if (d.listening) d.stop(); else { setBase(value.trim()); d.start(); } }}>
      {d.listening ? <MicOff size={18} /> : <Mic size={18} />}
    </button>
  );
}

export function TextField({ label, value, onChange, placeholder, hint, type = "text", required, autoFocus, mic = true, inputMode }: {
  label: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string; hint?: ReactNode; type?: string; required?: boolean;
  autoFocus?: boolean; mic?: boolean; inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "url";
}) {
  const id = useId();
  const withMic = mic && type === "text";
  return (
    <Field label={label} hint={hint} id={id}>
      <div className="relative">
        <input id={id} className={`input ${withMic ? "pr-12" : ""}`} type={type} value={value} placeholder={placeholder} required={required}
          autoFocus={autoFocus} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
        {withMic && <MicButton value={value} onChange={onChange} />}
      </div>
    </Field>
  );
}

export function TextArea({ label, value, onChange, placeholder, hint, rows = 4, autoFocus }: {
  label: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string; hint?: ReactNode; rows?: number; autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <div className="relative">
        <textarea id={id} className="input pr-12" rows={rows} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
        <MicButton value={value} onChange={onChange} />
      </div>
    </Field>
  );
}

export function NumberField({ label, value, onChange, hint, unit, step = "any", min }: {
  label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode; unit?: string; step?: string; min?: number;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <div className="flex items-center gap-2">
        <input id={id} className="input" type="number" inputMode="decimal" step={step} min={min} value={value} onChange={(e) => onChange(e.target.value)} />
        {unit && <span className="text-sot-3">{unit}</span>}
      </div>
    </Field>
  );
}

export function Select({ label, value, onChange, options, hint, empty }: {
  label: ReactNode; value: string; onChange: (v: string) => void; options: { value: string; label: string; group?: string }[]; hint?: ReactNode; empty?: string;
}) {
  const id = useId();
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <Field label={label} hint={hint} id={id}>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {empty !== undefined && <option value="">{empty}</option>}
        {groups.map((g) => g
          ? <optgroup key={g} label={g}>{options.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
          : options.filter((o) => !o.group).map((o) => <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </Field>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="mb-3 flex min-h-[44px] cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 h-5 w-5 accent-falu" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="font-semibold">{label}</span>{hint && <span className="block text-sm text-sot-3">{hint}</span>}</span>
    </label>
  );
}

// Personväljare: sök bland personer; skriv ett nytt namn för att skapa en ny person i samma kommando.
export type PersonChoice = { id?: string; name: string };
export function PersonPicker({ label, value, onChange, hint, allowNew = true }: { label: ReactNode; value: PersonChoice | null; onChange: (v: PersonChoice | null) => void; hint?: ReactNode; allowNew?: boolean }) {
  const { data } = useQuery<any[]>("q_people");
  const [q, setQ] = useState("");
  const id = useId();
  const hits = useMemo(() => {
    const t = q.trim().toLocaleLowerCase("sv");
    if (!t) return [];
    return (data ?? []).filter((p) => p.display_name.toLocaleLowerCase("sv").includes(t)).slice(0, 6);
  }, [q, data]);
  if (value) {
    return (
      <Field label={label} hint={hint} id={id}>
        <div className="flex items-center justify-between rounded-lg border border-lera bg-papper px-3 py-2">
          <span>{value.name}{!value.id && <span className="ml-2 text-sm text-sot-3">(ny person)</span>}</span>
          <button type="button" className="btn-ghost btn-small" onClick={() => onChange(null)}>Byt</button>
        </div>
      </Field>
    );
  }
  return (
    <Field label={label} hint={hint} id={id}>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-sot-3" aria-hidden />
        <input id={id} className="input pl-9" value={q} placeholder="Sök eller skriv namn" onChange={(e) => setQ(e.target.value)} />
      </div>
      {q.trim() && (
        <ul className="mt-1 rounded-lg border border-lera bg-papper">
          {hits.map((p) => (
            <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-kalk-2" onClick={() => { onChange({ id: p.id, name: p.display_name }); setQ(""); }}>
              {p.display_name}{p.locality && <span className="ml-2 text-sm text-sot-3">{p.locality}</span>}
            </button></li>
          ))}
          {allowNew && !hits.some((h) => h.display_name.toLocaleLowerCase("sv") === q.trim().toLocaleLowerCase("sv")) && (
            <li><button type="button" className="w-full px-3 py-2 text-left text-falu hover:bg-kalk-2" onClick={() => { onChange({ name: q.trim() }); setQ(""); }}>
              + Ny person: {q.trim()}
            </button></li>
          )}
        </ul>
      )}
    </Field>
  );
}

// Platsväljare: områden, byggnader, rum och lagerplatser på Vreta, grupperade.
export function usePlaceOptions(opts: { storage?: boolean; places?: boolean } = { storage: true, places: true }) {
  const places = useQuery<any>(opts.places === false ? null : "q_places");
  const storage = useQuery<any[]>(opts.storage === false ? null : "q_storage_tree");
  return useMemo(() => {
    const out: { value: string; label: string; group: string }[] = [];
    for (const s of storage.data ?? []) out.push({ value: s.id, label: s.path ?? s.name, group: "Lager" });
    for (const z of places.data?.zones ?? []) out.push({ value: z.id, label: z.name, group: "Områden" });
    for (const s of places.data?.structures ?? []) out.push({ value: s.id, label: s.name, group: "Byggnader" });
    for (const s of places.data?.spaces ?? []) {
      const parent = (places.data?.structures ?? []).find((x: any) => x.id === s.structure_id)?.name;
      out.push({ value: s.id, label: parent ? `${parent} › ${s.name}` : s.name, group: "Rum och platsdelar" });
    }
    return out;
  }, [places.data, storage.data]);
}

export function PlacePicker({ label, value, onChange, hint, storage = true, places = true, empty = "Välj plats" }: {
  label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode; storage?: boolean; places?: boolean; empty?: string;
}) {
  const options = usePlaceOptions({ storage, places });
  return <Select label={label} value={value} onChange={onChange} options={options} hint={hint} empty={empty} />;
}

export function ProjectPicker({ label, value, onChange, hint, empty = "Inget projekt" }: { label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode; empty?: string }) {
  const { data } = useQuery<any[]>("q_projects");
  return <Select label={label} value={value} onChange={onChange} empty={empty} hint={hint}
    options={(data ?? []).filter((p) => !["done", "cancelled"].includes(p.status)).map((p) => ({ value: p.id, label: p.name }))} />;
}

export function CodeSelect({ label, list, value, onChange, hint, empty, codes }: {
  label: ReactNode; list: string; value: string; onChange: (v: string) => void; hint?: ReactNode; empty?: string;
  codes: { code: string; label: string }[];
}) {
  return <Select label={label} value={value} onChange={onChange} hint={hint} empty={empty} options={codes.map((c) => ({ value: c.code, label: c.label }))} key={list} />;
}

export function numOrNull(v: string): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}
export function strOrNull(v: string): string | null {
  return v && v.trim() ? v.trim() : null;
}
