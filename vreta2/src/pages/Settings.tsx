// Inställningar: ditt namn, medlemmar och roller, inbjudnings- och gästlänkar, funktioner per plats,
// kodlistor, checklistmallar, AI-kostnad, export och (i demoläget) börja om.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Download, LogOut, RotateCcw } from "lucide-react";
import { useApp, useCan, useCommand, useQuery } from "../app/AppContext";
import { ROLE } from "../app/labels";
import { d, num } from "../app/format";
import { roleLabel } from "../app/Shell";
import { copyText } from "../services/share";
import { getSpeechRate, setSpeechRate, speak } from "../services/speech";
import { Card, ErrorNote, Kv, PageHeader, Section, Spinner, Stamp } from "../ui/base";
import { NumberField, Select, TextArea, TextField, Toggle, numOrNull } from "../ui/fields";
import { BusyButton, ConfirmButton, Sheet } from "../ui/sheet";
import { useToast } from "../app/toast";

export default function Settings() {
  const { repo, ctx, refreshContext } = useApp();
  const can = useCan();
  const run = useCommand();
  const toast = useToast();
  const { data: s, error, loading, reload } = useQuery<any>("q_settings");
  const [name, setName] = useState(ctx?.display_name ?? "");
  const [rate, setRate] = useState(getSpeechRate());
  const owner = ctx?.role === "owner";
  return (
    <div>
      <PageHeader kicker="VRETA" title="Inställningar" sub={<>{ctx?.site?.name} · du är {roleLabel(ctx?.role).toLowerCase()}{repo.mode === "demo" && " · demoläge i webbläsaren"}</>} />
      {error && <ErrorNote>{error}</ErrorNote>}

      <Section title="Du">
        <Card>
          <form className="flex items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run("SetDisplayName", { display_name: name.trim() }, { success: "Sparat" })) refreshContext(); }}>
            <div className="flex-1"><TextField label="Ditt namn i VRETA" value={name} onChange={setName} mic={false} /></div>
            <button type="submit" className="btn-secondary mb-3">Spara</button>
          </form>
          <label className="label" htmlFor="tts">Uppläsningens hastighet ({rate.toFixed(1)}×)</label>
          <div className="mb-2 flex items-center gap-2">
            <input id="tts" type="range" min={0.7} max={1.5} step={0.1} value={rate} className="flex-1 accent-falu" onChange={(e) => { setRate(Number(e.target.value)); setSpeechRate(Number(e.target.value)); }} />
            <button type="button" className="btn-ghost btn-small" onClick={() => speak("Hej! Så här låter VRETA.")}>Prova</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/synk" className="btn-secondary btn-small">Synk att lösa{s?.rejected_commands ? ` (${s.rejected_commands})` : ""}</Link>
            {repo.mode === "supabase" && <button type="button" className="btn-ghost btn-small" onClick={() => repo.signOut()}><LogOut size={15} /> Logga ut</button>}
            {repo.resetDemo && <ConfirmButton className="btn-ghost btn-small" question="Demodatan läggs in på nytt och allt du ändrat i demon försvinner." confirmLabel="Börja om"
              onConfirm={async () => { await repo.resetDemo!(); toast("Demon är återställd"); }}><RotateCcw size={15} /> Börja om demon</ConfirmButton>}
          </div>
        </Card>
      </Section>

      {loading && <Spinner />}
      {s && (
        <>
          <Section title="Platsen">
            <Card>
              <dl className="divide-y divide-dashed divide-lera">
                <Kv k="Namn">{s.site?.name}</Kv>
                <Kv k="Beskrivning">{s.site?.description}</Kv>
                <Kv k="Adress (privat)">{s.private?.address}</Kv>
                <Kv k="Fastighetsbeteckning (privat)">{s.private?.property_designation}</Kv>
                <Kv k="Tidszon">{s.site?.timezone}</Kv>
              </dl>
            </Card>
          </Section>

          {owner && <Members s={s} />}
          {owner && <Links s={s} onChange={reload} />}

          {owner && (
            <Section title="Funktioner">
              <Card>
                <p className="mb-2 text-sm text-sot-3">Slås på per plats. Det som tillhör senare releaser finns i datamodellen men har inget fullt gränssnitt än.</p>
                {s.flags.map((f: any) => (
                  <label key={f.flag} className="flex min-h-[44px] items-center gap-3 border-b border-dashed border-lera py-1 last:border-0">
                    <input type="checkbox" className="h-5 w-5 accent-falu" checked={f.enabled} disabled={f.flag === "core"}
                      onChange={(e) => run("SetFeatureFlag", { flag: f.flag, enabled: e.target.checked }, { success: e.target.checked ? "Påslagen" : "Avslagen" }).then(() => refreshContext())} />
                    <span className="flex-1">{f.label}</span><Stamp tone={f.release === "R2.0" ? "ok" : "plan"}>{f.release}</Stamp>
                  </label>
                ))}
              </Card>
            </Section>
          )}

          {owner && <SiteSettings s={s} />}
          {can("UpsertChecklistTemplate") && <Checklists s={s} />}
          {owner && <CodeLists s={s} />}

          <Section title="Bakgrundsjobb">
            <Card className="flex items-center justify-between gap-2">
              <span>{s.jobs.pending} väntar · {s.jobs.failed} misslyckade</span>
              <BusyButton className="btn-ghost btn-small" onClick={async () => { await repo.processJobs(); reload(); }}>Kör nu</BusyButton>
            </Card>
          </Section>

          {s.ai_usage.length > 0 && (
            <Section title="AI-användning">
              <Card>{s.ai_usage.map((u: any, i: number) => <div key={i} className="flex justify-between py-1"><span>{u.function_name} · {u.month?.slice(0, 7)}</span><span>{u.calls} anrop · ${Number(u.cost_usd).toFixed(2)}</span></div>)}</Card>
            </Section>
          )}

          {owner && <Export />}
        </>
      )}
      <p className="mt-8 text-center text-sm text-sot-3">VRETA 2.0 · {repo.mode === "demo" ? "Demoläge: allt sparas bara i den här webbläsaren" : "Ansluten till servern"}</p>
    </div>
  );
}

function Members({ s }: { s: any }) {
  const { ctx } = useApp();
  const run = useCommand();
  return (
    <Section title="Medlemmar">
      <ul className="card divide-y divide-dashed divide-lera">
        {s.members.map((m: any) => (
          <li key={m.membership_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <span><span className="font-semibold">{m.display_name}</span><span className="block text-sm text-sot-3">sedan {d(m.created_at)}{m.via_link ? " · via länk" : ""}</span></span>
            {m.user_id === ctx?.user_id ? <Stamp>{ROLE[m.role]}</Stamp> : (
              <div className="flex items-center gap-1">
                <select className="rounded-md border border-lera bg-papper px-2 py-1" value={m.role} aria-label={`Roll för ${m.display_name}`}
                  onChange={(e) => run("SetMemberRole", { membership_id: m.membership_id, role: e.target.value }, { success: "Rollen är ändrad" })}>
                  {["owner", "helper", "reader", "host", "guest"].map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
                </select>
                <ConfirmButton className="btn-ghost btn-small" question={`${m.display_name} förlorar åtkomsten till ${s.site?.name}.`} confirmLabel="Ta bort"
                  onConfirm={() => run("SetMemberRole", { membership_id: m.membership_id, role: m.role, revoke: true }, { success: "Borttagen" })}>Ta bort</ConfirmButton>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Links({ s, onChange }: { s: any; onChange: () => void }) {
  const run = useCommand();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("guest");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("");
  const [made, setMade] = useState<string | null>(null);
  const url = (token: string) => `${location.origin}${import.meta.env.BASE_URL}#/gast/${token}`.replace(/([^:])\/\//g, "$1/");
  return (
    <Section title="Inbjudningar och gästlänkar" action={<button type="button" className="btn-ghost btn-small" onClick={() => { setMade(null); setOpen(true); }}>+ Ny länk</button>}>
      <ul className="card divide-y divide-dashed divide-lera">
        {s.links.length === 0 && <li className="px-4 py-3 text-sot-3">Inga länkar.</li>}
        {s.links.map((l: any) => (
          <li key={l.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
            <span><span className="font-semibold">{l.label}</span><span className="block text-sm text-sot-3">{ROLE[l.role]} · använd {l.uses} gånger{l.expires_at ? ` · gäller till ${d(l.expires_at)}` : ""}</span></span>
            {l.closed_at ? <Stamp>Stängd</Stamp> : <BusyButton className="btn-ghost btn-small" onClick={async () => { if (await run("CloseGuestLink", { id: l.id }, { success: "Länken är stängd" })) onChange(); }}>Stäng</BusyButton>}
          </li>
        ))}
      </ul>
      <Sheet open={open} onClose={() => setOpen(false)} title="Ny länk"
        footer={made ? <button type="button" className="btn-primary" onClick={() => setOpen(false)}>Klar</button> : <BusyButton disabled={!label.trim()} onClick={async () => {
          const r = await run<{ token: string }>("CreateGuestLink", { role, label: label.trim(), expires_at: days ? new Date(Date.now() + Number(days) * 86400000).toISOString() : null });
          if (r?.token) { setMade(url(r.token)); onChange(); }
        }}>Skapa</BusyButton>}>
        {made ? (
          <div>
            <p className="mb-2">Länken visas bara nu – kopiera och skicka den.</p>
            <div className="mb-2 break-all rounded-lg bg-kalk-2 p-3 font-mono text-sm">{made}</div>
            <button type="button" className="btn-secondary" onClick={async () => { await copyText(made); toast("Länken är kopierad"); }}><Copy size={16} /> Kopiera</button>
          </div>
        ) : (
          <>
            <Select label="Vad ska länken ge?" value={role} onChange={setRole} options={[
              { value: "guest", label: "Gästvy – familj och vänner ser det som är delat" }, { value: "reader", label: "Läsare – kan se allt internt" },
              { value: "helper", label: "Medhjälpare – kan fånga och ändra" }, { value: "host", label: "Värd – för ett evenemang eller boende" }]} />
            <TextField label="Namn på länken" value={label} onChange={setLabel} placeholder="Familj och vänner" />
            <NumberField label="Giltig i antal dagar (tomt = tills vidare)" value={days} onChange={setDays} />
            {role !== "guest" && <p className="text-sm text-sot-3">Den som öppnar länken behöver logga in med sin e-post.</p>}
          </>
        )}
      </Sheet>
    </Section>
  );
}

function SiteSettings({ s }: { s: any }) {
  const run = useCommand();
  const [cap, setCap] = useState(String(s.settings.ai_monthly_cap_usd ?? ""));
  const [months, setMonths] = useState(String(s.settings.long_stored_months ?? 12));
  const [delay, setDelay] = useState(String(s.settings.public_delay_hours ?? 48));
  return (
    <Section title="Regler">
      <Card>
        <NumberField label="AI-tak per månad" value={cap} onChange={setCap} unit="USD" hint="När taket nås används den lokala reserven." />
        <NumberField label="Påminn om saker i lager efter" value={months} onChange={setMonths} unit="månader" />
        <NumberField label="Fördröjning för publika händelser" value={delay} onChange={setDelay} unit="timmar" hint="Så att ingen kan se att ni är bortresta just nu." />
        <BusyButton className="btn-secondary btn-small" onClick={async () => {
          await run("SetSiteSetting", { key: "ai_monthly_cap_usd", value: numOrNull(cap) });
          await run("SetSiteSetting", { key: "long_stored_months", value: numOrNull(months) });
          await run("SetSiteSetting", { key: "public_delay_hours", value: numOrNull(delay) }, { success: "Sparat" });
        }}>Spara</BusyButton>
      </Card>
    </Section>
  );
}

function Checklists({ s }: { s: any }) {
  const { ctx } = useApp();
  const run = useCommand();
  const [open, setOpen] = useState<any>(null);
  const [name, setName] = useState("");
  const [items, setItems] = useState("");
  const builtin = ctx?.codes.checklist_template ?? [];
  return (
    <Section title="Checklistor för hämtning" action={<button type="button" className="btn-ghost btn-small" onClick={() => { setName(""); setItems(""); setOpen({}); }}>+ Egen</button>}>
      <Card>
        {builtin.map((t) => <div key={t.code} className="py-1"><span className="font-semibold">{t.label}</span> <span className="text-sm text-sot-3">· {(t.attributes?.items ?? []).length} rader · standard</span></div>)}
        {s.checklist_templates.map((t: any) => (
          <button key={t.id} type="button" className="block py-1 text-left" onClick={() => { setName(t.name); setItems((t.items ?? []).join("\n")); setOpen(t); }}>
            <span className="font-semibold text-falu">{t.name}</span> <span className="text-sm text-sot-3">· {(t.items ?? []).length} rader</span></button>
        ))}
      </Card>
      <Sheet open={!!open} onClose={() => setOpen(null)} title="Checklista"
        footer={<BusyButton disabled={!name.trim()} onClick={async () => {
          if (await run("UpsertChecklistTemplate", { id: open?.id ?? null, name: name.trim(), items: items.split("\n").map((x) => x.trim()).filter(Boolean) }, { success: "Sparat" })) setOpen(null);
        }}>Spara</BusyButton>}>
        <TextField label="Namn" value={name} onChange={setName} />
        <TextArea label="Rader (en per rad)" value={items} onChange={setItems} rows={8} />
      </Sheet>
    </Section>
  );
}

function CodeLists({ s }: { s: any }) {
  const run = useCommand();
  const [list, setList] = useState<string>("");
  const [label, setLabel] = useState("");
  const current = s.code_lists.find((l: any) => l.code === list);
  return (
    <Section title="Kodlistor">
      <Card>
        <Select label="Lista" value={list} onChange={setList} empty="Välj lista" options={s.code_lists.map((l: any) => ({ value: l.code, label: l.label }))} />
        {current && (
          <>
            {current.description && <p className="mb-2 text-sm text-sot-3">{current.description}</p>}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {current.values.filter((v: any) => !v.archived).map((v: any) => (
                <span key={v.id} className="chip">{v.label}{v.site && <button type="button" className="ml-1 text-sot-3" aria-label={`Ta bort ${v.label}`} onClick={() => run("ArchiveCodeValue", { id: v.id }, { success: "Borttagen" })}>×</button>}</span>
              ))}
            </div>
            {current.extensible ? (
              <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (label.trim() && await run("UpsertCodeValue", { list_code: current.code, label_sv: label.trim() }, { success: "Tillagd" })) setLabel(""); }}>
                <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nytt värde" aria-label="Nytt värde" />
                <button type="submit" className="btn-secondary">Lägg till</button>
              </form>
            ) : <p className="text-sm text-sot-3">Listan är gemensam för alla platser.</p>}
          </>
        )}
      </Card>
    </Section>
  );
}

function Export() {
  const { repo } = useApp();
  const [progress, setProgress] = useState<string | null>(null);
  const [withMedia, setWithMedia] = useState(false);
  return (
    <Section title="Export">
      <Card>
        <p className="mb-2 text-sot-2">Allt du har rätt att se, som JSON – en fil per tabell i ett paket. Platsens data är din.</p>
        <Toggle label="Ta med bildernas sökvägar" checked={withMedia} onChange={setWithMedia} />
        <BusyButton className="btn-secondary" onClick={async () => {
          const tables = await repo.query<string[]>("q_export", {});
          const out: Record<string, unknown[]> = {};
          for (const [i, t] of tables.entries()) {
            setProgress(`${i + 1} av ${tables.length}: ${t}`);
            const rows: unknown[] = [];
            for (let offset = 0; ; offset += 1000) {
              const page = await repo.query<unknown[]>("q_export", { table: t, limit: 1000, offset });
              rows.push(...page);
              if (page.length < 1000) break;
            }
            if (rows.length && (withMedia || t !== "core.media")) out[t] = rows;
          }
          const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), format: "vreta-2.0", tables: out }, null, 1)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `vreta-export-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          setProgress(`Klart – ${num(Object.values(out).reduce((n, r) => n + r.length, 0))} rader`);
        }}><Download size={16} /> Exportera</BusyButton>
        {progress && <div className="mt-2 text-sm text-sot-3">{progress}</div>}
      </Card>
    </Section>
  );
}
