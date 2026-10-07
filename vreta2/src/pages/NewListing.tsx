// Ny annons: sälja, skänka, byta eller låna ut en sak – eller efterlysa något till ett projektbehov.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApp, useCommand, useQuery } from "../app/AppContext";
import { CONDITION, LISTING_TYPES } from "../app/labels";
import { newKey } from "../data/repo";
import { Card, Chip, ErrorNote, PageHeader, Spinner } from "../ui/base";
import { NumberField, Select, TextArea, TextField, numOrNull, strOrNull } from "../ui/fields";
import { BusyButton } from "../ui/sheet";

export default function NewListing() {
  const [sp] = useSearchParams();
  const objectId = sp.get("objekt");
  const needId = sp.get("behov");
  const { ctx } = useApp();
  const run = useCommand();
  const nav = useNavigate();
  const { data: o, loading } = useQuery<any>(objectId ? "q_object" : null, { id: objectId });
  const marketplaces = (ctx?.codes.channel ?? []).filter((c) => (c.attributes?.kind ?? "marketplace") === "marketplace");
  const [type, setType] = useState(objectId ? "sell" : "wanted");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("");
  const [condition, setCondition] = useState("");
  const [price, setPrice] = useState("");
  const [channels, setChannels] = useState<string[]>(["blocket", "facebook_marketplace"]);
  useEffect(() => {
    if (o) {
      setTitle(o.label.replace(/^1 st /, ""));
      setCondition(o.condition ? String(o.condition) : "");
      const free = (o.allocations ?? []).filter((a: any) => ["stored", "collected", "processing"].includes(a.status)).reduce((n: number, a: any) => n + Number(a.quantity), 0);
      if (o.batch) setQty(String(free || o.batch.total_quantity));
    }
  }, [o]);
  if (objectId && loading) return <Spinner />;
  const types = objectId ? ["sell", "give", "exchange", "lend"] : ["wanted", "help_wanted"];
  return (
    <div>
      <PageHeader kicker="Annons" title={o ? `Annonsera ${o.title.toLowerCase()}` : "Efterlys"} sub="Texten för varje kanal skapas i nästa steg – utan givare, adress, lagerplats eller inköpspris." />
      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap gap-2">{types.map((t) => <Chip key={t} on={type === t} onClick={() => setType(t)}>{LISTING_TYPES[t]}</Chip>)}</div>
        <TextField label="Rubrik" value={title} onChange={setTitle} placeholder={objectId ? "" : "Till exempel: Gammalt tegel till en mur"} />
        <TextArea label="Beskrivning" value={desc} onChange={setDesc} rows={3} />
        {o?.batch && <NumberField label="Antal" value={qty} onChange={setQty} unit={o.batch.unit} />}
        {objectId && <Select label="Skick" value={condition} onChange={setCondition} empty="Okänt" options={Object.entries(CONDITION).map(([value, label]) => ({ value, label }))} />}
        {["sell", "exchange", "lend"].includes(type) && <NumberField label="Pris" value={price} onChange={setPrice} unit="kr" hint="Lämna tomt så föreslår VRETA ett pris i nästa steg." />}
        <div className="mb-1 text-sm font-semibold text-sot-2">Kanaler</div>
        <div className="flex flex-wrap gap-2">
          {marketplaces.map((c) => <Chip key={c.code} on={channels.includes(c.code)} onClick={() => setChannels((x) => x.includes(c.code) ? x.filter((y) => y !== c.code) : [...x, c.code])}>{c.label}</Chip>)}
        </div>
      </Card>
      {!title.trim() && <ErrorNote>Skriv en rubrik.</ErrorNote>}
      <BusyButton className="btn-primary mt-3 w-full" disabled={!title.trim() || !channels.length} onClick={async () => {
        const id = newKey();
        const r = await run("CreateListing", { id, type, object_id: objectId, need_id: needId, title: title.trim(), description: strOrNull(desc),
          quantity: numOrNull(qty), condition: numOrNull(condition), price: numOrNull(price), channels });
        if (r) nav(`/annons/${id}`, { replace: true });
      }}>Fortsätt till annonsstudion</BusyButton>
    </div>
  );
}
