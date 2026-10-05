import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { RESOURCES } from "../domain/labels";
import { PageHeader } from "../ui/bits";

/** Planera hämtning (FR-013, FR-014). Förifylls från objektets anskaffning. */
export function NewPickupPage() {
  const [params] = useSearchParams();
  const objectId = params.get("objekt");
  const { repo, refresh } = useApp();
  const navigate = useNavigate();
  const { data } = useData(async (r) => {
    const [objects, templates, people, acqs] = await Promise.all([r.objects(), r.checklistTemplates(), r.persons(), r.allAcquisitions()]);
    const acq = acqs.find((a) => a.object_id === objectId) ?? null;
    const person = people.find((p) => p.id === acq?.person_id) ?? null;
    return { objects: objects.filter((o) => ["discovered", "contacted", "reserved", "pickup_planned"].includes(o.status)), templates, acq, person, acqs };
  }, [objectId]);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [address, setAddress] = useState("");
  const [resources, setResources] = useState<string[]>(["Bärhjälp"]);
  const [template, setTemplate] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [safety, setSafety] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    const o = data.objects.find((x) => x.id === objectId);
    if (o) {
      setSelected([o.id]);
      setTitle(`${o.title}${data.person ? ` hos ${data.person.name}` : ""}`);
      setTemplate(data.templates.find((t) => (o.category === "Växter" ? t.name === "Växter" : o.category === "Fönster och dörrar" ? t.name === "Fönster och glas" : t.name === "Stora byggnadsdelar"))?.id ?? "");
    }
    if (data.acq?.deadline) setDate(data.acq.deadline);
    if (data.person?.locality) setAddress(data.person.locality);
  }, [data, objectId]);

  if (!data) return null;

  return (
    <form className="mx-auto max-w-xl space-y-5" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const id = await repo.createPickup({
        acquisition_id: data.acq?.id ?? null, person_id: data.person?.id ?? null, title: title.trim(), scheduled_date: date || null,
        window_from: from || null, window_to: to || null, resources, address: address.trim(), object_ids: selected, template_id: template || null, safety_note: safety.trim(),
      });
      await refresh();
      navigate(`/hamtning/${id}`, { replace: true });
    }}>
      <PageHeader kicker="Ny hämtning" title="Planera hämtningen" />
      <div><label className="field-label" htmlFor="t">Rubrik</label><input id="t" className="input" required value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-3 sm:col-span-1"><label className="field-label" htmlFor="d">Datum</label><input id="d" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="f">Från</label><input id="f" type="time" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="field-label" htmlFor="tt">Till</label><input id="tt" type="time" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      <div>
        <label className="field-label" htmlFor="a">Adress</label>
        <input id="a" className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Gata, ort" />
        <p className="mt-1 text-[12px] text-sot-3">Adressen syns bara för dig och medhjälpare, aldrig i berättelser.</p>
      </div>
      <div>
        <p className="field-label">Resurser</p>
        <div className="flex flex-wrap gap-2">{RESOURCES.map((r) => <button type="button" key={r} onClick={() => setResources((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]))} className={`chip ${resources.includes(r) ? "chip-on" : ""}`}>{r}</button>)}</div>
      </div>
      <div>
        <label className="field-label" htmlFor="tpl">Checklista</label>
        <select id="tpl" className="input" value={template} onChange={(e) => setTemplate(e.target.value)}>
          <option value="">Ingen</option>
          {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.items.length})</option>)}
        </select>
      </div>
      <div>
        <p className="field-label">Objekt att hämta</p>
        <ul className="card divide-y divide-dashed divide-lera-light">
          {data.objects.map((o) => (
            <li key={o.id}>
              <label className="flex items-center gap-3 px-4 py-3">
                <input type="checkbox" className="h-5 w-5 accent-[#8C2F1D]" checked={selected.includes(o.id)} onChange={() => setSelected((s) => (s.includes(o.id) ? s.filter((x) => x !== o.id) : [...s, o.id]))} />
                <span>{o.title} <span className="text-sot-3">· {o.quantity} {o.unit}</span></span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div><label className="field-label" htmlFor="s">Säkerhet och annat att tänka på</label><input id="s" className="input" value={safety} onChange={(e) => setSafety(e.target.value)} placeholder="T.ex. tunga fönster – två personer" /></div>
      <button className="btn-primary w-full" disabled={busy || !selected.length}>{busy && <Loader2 className="animate-spin" size={18} />} Skapa hämtning</button>
    </form>
  );
}
