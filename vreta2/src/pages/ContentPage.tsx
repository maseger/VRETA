// En berättelse: utkast per kanal → granskning → ägaren godkänner → delas med ett eget tryck (INV-04).
// Databasen gör den sista integritetskontrollen innan godkännandet.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Copy, Share2, ShieldCheck } from "lucide-react";
import { useApp, useCan, useCommand, useQuery } from "../app/AppContext";
import { CONSENT } from "../app/labels";
import { d } from "../app/format";
import { copyText, shareContent } from "../services/share";
import { Card, ErrorNote, PageHeader, Section, Spinner, Stamp, statusTone } from "../ui/base";
import { MediaImg } from "../ui/media";
import { TextArea } from "../ui/fields";
import { BusyButton, Sheet } from "../ui/sheet";
import { useToast } from "../app/toast";

const VIOLATION: Record<string, string> = {
  name_without_consent: "Namn utan samtycke", giver_name_in_listing: "Givarens namn", address: "Adress", storage_location: "Lagerplats",
  purchase_price: "Inköpspris", private_image: "Privat bild", image_without_consent: "Bild utan samtycke", phone: "Telefonnummer", email: "Mejl", locality: "Hemort",
};

export default function ContentPage() {
  const { id } = useParams();
  const { data: c, error, loading } = useQuery<any>("q_content", { id });
  if (loading) return <Spinner />;
  if (error || !c) return <ErrorNote>{error ?? "Berättelsen finns inte"}</ErrorNote>;
  return <ContentView c={c} />;
}

function ContentView({ c }: { c: any }) {
  const { ctx } = useApp();
  const can = useCan();
  const run = useCommand();
  const [violations, setViolations] = useState<any[] | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const label = (code: string) => ctx?.codes.channel?.find((x) => x.code === code)?.label ?? code;
  const goal = ctx?.codes.content_goal?.find((g) => g.code === c.goal_code)?.label;

  return (
    <div>
      <PageHeader kicker={<>Berättelse{goal ? ` · ${goal}` : ""}</>} title={c.title}
        sub={<span className="flex flex-wrap items-center gap-2"><Stamp tone={statusTone(null, c.status)}>{c.status_label}</Stamp>
          {c.shared_at && <span>Delad {d(c.shared_at)}</span>}
          {c.shared_url && <a href={c.shared_url} target="_blank" rel="noreferrer">Öppna inlägget</a>}</span>} />

      <div className="mb-4 flex flex-wrap gap-2">
        {c.sources.map((s: any) => s.route ? <Link key={s.id} to={s.route} className="chip no-underline">{s.title}</Link> : <span key={s.id} className="chip">{s.title}</span>)}
      </div>

      {c.status !== "shared" && (
        <div className="mb-4 flex flex-wrap gap-2">
          {can("ApproveContent") && ["draft", "review"].includes(c.status) && (
            <BusyButton className="btn-done" onClick={async () => {
              setViolations(null);
              await run("ApproveContent", { content_id: c.id }, { success: "Godkänd – nu kan du dela", silent: true,
                onRejected: (x) => setViolations(Array.isArray(x.suggestion) ? x.suggestion : [{ channel_code: "", violations: [{ kind: x.code, text: x.reason }] }]) });
            }}><ShieldCheck size={18} /> Godkänn</BusyButton>
          )}
          {can("MarkContentShared") && c.status === "approved" && <button type="button" className="btn-primary" onClick={() => setShareOpen(true)}><Share2 size={18} /> Dela</button>}
          {can("SetContentStatus") && (c.next ?? []).filter((n: any) => !["approved", "shared"].includes(n.to)).map((n: any) => (
            <BusyButton key={n.to} className="btn-ghost" onClick={() => run("SetContentStatus", { content_id: c.id, status: n.to }, { success: n.label })}>{n.label}</BusyButton>
          ))}
        </div>
      )}
      {!can("ApproveContent") && c.status === "review" && <p className="mb-4 text-sot-3">Väntar på att ägaren godkänner.</p>}

      {violations && (
        <div className="mb-4"><ErrorNote>
          <div className="mb-1 font-semibold">Den sista kontrollen stoppade godkännandet:</div>
          <ul>{violations.flatMap((v) => (v.violations ?? []).map((x: any, i: number) => <li key={v.channel_code + i}>– {v.channel_code ? `${label(v.channel_code)}: ` : ""}{VIOLATION[x.kind] ?? x.kind} {x.text ? `"${x.text}"` : ""}</li>))}</ul>
          <div className="mt-1">Ändra texten eller be om samtycke, och godkänn igen.</div>
        </ErrorNote></div>
      )}

      {c.variants.map((v: any) => <Variant key={v.channel_code} v={v} content={c} label={label(v.channel_code)} />)}

      {c.persons.length > 0 && (
        <Section title="Samtycke för det här inlägget">
          <Card>
            {c.persons.map((p: any) => <ConsentRow key={p.id} p={p} contentId={c.id} editable={can("RecordContentConsent") && c.status !== "shared"} />)}
            <p className="mt-2 text-sm text-sot-3">Gäller bara det här inlägget. Personens generella samtycke ändras på personens sida.</p>
          </Card>
        </Section>
      )}
      <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} c={c} label={label} />
    </div>
  );
}

function Variant({ v, content, label }: { v: any; content: any; label: string }) {
  const can = useCan();
  const run = useCommand();
  const toast = useToast();
  const [body, setBody] = useState(v.body ?? "");
  const editable = can("SaveChannelVariant") && !["approved", "shared"].includes(content.status);
  return (
    <Section title={label}>
      <Card>
        {editable ? <TextArea label="Text" value={body} onChange={setBody} rows={8} /> : <p className="whitespace-pre-wrap">{v.body}</p>}
        {(v.media ?? []).length > 0 && <div className="mb-2 flex gap-2">{v.media.map((m: any) => <MediaImg key={m.id} m={m} className="h-20 w-20 rounded-lg" />)}</div>}
        {(v.removed_by_guard ?? []).length > 0 && <div className="mb-2 text-sm text-sot-3">Togs bort av integritetsfiltret: {v.removed_by_guard.map((r: any) => r.text).join(", ")}</div>}
        {(v.warnings ?? []).map((w: string, i: number) => <div key={i} className="text-sm text-ockra">⚠ {w}</div>)}
        <div className="mt-2 flex flex-wrap gap-2">
          {editable && body !== v.body && <BusyButton className="btn-secondary btn-small" onClick={() => run("SaveChannelVariant", { content_id: content.id, channel_code: v.channel_code, body, media_ids: v.media_ids }, { success: "Sparat" })}>Spara ändringen</BusyButton>}
          <button type="button" className="btn-ghost btn-small" onClick={async () => { await copyText(v.body ?? ""); toast("Texten är kopierad"); }}><Copy size={14} /> Kopiera</button>
        </div>
      </Card>
    </Section>
  );
}

function ConsentRow({ p, contentId, editable }: { p: any; contentId: string; editable: boolean }) {
  const run = useCommand();
  const aspects: [string, string][] = [["name", "Namn"], ["image", "Bild"], ["contribution", "Bidrag"], ["quote", "Citat"]];
  return (
    <div className="border-b border-dashed border-lera py-2 last:border-0">
      <div className="mb-1 font-semibold">{p.display_name}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {aspects.map(([a, l]) => {
          const post = p.post_consent?.[a];
          const general = a === "quote" ? "no" : p.consent?.[a] ?? "ask";
          const value = post ?? general;
          return (
            <label key={a} className="flex items-center gap-1.5 text-sm">
              <span className="text-sot-3">{l}:</span>
              {editable ? (
                <select className="rounded border border-lera bg-papper px-1 py-0.5" value={value}
                  onChange={(e) => run("RecordContentConsent", { content_id: contentId, person_id: p.id, aspect: a, value: e.target.value, given_how: "i appen" }, { success: "Samtycket är sparat" })}>
                  {Object.entries(CONSENT).map(([k, x]) => <option key={k} value={k}>{x}</option>)}
                </select>
              ) : <span>{CONSENT[value]}</span>}
              {post && <span className="text-xs text-sot-3">(inlägget)</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function ShareSheet({ open, onClose, c, label }: { open: boolean; onClose: () => void; c: any; label: (code: string) => string }) {
  const { repo } = useApp();
  const run = useCommand();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [shared, setShared] = useState<string[]>([]);
  return (
    <Sheet open={open} onClose={onClose} title="Dela"
      footer={<BusyButton className="btn-done" disabled={!shared.length} onClick={async () => {
        if (await run("MarkContentShared", { content_id: c.id, shared_url: url.trim() || null, channels: shared }, { success: "Markerad som delad" })) onClose();
      }}>Klart – det är delat</BusyButton>}>
      <p className="mb-3 text-sot-2">Texten kopieras först, sedan öppnas delningen med bilderna. Facebook och Instagram tar bara emot bilderna – klistra in texten själv.</p>
      <div className="flex flex-col gap-2">
        {c.variants.map((v: any) => (
          <button key={v.channel_code} type="button" className="btn-secondary justify-between" onClick={async () => {
            const urls = (await Promise.all((v.media ?? []).map((m: any) => repo.mediaUrl(m.share_path)))).filter(Boolean) as string[];
            await shareContent({ text: v.body ?? "", title: c.title, urls });
            setShared((x) => x.includes(v.channel_code) ? x : [...x, v.channel_code]);
            toast("Texten är kopierad", "info");
          }}>
            <span><Share2 size={16} className="mr-2 inline" />{label(v.channel_code)}</span>{shared.includes(v.channel_code) && <Stamp tone="ok">Delad</Stamp>}
          </button>
        ))}
      </div>
      <div className="mt-3"><label className="label" htmlFor="shared-url">Länk till inlägget (valfritt)</label>
        <input id="shared-url" className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></div>
    </Sheet>
  );
}
