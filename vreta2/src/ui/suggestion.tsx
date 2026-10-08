// När Domain API avvisar ett kommando följer ibland ett förslag med: "det finns bara 60 kvar där",
// "välj vilken del av partiet" eller "projektet finns redan". Här blir förslaget en knapp.
import { Link } from "react-router-dom";
import { num } from "../app/format";
import { reasonText } from "../data/pglite/engine";

export type Rejection = { reason?: string; suggestion?: any; code: string };

export function SuggestionNote({ r, onRetry }: { r: Rejection; onRetry: (patch: Record<string, unknown>) => void }) {
  const s = r.suggestion ?? {};
  return (
    <div role="alert" className="rounded-lg border border-falu/40 bg-falu/5 px-3 py-2 text-falu">
      <div>{reasonText(r.reason ?? r.code)}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {s.quantity != null && <button type="button" className="btn-secondary btn-small" onClick={() => onRetry({ quantity: Number(s.quantity), allocation_id: s.allocation_id ?? null })}>Gör om med {num(s.quantity)}</button>}
        {Array.isArray(s.choices) && s.choices.map((c: any) => (
          <button key={c.allocation_id} type="button" className="btn-secondary btn-small" onClick={() => onRetry({ allocation_id: c.allocation_id })}>{num(c.quantity)} {c.place ? `på ${c.place}` : ""}</button>
        ))}
        {s.project_id && <Link className="btn-secondary btn-small" to={`/projekt/${s.project_id}`}>Öppna projektet</Link>}
      </div>
    </div>
  );
}
