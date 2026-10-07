// Ny sak utan att gå via Fånga – för den som vill fylla i själv.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp, useCommand } from "../app/AppContext";
import { ACQUISITION_TYPES, CONDITION } from "../app/labels";
import { newKey } from "../data/repo";
import { Card, PageHeader } from "../ui/base";
import { NumberField, PersonPicker, PlacePicker, Select, TextArea, TextField, Toggle, numOrNull, strOrNull, type PersonChoice } from "../ui/fields";
import { PhotoPicker, useUpload } from "../ui/media";
import { BusyButton } from "../ui/sheet";

const START = [
  { value: "discovered", label: "Upptäckt – inte hämtad än" },
  { value: "collected", label: "Hämtad – inte på plats än" },
  { value: "stored", label: "Hemma i lager" },
  { value: "in_use", label: "Redan i bruk" },
];

export default function NewObject() {
  const { ctx } = useApp();
  const run = useCommand();
  const upload = useUpload();
  const nav = useNavigate();
  const [title, setTitle] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("st");
  const [status, setStatus] = useState("stored");
  const [place, setPlace] = useState("");
  const [category, setCategory] = useState("");
  const [material, setMaterial] = useState("");
  const [dims, setDims] = useState("");
  const [condition, setCondition] = useState("");
  const [why, setWhy] = useState("");
  const [living, setLiving] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [acqType, setAcqType] = useState("");
  const [from, setFrom] = useState<PersonChoice | null>(null);
  const [price, setPrice] = useState("");

  async function save() {
    const mediaIds = await upload(files);
    const id = newKey();
    const r = await run<{ object_id: string }>("CreateObject", {
      id, title: title.trim(), quantity: numOrNull(qty), unit: qty ? unit : null, status, place_id: place || null, category_id: category || null,
      material: strOrNull(material), dimensions: strOrNull(dims), condition: numOrNull(condition), story_why: strOrNull(why), living_material: living,
      media_ids: mediaIds,
    });
    if (!r) return;
    if (acqType) {
      await run("CreateAcquisition", { object_id: id, type: acqType, counterpart_person_id: from?.id ?? null, counterpart_name: from && !from.id ? from.name : null,
        price: numOrNull(price), status: status === "discovered" ? "lead" : "received" });
    }
    nav(`/objekt/${id}`, { replace: true });
  }

  return (
    <div>
      <PageHeader kicker="Saker" title="Ny sak" sub="Snabbare: ta en bild med Fånga så fyller VRETA i åt dig." />
      <Card className="mb-4">
        <PhotoPicker files={files} onChange={setFiles} />
        <div className="divider my-4" />
        <TextField label="Vad är det?" value={title} onChange={setTitle} placeholder="Till exempel: Gjutjärnsfönster" required />
        <div className="grid grid-cols-2 gap-x-3">
          <NumberField label="Antal (för partier)" value={qty} onChange={setQty} hint="Tomt = en enskild sak" />
          <TextField label="Enhet" value={unit} onChange={setUnit} mic={false} />
        </div>
        <Select label="Kategori" value={category} onChange={setCategory} empty="Välj kategori"
          options={(ctx?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <Select label="Var i flödet?" value={status} onChange={setStatus} options={START} />
        {status !== "discovered" && <PlacePicker label={status === "in_use" ? "Var används den?" : "Var finns den?"} value={place} onChange={setPlace} storage={status !== "in_use"} />}
        <div className="grid grid-cols-2 gap-x-3">
          <TextField label="Material" value={material} onChange={setMaterial} />
          <TextField label="Mått" value={dims} onChange={setDims} />
        </div>
        <Select label="Skick" value={condition} onChange={setCondition} empty="Okänt" options={Object.entries(CONDITION).map(([value, label]) => ({ value, label }))} />
        <Toggle label="Levande material" checked={living} onChange={setLiving} hint="Plantor, frön, sticklingar – följs upp efter plantering." />
        <TextArea label="Varför sparar vi den?" value={why} onChange={setWhy} rows={2} />
      </Card>
      <Card className="mb-4">
        <h2 className="mb-2 text-lg">Hur kom den till oss? (valfritt)</h2>
        <Select label="Typ" value={acqType} onChange={setAcqType} empty="Hoppa över" options={Object.entries(ACQUISITION_TYPES).map(([value, label]) => ({ value, label }))} />
        {acqType && <>
          <PersonPicker label="Från vem?" value={from} onChange={setFrom} />
          {acqType === "purchase" && <NumberField label="Pris" value={price} onChange={setPrice} unit="kr" hint="Priset är privat och nämns aldrig i annonser eller berättelser." />}
        </>}
      </Card>
      <BusyButton className="btn-primary w-full" disabled={!title.trim() || (status === "in_use" && !place)} onClick={save}>Spara</BusyButton>
    </div>
  );
}
