import { Check, Undo2, X } from "lucide-react";
import { AiMark } from "./bits";

interface Props {
  label: string;
  value: string;
  confidence: number;
  edited: boolean;
  included: boolean;
  onChange: (v: string) => void;
  onToggle: () => void;
  multiline?: boolean;
  type?: "text" | "number" | "date";
  options?: { value: string; label: string }[];
}

/** Ett AI-föreslaget fält: godkänn, ändra eller ta bort (specifikationen S3). */
export function SuggestedField({ label, value, confidence, edited, included, onChange, onToggle, multiline, type = "text", options }: Props) {
  const pending = !edited && confidence > 0;
  const cls = `input ${pending ? "suggested" : ""} ${included ? "" : "opacity-40 line-through"}`;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="field-label mb-0">{label}</label>
        <div className="flex items-center gap-2">
          {pending && included && <AiMark confidence={confidence} />}
          {edited && included && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-linolja">
              <Check size={12} aria-hidden="true" /> Ändrat av dig
            </span>
          )}
          <button type="button" onClick={onToggle} className="rounded p-1 text-sot-3 hover:bg-kalk-2" aria-label={included ? `Ta bort ${label}` : `Ta med ${label}`}>
            {included ? <X size={16} /> : <Undo2 size={16} />}
          </button>
        </div>
      </div>
      {options ? (
        <select className={cls} value={value} disabled={!included} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : multiline ? (
        <textarea className={cls} rows={3} value={value} disabled={!included} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={cls} type={type} value={value} disabled={!included} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
