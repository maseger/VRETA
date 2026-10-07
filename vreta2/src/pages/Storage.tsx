// Lager: hyllor, pallar och lådor med QR-etiketter. Skanna en etikett så öppnas lagerplatsen med det som står där.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus, Printer, ScanLine } from "lucide-react";
import { useCan, useCommand, useQuery } from "../app/AppContext";
import { useScreen } from "../app/useScreen";
import { ago } from "../app/format";
import { qrSvg, scanOnce, scannerAvailable, storageUrl } from "../services/qr";
import { Card, Empty, ErrorNote, List, PageHeader, Row, Section, Spinner } from "../ui/base";
import { Thumb } from "../ui/media";
import { PlacePicker, TextField, strOrNull } from "../ui/fields";
import { BusyButton, Sheet } from "../ui/sheet";
import { MoveSheet } from "./ObjectPage";

export default function Storage() {
  const { id } = useParams();
  return id ? <StorageLocation id={id} /> : <StorageTree />;
}

function StorageTree() {
  const can = useCan();
  const { data, error, loading } = useQuery<any[]>("q_storage_tree");
  const [scan, setScan] = useState(false);
  const [create, setCreate] = useState(false);
  return (
    <div>
      <PageHeader kicker="Saker" title="Lager">
        <button type="button" className="btn-secondary btn-small" onClick={() => setScan(true)}><ScanLine size={16} /> Skanna</button>
        {can("CreatePlace") && <button type="button" className="btn-primary btn-small" onClick={() => setCreate(true)}><Plus size={16} /> Ny lagerplats</button>}
      </PageHeader>
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <Spinner />}
      {data && !data.length && <Empty>Inga lagerplatser än. Skapa en hylla, pall eller låda och sätt upp en QR-etikett.</Empty>}
      {data && data.length > 0 && (
        <List>
          {data.map((s) => (
            <Row key={s.id} to={`/lager/${s.id}`} right={<span className="text-sm text-sot-3">{s.count} st</span>}>
              <div className="font-semibold">{s.name}</div>
              <div className="truncate text-sm text-sot-3">{s.path}</div>
            </Row>
          ))}
        </List>
      )}
      <ScanSheet open={scan} onClose={() => setScan(false)} tree={data ?? []} />
      <NewStorageSheet open={create} onClose={() => setCreate(false)} />
    </div>
  );
}

function StorageLocation({ id }: { id: string }) {
  const can = useCan();
  const run = useCommand();
  const { data: s, error, loading } = useQuery<any>("q_place", { id });
  const [svg, setSvg] = useState("");
  const [move, setMove] = useState<any>(null);
  const [relocate, setRelocate] = useState(false);
  const [parent, setParent] = useState("");
  const [create, setCreate] = useState(false);
  useScreen(s ? { id: s.id, type: "storage_location", title: s.name } : null);
  useEffect(() => { qrSvg(storageUrl(id)).then(setSvg); }, [id]);
  const { data: obj } = useQuery<any>(move ? "q_object" : null, { id: move?.id });
  if (loading) return <Spinner />;
  if (error || !s) return <ErrorNote>{error ?? "Lagerplatsen finns inte"}</ErrorNote>;
  return (
    <div>
      <PageHeader kicker={<Link to="/lager">Lager</Link>} title={s.name} sub={s.path} />
      <div className="grid gap-4 md:grid-cols-[1fr_200px]">
        <div>
          <Section title={`Här står · ${s.stored.length}`}>
            {s.stored.length === 0 ? <Empty>Tomt här.</Empty> : (
              <List>
                {s.stored.map((o: any) => (
                  <Row key={o.id + o.place_path} to={`/objekt/${o.id}`} leading={<Thumb m={o.cover} size={40} />}
                    right={can("MoveObject") && <button type="button" className="btn-ghost btn-small" onClick={(e) => { e.preventDefault(); setMove(o); }}>Flytta</button>}>
                    <div className="font-semibold">{o.label}</div>
                    <div className="text-sm text-sot-3">{o.place_path !== s.path ? `${o.place_path} · ` : ""}sedan {ago(o.since)}</div>
                  </Row>
                ))}
              </List>
            )}
          </Section>
          {s.children.length > 0 && (
            <Section title="Delar">
              <List>{s.children.map((c: any) => <Row key={c.id} to={c.route}>{c.title}</Row>)}</List>
            </Section>
          )}
          <div className="flex flex-wrap gap-2">
            {can("CreatePlace") && <button type="button" className="btn-secondary btn-small" onClick={() => setCreate(true)}><Plus size={15} /> Hylla eller låda här</button>}
            {can("MoveStorageLocation") && <button type="button" className="btn-ghost btn-small" onClick={() => setRelocate(true)}>Flytta lagerplatsen</button>}
          </div>
        </div>
        <Card className="h-fit text-center print:shadow-none">
          <div className="mx-auto w-40" aria-label={`QR-kod för ${s.name}`} dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="mt-1 font-serif text-lg">{s.name}</div>
          <div className="font-mono text-sm text-sot-3">{s.qr_code}</div>
          <button type="button" className="btn-ghost btn-small mt-2" onClick={() => window.print()}><Printer size={15} /> Skriv ut etikett</button>
        </Card>
      </div>
      {obj && <MoveSheet open onClose={() => setMove(null)} object={obj} alloc={null} />}
      <Sheet open={relocate} onClose={() => setRelocate(false)} title="Flytta lagerplatsen"
        footer={<BusyButton disabled={!parent} onClick={async () => { if (await run("MoveStorageLocation", { id: s.id, parent_id: parent }, { success: "Flyttad" })) setRelocate(false); }}>Flytta</BusyButton>}>
        <PlacePicker label="Ny plats" value={parent} onChange={setParent} />
        <p className="text-sm text-sot-3">Allt som står här följer med.</p>
      </Sheet>
      <NewStorageSheet open={create} onClose={() => setCreate(false)} parentId={s.id} />
    </div>
  );
}

function NewStorageSheet({ open, onClose, parentId }: { open: boolean; onClose: () => void; parentId?: string }) {
  const run = useCommand();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [parent, setParent] = useState(parentId ?? "");
  const [desc, setDesc] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Ny lagerplats"
      footer={<BusyButton disabled={!name.trim()} onClick={async () => {
        const r = await run<{ id: string }>("CreatePlace", { kind: "storage_location", name: name.trim(), parent_id: parent || null, description: strOrNull(desc) }, { success: "Lagerplatsen är skapad" });
        if (r?.id) { onClose(); setName(""); nav(`/lager/${r.id}`); }
      }}>Skapa</BusyButton>}>
      <TextField label="Namn" value={name} onChange={setName} placeholder="Hylla 4, Pall B, Låda med beslag …" autoFocus />
      {!parentId && <PlacePicker label="Var finns den?" value={parent} onChange={setParent} empty="Välj byggnad, rum eller annan lagerplats" />}
      <TextField label="Beskrivning" value={desc} onChange={setDesc} />
    </Sheet>
  );
}

function ScanSheet({ open, onClose, tree }: { open: boolean; onClose: () => void; tree: any[] }) {
  const nav = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !scannerAvailable() || !video.current) return;
    const ctrl = new AbortController();
    scanOnce(video.current, ctrl.signal).then((raw) => {
      if (!raw) return;
      const m = raw.match(/lager\/([0-9a-f-]{36})/i);
      if (m) { onClose(); nav(`/lager/${m[1]}`); } else setErr("Koden hör inte till VRETA:s lager.");
    }).catch(() => setErr("Kameran gick inte att starta."));
    return () => ctrl.abort();
  }, [open, nav, onClose]);
  const find = () => {
    const hit = tree.find((s) => s.qr_code?.toLowerCase() === code.trim().toLowerCase() || s.name.toLowerCase() === code.trim().toLowerCase());
    if (hit) { onClose(); nav(`/lager/${hit.id}`); } else setErr("Ingen lagerplats med den koden.");
  };
  return (
    <Sheet open={open} onClose={onClose} title="Skanna etikett">
      {scannerAvailable() ? <video ref={video} className="mb-3 aspect-square w-full rounded-xl bg-sot object-cover" muted playsInline /> :
        <p className="mb-3 text-sot-3">Den här webbläsaren kan inte skanna i appen – använd telefonens kamera på etiketten, eller skriv koden.</p>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); find(); }}>
        <input className="input font-mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Kod på etiketten" aria-label="Kod på etiketten" />
        <button type="submit" className="btn-secondary">Öppna</button>
      </form>
      {err && <div className="mt-2"><ErrorNote>{err}</ErrorNote></div>}
    </Sheet>
  );
}
