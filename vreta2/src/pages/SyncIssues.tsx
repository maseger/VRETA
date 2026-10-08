// Synk att lösa: ändringar som gjordes utan nät och som servern inte kunde ta emot (t.ex. någon annan hann
// flytta samma sak). Inget försvinner tyst – du väljer att göra om (ofta med ett färdigt förslag) eller strunta i det.
import { useApp, useCommand, useQuery } from "../app/AppContext";
import { dt } from "../app/format";
import { useSyncState } from "../app/Shell";
import { reasonText } from "../data/pglite/engine";
import { Card, Empty, ErrorNote, PageHeader, Section, Spinner, Stamp } from "../ui/base";
import { BusyButton } from "../ui/sheet";
import { SuggestionNote } from "../ui/suggestion";

export default function SyncIssues() {
  const { repo, ctx } = useApp();
  const run = useCommand();
  const sync = useSyncState();
  const { data, error, loading, reload } = useQuery<any[]>("q_sync_issues", { all: true });
  const label = (type: string) => ctx?.catalog.find((c) => c.type === type)?.label ?? type;
  const pending = sync.entries.filter((e) => e.status !== "rejected");
  return (
    <div>
      <PageHeader kicker="Synk" title="Synk att lösa" sub={sync.online ? "Ansluten" : "Offline – ändringar sparas på telefonen"} />
      {pending.length > 0 && (
        <Section title={`Väntar på att skickas · ${pending.length}`} action={sync.online && <BusyButton className="btn-ghost btn-small" onClick={() => repo.flush()}>Skicka nu</BusyButton>}>
          <ul className="card divide-y divide-dashed divide-lera">
            {pending.map((e) => <li key={e.key} className="flex justify-between gap-2 px-4 py-2.5"><span>{e.label ?? label(e.type)}</span><span className="text-sm text-sot-3">{dt(e.client_time)}</span></li>)}
          </ul>
        </Section>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <Spinner />}
      {data && data.length === 0 && pending.length === 0 && <Empty>Allt är synkat. Inget att lösa.</Empty>}
      {data && data.length > 0 && (
        <Section title={`Kunde inte sparas · ${data.length}`}>
          <div className="flex flex-col gap-3">
            {data.map((c) => {
              const resolve = () => run("ResolveRejectedCommand", { command_id: c.id }, { silent: true }).then(reload);
              return (
                <Card key={c.id}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-semibold">{c.label ?? label(c.command_type)}</span>
                    <Stamp tone={c.origin === "offline" ? "warn" : "neutral"}>{c.origin === "offline" ? "Från telefonen" : c.origin}</Stamp>
                  </div>
                  <div className="mb-2 text-sm text-sot-3">Gjord {dt(c.client_time ?? c.received_at)}</div>
                  <SuggestionNote r={{ reason: c.reason, suggestion: c.suggestion, code: c.reason?.split(":")[0] ?? "" }}
                    onRetry={async (patch) => { if (await run(c.command_type, { ...c.payload, ...patch }, { success: "Sparat" })) await resolve(); }} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <BusyButton className="btn-secondary btn-small" onClick={async () => { if (await run(c.command_type, c.payload, { success: "Sparat" })) await resolve(); }}>Försök igen</BusyButton>
                    <BusyButton className="btn-ghost btn-small" onClick={resolve}>Strunta i det</BusyButton>
                  </div>
                  <details className="mt-2 text-sm text-sot-3"><summary>Det som skulle sparas</summary><pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(c.payload, null, 1)}</pre></details>
                </Card>
              );
            })}
          </div>
        </Section>
      )}
      {sync.entries.filter((e) => e.status === "rejected").map((e) => (
        <Card key={e.key} className="mt-3">
          <div className="font-semibold">{e.label ?? label(e.type)}</div>
          <div className="text-sm text-falu">{reasonText(e.reason ?? "")}</div>
          <BusyButton className="btn-ghost btn-small mt-2" onClick={async () => { await (repo as any).dropJournalEntry?.(e.key); }}>Ta bort från telefonen</BusyButton>
        </Card>
      ))}
    </div>
  );
}
