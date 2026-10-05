import { useId } from "react";
import { useData } from "../app/AppContext";

/** Projektfält med förslag från befintliga projekt. Ett nytt namn blir ett nytt projekt när det sparas. */
export function ProjectInput({ value, onChange, className = "input" }: { value: string; onChange: (v: string) => void; className?: string }) {
  const id = useId();
  const { data } = useData((r) => r.projects());
  const open = (data ?? []).filter((p) => p.status !== "done");
  return (
    <>
      <input className={className} list={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Projekt (valfritt), t.ex. Orangeriet" aria-label="Projekt" />
      <datalist id={id}>{open.map((p) => <option key={p.id} value={p.name} />)}</datalist>
    </>
  );
}
