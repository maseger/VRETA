import { Archive, Home, MapPin, Store, Trees } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { PLACE_KINDS } from "../domain/labels";
import { PageHeader } from "../ui/bits";
import { LocationSelect } from "../ui/location";

type Kind = "zon" | "byggnad" | "lager" | "utanfor";

const KINDS: { key: Kind; label: string; text: string; icon: typeof MapPin }[] = [
  { key: "zon", label: "Område på Vreta", text: "Trädgård, odling, äng, skog, gårdsplan", icon: Trees },
  { key: "byggnad", label: "Byggnad eller anläggning", text: "Hus, ladugård, växthus, förråd, jordkällare", icon: Home },
  { key: "lager", label: "Lagerplats", text: "Hylla, låda, pall eller vägg där saker förvaras", icon: Archive },
  { key: "utanfor", label: "Plats utanför Vreta", text: "Loppis, återvinningscentral, gård, butik", icon: Store },
];
const ZONE_KINDS = ["Trädgård", "Odling", "Äng", "Skog", "Gårdsplan", "Lagerzon", "Vatten", "Annat"];
const STRUCTURE_KINDS = ["Bostadshus", "Ladugård", "Garage", "Växthus", "Förråd", "Jordkällare", "Bod", "Anläggning", "Annat"];

/** Lägg till en plats – på Vreta eller utanför. Ytan kan ritas på kartan efteråt. */
export function NewPlacePage() {
  const { repo, refresh, toast } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initial = (KINDS.find((k) => k.key === params.get("typ"))?.key ?? "zon") as Kind;
  const [kind, setKind] = useState<Kind>(initial);
  const [name, setName] = useState("");
  const [sub, setSub] = useState("");
  const [notes, setNotes] = useState("");
  const [zone, setZone] = useState(params.get("zon") ?? "");
  const [structure, setStructure] = useState("");
  const [parent, setParent] = useState(params.get("i") ?? "");
  const [locality, setLocality] = useState("");
  const [address, setAddress] = useState("");
  const [draw, setDraw] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data } = useData(async (r) => {
    const [zones, structures, locations, layers] = await Promise.all([r.zones(), r.structures(), r.storageLocations(), r.mapLayers()]);
    return { zones, structures, locations, hasMap: layers.some((l) => l.kind === "base") };
  });

  const subOptions = kind === "zon" ? ZONE_KINDS : kind === "byggnad" ? STRUCTURE_KINDS : [];
  const canDraw = (kind === "zon" || kind === "byggnad") && !!data?.hasMap;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const n = name.trim();
      if (kind === "zon") {
        const z = await repo.createZone({ name: n, kind: sub, notes: notes.trim() });
        await refresh();
        toast(`${n} är tillagd`);
        navigate(canDraw && draw ? `/platser?rita=zone:${z.id}` : `/zon/${z.id}`, { replace: true });
      } else if (kind === "byggnad") {
        const s = await repo.createStructure({ name: n, kind: sub, notes: notes.trim(), zone_id: zone || null });
        await refresh();
        toast(`${n} är tillagd`);
        navigate(canDraw && draw ? `/platser?rita=structure:${s.id}` : "/platser", { replace: true });
      } else if (kind === "lager") {
        const l = await repo.createStorageLocation({ name: n, parent_id: parent || null, structure_id: structure || null, notes: notes.trim() });
        await refresh();
        toast(`${n} är tillagd`);
        navigate(`/lager/${l.id}`, { replace: true });
      } else {
        const p = await repo.createExternalPlace({ name: n, kind: sub || "loppis", locality: locality.trim(), notes: notes.trim(), address: address.trim() });
        await refresh();
        toast(`${n} är tillagd`);
        navigate(`/plats/${p.id}`, { replace: true });
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link to={kind === "utanfor" ? "/platser?vy=utanfor" : "/platser"} className="text-sm font-semibold text-falu">← Platser</Link>
      <PageHeader kicker="Platser" title="Ny plats" />

      <p className="field-label">Vad för slags plats?</p>
      <div className="mb-5 grid grid-cols-2 gap-2">
        {KINDS.map(({ key, label, text, icon: Icon }) => (
          <button key={key} type="button" aria-pressed={kind === key} onClick={() => { setKind(key); setSub(""); }}
            className={`card flex flex-col items-start gap-1 p-3 text-left ${kind === key ? "border-falu ring-2 ring-falu/30" : "hover:bg-kalk-2/60"}`}>
            <Icon size={20} strokeWidth={1.5} className="text-falu" aria-hidden="true" />
            <span className="font-semibold leading-tight">{label}</span>
            <span className="text-[12px] leading-snug text-sot-3">{text}</span>
          </button>
        ))}
      </div>

      <form className="card space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div>
          <label className="field-label" htmlFor="namn">Namn</label>
          <input id="namn" className="input" required value={name} onChange={(e) => setName(e.target.value)}
            placeholder={{ zon: "T.ex. Äppelängen", byggnad: "T.ex. Ladugården", lager: "T.ex. Hylla 4 eller Pall B", utanfor: "T.ex. Kyrkans loppis" }[kind]} />
        </div>

        {kind === "utanfor" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="slag">Slag</label>
                <select id="slag" className="input" value={sub || "loppis"} onChange={(e) => setSub(e.target.value)}>
                  {PLACE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="ort">Ort</label>
                <input id="ort" className="input" value={locality} onChange={(e) => setLocality(e.target.value)} placeholder="Kommun eller tätort" />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="adr">Adress (privat, valfritt)</label>
              <input id="adr" className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
              <p className="mt-1 text-[12px] text-sot-3">Adressen syns bara för dig och medhjälpare.</p>
            </div>
          </>
        ) : kind === "lager" ? (
          <>
            <div>
              <label className="field-label" htmlFor="i">Ligger i (valfritt)</label>
              {data && <LocationSelect id="i" locations={data.locations} value={parent} onChange={setParent} />}
              <p className="mt-1 text-[12px] text-sot-3">Lämna tomt för en ny plats högst upp, t.ex. ett nytt förråd.</p>
            </div>
            <div>
              <label className="field-label" htmlFor="b">Byggnad (valfritt)</label>
              <select id="b" className="input" value={structure} onChange={(e) => setStructure(e.target.value)}>
                <option value="">Ingen byggnad</option>
                {data?.structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="typ">Typ</label>
                <select id="typ" className="input" value={sub} onChange={(e) => setSub(e.target.value)}>
                  <option value="">Välj typ</option>
                  {subOptions.map((k) => <option key={k}>{k}</option>)}
                </select>
              </div>
              {kind === "byggnad" && (
                <div>
                  <label className="field-label" htmlFor="z">I området</label>
                  <select id="z" className="input" value={zone} onChange={(e) => setZone(e.target.value)}>
                    <option value="">Inget område</option>
                    {data?.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            {canDraw && (
              <label className="flex items-center gap-3 rounded-md bg-kalk-2/70 px-3 py-2.5 text-sm">
                <input type="checkbox" className="h-5 w-5 accent-[#8C2F1D]" checked={draw} onChange={(e) => setDraw(e.target.checked)} />
                Rita in ytan på Vretakartan direkt efteråt
              </label>
            )}
          </>
        )}

        <div>
          <label className="field-label" htmlFor="ant">Anteckning (valfritt)</label>
          <textarea id="ant" className="input min-h-[72px]" value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={kind === "utanfor" ? "Öppettider, vad de brukar ha …" : "Vad finns här, vad är det till?"} />
        </div>

        {error && <p className="text-sm text-falu">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || !name.trim()}>Lägg till platsen</button>
      </form>
    </div>
  );
}
