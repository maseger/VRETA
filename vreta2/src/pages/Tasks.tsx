// Uppgifter: det som ska göras, med försenade först. /uppgift/:id öppnar en uppgift.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useCan, useCommand, useQuery } from "../app/AppContext";
import { d } from "../app/format";
import { Card, Chip, Empty, ErrorNote, PageHeader, Spinner, Stamp } from "../ui/base";
import { BusyButton } from "../ui/sheet";
import { TaskSheet } from "./ObjectPage";

export default function Tasks() {
  const { id } = useParams();
  const can = useCan();
  const run = useCommand();
  const [scope, setScope] = useState(id ? "all" : "open");
  const [create, setCreate] = useState(false);
  const { data, error, loading } = useQuery<any[]>("q_tasks", { scope });
  const shown = (data ?? []).filter((t) => !id || t.id === id);
  return (
    <div>
      <PageHeader kicker="Att göra" title={id ? shown[0]?.title ?? "Uppgift" : "Uppgifter"}>
        {!id && can("CreateTask") && <button type="button" className="btn-primary btn-small" onClick={() => setCreate(true)}><Plus size={16} /> Ny</button>}
      </PageHeader>
      {!id && <div className="mb-3 flex gap-2"><Chip on={scope === "open"} onClick={() => setScope("open")}>Öppna</Chip><Chip on={scope === "done"} onClick={() => setScope("done")}>Klara</Chip></div>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <Spinner />}
      {data && shown.length === 0 && <Empty>{id ? "Uppgiften finns inte." : "Inget att göra."}</Empty>}
      <div className="flex flex-col gap-2">
        {shown.map((t) => {
          const late = t.due_at && new Date(t.due_at) < new Date() && !["done", "cancelled"].includes(t.status);
          return (
            <Card key={t.id} className={`!py-3 ${late ? "border-l-4 border-l-falu" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{t.title}</div>
                  <div className="text-sm text-sot-3">{[t.due_at ? `${late ? "skulle vara klart" : "senast"} ${d(t.due_at)}` : null, t.kind === "pickup" ? "hämtning" : null].filter(Boolean).join(" · ")}
                    {t.subject && <> · {t.subject.route ? <Link to={t.subject.route}>{t.subject.title}</Link> : t.subject.title}</>}</div>
                  {t.note && <p className="text-sot-2">{t.note}</p>}
                </div>
                {["done", "cancelled"].includes(t.status) && <Stamp tone="ok">{t.status === "done" ? "Klar" : "Struken"}</Stamp>}
              </div>
              {can("SetTaskStatus") && (t.next ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.next.map((n: any) => (
                    <BusyButton key={n.to} className={n.to === "done" ? "btn-done btn-small" : "btn-ghost btn-small"}
                      onClick={() => run("SetTaskStatus", { task_id: t.id, status: n.to, snoozed_until: n.to === "snoozed" ? new Date(Date.now() + 3 * 86400000).toISOString() : undefined }, { success: n.label })}>
                      {n.to === "snoozed" ? "Skjut upp 3 dagar" : n.label}</BusyButton>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <TaskSheet open={create} onClose={() => setCreate(false)} />
    </div>
  );
}
