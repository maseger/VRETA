// Demodata för att prova appen utan Supabase. Personer och platser är påhittade.
import type { Media } from "../domain/types";
import { parseCaptureText } from "../../supabase/functions/_shared/captureHeuristics";
import { fromHeuristics } from "../services/proposalMapping";
import type { LocalRepo } from "./localRepo";
import { DEMO_ILLUSTRATIONS, svgToJpeg } from "./demoIllustrations";

type Illustration = keyof typeof DEMO_ILLUSTRATIONS;

async function addImage(repo: LocalRepo, key: Illustration, entity_type: string, entity_id: string, role: Media["role"] = "general") {
  const { blob, width, height } = await svgToJpeg(DEMO_ILLUSTRATIONS[key]);
  return repo.saveMedia({ id: crypto.randomUUID(), original: blob, clean: blob, mime: "image/jpeg", width, height, entity_type, entity_id, role });
}

export async function seedDemo(repo: LocalRepo, withImages = true): Promise<void> {
  if (await repo.site()) return;
  await repo.bootstrapSite("Vreta", "Ägaren (demo)");

  const tradgard = await repo.createZone({ name: "Trädgården", kind: "Trädgård", notes: "" });
  await repo.createZone({ name: "Odlingen", kind: "Odling", notes: "" });
  await repo.createZone({ name: "Lagerzonen", kind: "Lager", notes: "Under tak vid garaget" });
  const orangeriZon = await repo.createZone({ name: "Orangeriet", kind: "Byggnad", notes: "Byggs med återbrukade fönster" });
  await repo.createStructure({ name: "Villan", kind: "Bostad", notes: "", zone_id: null });
  await repo.createStructure({ name: "Garaget", kind: "Förråd", notes: "Lager för byggnadsdelar", zone_id: null });
  await repo.createStructure({ name: "Orangeriet", kind: "Växthus", notes: "", zone_id: orangeriZon.id });

  const items: { text: string; why: string; key: Illustration; status: ("collected" | "stored" | "in_use")[] }[] = [
    { text: "Sex gjutjärnsfönster, Anders i Ockelbo, 200 kr styck, måste hämtas före november, behöver släp", why: "Från ett torp byggt på 1890-talet – perfekta till orangeriets södervägg", key: "fonster", status: ["collected", "stored"] },
    { text: "400 tegel gratis från Karin i Gävle, rivning av gammal mur", why: "Handslaget tegel med fina färgskiftningar", key: "tegel", status: ["collected"] },
    { text: "12 rhododendron gratis från Lena i Storvik, ska bort vid husbygge", why: "Över trettio år gamla buskar som annars hade slängts", key: "rhododendron", status: ["collected", "in_use"] },
  ];

  for (const it of items) {
    const capId = crypto.randomUUID();
    const media = withImages ? [await addImage(repo, it.key, "capture", capId)] : [];
    const cap = await repo.saveCapture(capId, { text: it.text, kind: "find", media_ids: media.map((m) => m.id) });
    const content = fromHeuristics(parseCaptureText(it.text), await repo.persons());
    const prop = await repo.attachProposal(cap.id, content);
    const o = content.object!;
    const objectId = await repo.approveProposal({
      proposal_id: prop.id,
      partial: false,
      object: {
        title: o.title.value, category: o.category.value, description: "", material: "", dimensions: "",
        quantity: o.quantity.value, unit: o.unit.value, condition: null,
        field_meta: { title: { confidence: o.title.confidence, verified: true } },
      },
      person: content.person ? { name: content.person.name.value, locality: content.person.locality.value, existing_person_id: null } : null,
      acquisition: content.acquisition
        ? { type: content.acquisition.type.value, price: content.acquisition.price.value, deadline: content.acquisition.deadline.value }
        : null,
      task: it.status.length ? null : content.task ? { title: content.task.title.value, due: content.task.due.value } : null,
      why: it.why,
      media_ids: media.map((m) => m.id),
    });
    for (const s of it.status) await repo.changeStatus(objectId, s, s === "in_use" ? { zone_id: tradgard.id } : undefined);
    const acq = (await repo.acquisitionsFor(objectId))[0];
    if (acq) for (const st of ["agreed", "received", "settled"] as const) await repo.setAcquisitionStatus(acq.id, st);
  }

  // Lager
  const garaget = await repo.createStorageLocation({ name: "Garaget", parent_id: null, structure_id: null, notes: "" });
  const vagg = await repo.createStorageLocation({ name: "Vänster vägg", parent_id: garaget.id, structure_id: null, notes: "" });
  for (const n of ["Hylla 1", "Hylla 2"]) await repo.createStorageLocation({ name: n, parent_id: vagg.id, structure_id: null, notes: "" });
  const hylla3 = await repo.createStorageLocation({ name: "Hylla 3", parent_id: vagg.id, structure_id: null, notes: "" });
  await repo.createStorageLocation({ name: "Låda 7", parent_id: hylla3.id, structure_id: null, notes: "" });
  const lagerzon = await repo.createStorageLocation({ name: "Lagerzonen", parent_id: null, structure_id: null, notes: "Under tak" });
  const pallA = await repo.createStorageLocation({ name: "Pall A", parent_id: lagerzon.id, structure_id: null, notes: "" });
  const objects = await repo.objects();
  const fonster = objects.find((o) => o.title === "Gjutjärnsfönster");
  if (fonster) await repo.storeObject(fonster.id, hylla3.id);
  const tegel = objects.find((o) => o.title === "Tegel");
  if (tegel) await repo.storeObject(tegel.id, pallA.id);

  const people = await repo.persons();
  const anders = people.find((p) => p.name === "Anders");
  if (anders) {
    await repo.updateConsent(anders.id, { consent_name: "yes", consent_contribution: "yes" });
    await repo.updatePersonPrivate(anders.id, { contact: "070-000 00 00", notes: "Har fler fönster från samma torp i ladan." });
    await repo.updatePerson(anders.id, { how_we_met: "Annons på Blocket" });
    await repo.addInteraction({ person_id: anders.id, organization_id: null, channel: "samtal", summary: "Har ytterligare fyra fönster i ladan, vill bli av med dem före jul. Hör av dig i november.", follow_up: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) });
  }

  // Ett köp på gång med planerad hämtning
  const kakelCap = crypto.randomUUID();
  const kakelMedia: Media[] = [];
  const cap2 = await repo.saveCapture(kakelCap, { text: "Vit kakelugn från Birgitta i Sandviken, 3000 kr, måste hämtas före november", kind: "find", media_ids: kakelMedia.map((m) => m.id) });
  const c2 = fromHeuristics(parseCaptureText(cap2.input.text), await repo.persons());
  const p2 = await repo.attachProposal(cap2.id, c2);
  const kakelId = await repo.approveProposal({
    proposal_id: p2.id, partial: false,
    object: { title: "Vit kakelugn", category: "Kakel och ugnar", description: "Rund kakelugn, ca 1900", material: "Kakel", dimensions: "", quantity: 1, unit: "st", condition: 3, field_meta: {} },
    person: { name: "Birgitta", locality: "Sandviken", existing_person_id: null },
    acquisition: { type: "purchase", price: 3000, deadline: c2.acquisition?.deadline.value ?? null },
    task: null, why: "Kan bli hjärtat i orangeriets vinterdel", media_ids: [],
  });
  const kakelAcq = (await repo.acquisitionsFor(kakelId))[0];
  await repo.setAcquisitionStatus(kakelAcq.id, "contacted");
  await repo.setAcquisitionStatus(kakelAcq.id, "agreed");
  await repo.changeStatus(kakelId, "reserved");
  const birgitta = (await repo.persons()).find((p) => p.name === "Birgitta");
  const tpl = (await repo.checklistTemplates()).find((t) => t.name === "Stora byggnadsdelar");
  await repo.createPickup({
    acquisition_id: kakelAcq.id, person_id: birgitta?.id ?? null, title: "Vit kakelugn hos Birgitta",
    scheduled_date: new Date(Date.now() + 864e5).toISOString().slice(0, 10), window_from: "10:00", window_to: "12:00",
    resources: ["Släp", "Bärhjälp", "Filtar"], address: "Sandviken", object_ids: [kakelId], template_id: tpl?.id ?? null,
    safety_note: "Kakelugnen är tung och tas isär i delar – minst två personer.",
  });

  // Ett nytt fynd som väntar på granskning
  const capId = crypto.randomUUID();
  const media = withImages ? [await addImage(repo, "handtag", "capture", capId)] : [];
  const cap = await repo.saveCapture(capId, { text: "Fyra mässingshandtag från Anders, 50 kr styck, hämtas före 15 november", kind: "find", media_ids: media.map((m) => m.id) });
  await repo.attachProposal(cap.id, fromHeuristics(parseCaptureText(cap.input.text), await repo.persons()));
}
