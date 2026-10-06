import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { LISTING_TYPE_LABEL } from "../domain/labels";
import type { ListingType } from "../domain/types";
import { PageHeader } from "../ui/bits";

const LOCALITY_KEY = "vreta.annons.ort";
function lastLocality(): string {
  try {
    return localStorage.getItem(LOCALITY_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Steg 1 av utflödet (4.6): välj typ, antal och ort. Sedan öppnas annonsstudion. */
export function NewListingPage() {
  const [params] = useSearchParams();
  const objectId = params.get("objekt");
  // Efterlysning av ett projektbehov (6.4): rubrik och antal från behovet, annonsen kopplas tillbaka
  const needId = params.get("behov");
  const { repo, refresh } = useApp();
  const navigate = useNavigate();
  const { data: need } = useData(async (r) => {
    if (!needId) return null;
    const n = (await r.needs()).find((x) => x.id === needId) ?? null;
    if (!n) return null;
    const [fulfilled, project] = await Promise.all([r.needFulfillments([n.id]), r.projects().then((ps) => ps.find((p) => p.id === n.project_id) ?? null)]);
    const left = n.quantity != null ? Math.max(0, n.quantity - fulfilled.reduce((s, f) => s + f.quantity, 0)) : null;
    return { n, left, project };
  }, [needId]);
  const { data } = useData(async (r) => {
    if (!objectId) return { object: null, usable: null };
    const object = await r.object(objectId);
    const allocs = object ? await r.allocations(objectId) : [];
    const usable = allocs.length > 1 ? allocs.filter((a) => ["collected", "stored", "processing"].includes(a.status)).reduce((s, a) => s + a.quantity, 0) : object?.quantity ?? null;
    return { object, usable };
  }, [objectId]);

  const [type, setType] = useState<ListingType>(objectId ? "sell" : "wanted");
  const [title, setTitle] = useState("");
  const [quantity, setQuantity] = useState("");
  const [locality, setLocality] = useState(lastLocality());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!need) return;
    setType("wanted");
    setTitle(need.left ? `${need.n.title} – ${need.left.toLocaleString("sv-SE")} ${need.n.unit}` : need.n.title);
  }, [need]);

  useEffect(() => {
    if (!data?.object) return;
    setTitle(data.object.title);
    if (data.object.is_batch && data.usable != null) setQuantity(String(data.usable));
  }, [data]);

  const types: ListingType[] = objectId ? ["sell", "give", "exchange", "lend"] : ["wanted", "help_wanted", "sell", "give"];
  const max = data?.usable ?? null;
  const qty = quantity ? Number(quantity) : null;
  const tooMany = qty != null && max != null && qty > max;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      try {
        localStorage.setItem(LOCALITY_KEY, locality.trim());
      } catch {
        /* bara en bekvämlighet */
      }
      const l = await repo.saveListing({
        object_id: objectId, type, title: title.trim(), description: data?.object?.description ?? "", price: type === "give" ? 0 : null,
        quantity: data?.object?.is_batch ? qty : need?.left ?? null, locality: locality.trim(), image_ids: [],
      });
      if (need) await repo.updateNeed(need.n.id, { listing_id: l.id });
      await refresh();
      navigate(`/annons/${l.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (objectId && data && !data.object) return <p>Objektet finns inte.</p>;
  return (
    <div className="mx-auto max-w-xl">
      {data?.object && <Link to={`/objekt/${data.object.id}`} className="text-sm font-semibold text-falu">← {data.object.title}</Link>}
      {need?.project && <Link to={`/projekt/${need.project.id}`} className="text-sm font-semibold text-falu">← {need.project.name}</Link>}
      <PageHeader kicker="Lägg ut" title={data?.object ? "Ge det ett nytt hem" : "Ny annons eller efterlysning"} />

      <p className="field-label">Vad vill du göra?</p>
      <div className="mb-5 flex flex-wrap gap-2">
        {types.map((t) => <button key={t} className={`chip ${type === t ? "chip-on" : ""}`} onClick={() => setType(t)}>{LISTING_TYPE_LABEL[t]}</button>)}
      </div>

      <div className="card mb-5 space-y-4 p-4">
        <div>
          <label className="field-label" htmlFor="t">Rubrik</label>
          <input id="t" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === "wanted" ? "T.ex. 500 gamla tegelstenar" : ""} />
        </div>
        {data?.object?.is_batch && (
          <div>
            <label className="field-label" htmlFor="q">Antal ({data.object.unit}) – {max} finns att lägga ut</label>
            <input id="q" type="number" min={1} max={max ?? undefined} className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            {tooMany && <p className="mt-1 text-sm text-falu">Det finns bara {max} {data.object.unit} i lager.</p>}
            {qty != null && max != null && qty < max && !tooMany && <p className="mt-1 text-[12px] text-sot-3">Partiet delas: {qty} läggs ut, {max - qty} stannar i lager.</p>}
          </div>
        )}
        <div>
          <label className="field-label" htmlFor="o">Ort</label>
          <input id="o" className="input" value={locality} onChange={(e) => setLocality(e.target.value)} placeholder="Kommun eller tätort, aldrig adress" />
          <p className="mt-1 text-[12px] text-sot-3">Annonser visar bara ort. Adressen ger du till köparen när ni bestämt tid.</p>
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-falu">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || !title.trim() || tooMany || (data?.object?.is_batch === true && !qty)} onClick={create}>
        {busy ? <Loader2 className="animate-spin" size={18} /> : null} Till annonsstudion <ArrowRight size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
