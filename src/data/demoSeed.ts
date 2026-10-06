// Demodata för att prova appen utan Supabase. Personer och platser är påhittade.
import type { Media } from "../domain/types";
import { parseCaptureText } from "../../supabase/functions/_shared/captureHeuristics";
import { rasterizeIfSvg } from "../services/images";
import { fromHeuristics } from "../services/proposalMapping";
import type { LocalRepo } from "./localRepo";
import { DEMO_ILLUSTRATIONS, svgToJpeg } from "./demoIllustrations";
import { DEMO_BASEMAP_SVG, DEMO_CORNERS, DEMO_GEOM, px } from "./demoMap";

type Illustration = keyof typeof DEMO_ILLUSTRATIONS;

async function addImage(repo: LocalRepo, key: Illustration, entity_type: string, entity_id: string, role: Media["role"] = "general") {
  const { blob, width, height } = await svgToJpeg(DEMO_ILLUSTRATIONS[key]);
  return repo.saveMedia({ id: crypto.randomUUID(), original: blob, clean: blob, mime: "image/jpeg", width, height, entity_type, entity_id, role });
}

export async function seedDemo(repo: LocalRepo, withImages = true): Promise<void> {
  if (await repo.site()) return;
  await repo.bootstrapSite("Vreta", "Ägaren (demo)");

  const tradgard = await repo.createZone({ name: "Trädgården", kind: "Trädgård", notes: "" });
  const odlingen = await repo.createZone({ name: "Odlingen", kind: "Odling", notes: "" });
  const lagerzonZ = await repo.createZone({ name: "Lagerzonen", kind: "Lager", notes: "Under tak vid garaget" });
  const orangeriZon = await repo.createZone({ name: "Orangeriet", kind: "Byggnad", notes: "Byggs med återbrukade fönster" });
  const villan = await repo.createStructure({ name: "Villan", kind: "Bostad", notes: "", zone_id: null });
  const garagetS = await repo.createStructure({ name: "Garaget", kind: "Förråd", notes: "Lager för byggnadsdelar", zone_id: null });
  const orangeriS = await repo.createStructure({ name: "Orangeriet", kind: "Växthus", notes: "", zone_id: orangeriZon.id });

  // Vretakartan (demo): påhittad grundbild och inritade ytor
  await repo.addMapLayer({
    kind: "base", name: "Fastighetskarta (demo)", taken_on: "2021-06-07", image: await rasterizeIfSvg(new Blob([DEMO_BASEMAP_SVG], { type: "image/svg+xml" })),
    corners: DEMO_CORNERS, source_crs: "Demo", opacity: 1,
  });
  await repo.setZoneGeom(tradgard.id, DEMO_GEOM.tradgarden);
  await repo.setZoneGeom(odlingen.id, DEMO_GEOM.odlingen);
  await repo.setZoneGeom(lagerzonZ.id, DEMO_GEOM.lagerzonen);
  await repo.setZoneGeom(orangeriZon.id, DEMO_GEOM.orangerietZon);
  await repo.setStructureGeom(villan.id, DEMO_GEOM.villan);
  await repo.setStructureGeom(garagetS.id, DEMO_GEOM.garaget);
  await repo.setStructureGeom(orangeriS.id, DEMO_GEOM.orangeriet);

  const items: { text: string; why: string; key: Illustration; status: ("collected" | "stored" | "in_use")[] }[] = [
    { text: "Sex gjutjärnsfönster, Anders i Ockelbo, 200 kr styck, måste hämtas före november, behöver släp", why: "Från ett torp byggt på 1890-talet – perfekta till orangeriets södervägg", key: "fonster", status: ["collected", "stored"] },
    { text: "400 tegel gratis från Karin i Gävle, rivning av gammal mur", why: "Handslaget tegel med fina färgskiftningar", key: "tegel", status: ["collected"] },
    { text: "12 rhododendron gratis från Lena i Storvik, ska bort vid husbygge", why: "Över trettio år gamla buskar som annars hade slängts", key: "rhododendron", status: ["collected"] },
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
  if (tegel) {
    await repo.storeObject(tegel.id, pallA.id);
    await repo.recordUsage(tegel.id, { type: "built_in", zone_id: orangeriZon.id, structure_id: null, quantity: 250, project: "Orangeriet", note: "Södra muren, första skiftet", occurred_at: null, geom: null, from_allocation_id: null });
  }
  const rhodo = objects.find((o) => o.title === "Rhododendron");
  if (rhodo) {
    await repo.recordUsage(rhodo.id, { type: "planted", zone_id: tradgard.id, structure_id: null, quantity: null, project: "", note: "Planterade i rad längs västra gränsen", occurred_at: null, geom: { type: "Point", coordinates: px(170, 560) }, from_allocation_id: null });
  }
  await repo.createObservation({ kind: "vatten", text: "Stående vatten i nedre delen av odlingen efter tre dagars regn", zone_id: odlingen.id, structure_id: null, object_id: null, geom: { type: "Point", coordinates: px(820, 650) }, follow_up: null, visibility: "shareable" });
  await repo.createObservation({ kind: "blomning", text: "Första blomningen på de flyttade rhododendronbuskarna", zone_id: tradgard.id, structure_id: null, object_id: rhodo?.id ?? null, geom: { type: "Point", coordinates: px(200, 600) }, follow_up: null, visibility: "shareable" });
  await repo.createDecision({ question: "Var ska kakelugnen stå?", options: "Villan eller orangeriets vinterdel", choice: "Orangeriets vinterdel", rationale: "Värmen gör att citrus kan övervintra där", zone_id: orangeriZon.id, object_id: null, visibility: "internal" });

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

  // Mässingshandtagen är godkända och ligger i Låda 7 (AC-13: "Var är mässingshandtagen?")
  const capId = crypto.randomUUID();
  const media = withImages ? [await addImage(repo, "handtag", "capture", capId)] : [];
  const cap = await repo.saveCapture(capId, { text: "Fyra mässingshandtag från Anders, 50 kr styck, hämtas före 15 november", kind: "find", media_ids: media.map((m) => m.id) });
  const hProp = await repo.attachProposal(cap.id, fromHeuristics(parseCaptureText(cap.input.text), await repo.persons()));
  const handtagId = await repo.approveProposal({
    proposal_id: hProp.id, partial: false,
    object: { title: "Mässingshandtag", category: "Beslag och smide", description: "Fönsterhandtag i mässing, putsade", material: "Mässing", dimensions: "", quantity: 4, unit: "st", condition: 4, field_meta: {} },
    person: anders ? { name: "Anders", locality: "Ockelbo", existing_person_id: anders.id } : null,
    acquisition: { type: "purchase", price: 200, deadline: null }, task: null, why: "Passar gjutjärnsfönstren i orangeriet", media_ids: media.map((m) => m.id),
  });
  for (const id of [handtagId]) for (const st of ["agreed", "received", "settled"] as const) await repo.setAcquisitionStatus((await repo.acquisitionsFor(id))[0].id, st);
  await repo.changeStatus(handtagId, "collected");
  const lada7 = (await repo.storageLocations()).find((l) => l.name === "Låda 7");
  if (lada7) await repo.storeObject(handtagId, lada7.id);

  // En radiator som legat i lager över ett år (Idag och "Vad har legat i lager längst?")
  const radCap = await repo.saveCapture(crypto.randomUUID(), { text: "Två gjutjärnsradiatorer från Göran i Hofors, 800 kr", kind: "find", media_ids: [] });
  const radProp = await repo.attachProposal(radCap.id, fromHeuristics(parseCaptureText(radCap.input.text), await repo.persons()));
  const radId = await repo.approveProposal({
    proposal_id: radProp.id, partial: false,
    object: { title: "Gjutjärnsradiatorer", category: "Byggnadsdelar", description: "Sektionsradiatorer, tio sektioner", material: "Gjutjärn", dimensions: "", quantity: 2, unit: "st", condition: 3, field_meta: {} },
    person: { name: "Göran", locality: "Hofors", existing_person_id: null },
    acquisition: { type: "purchase", price: 800, deadline: null }, task: null, why: "", media_ids: [],
  });
  for (const st of ["agreed", "received", "settled"] as const) await repo.setAcquisitionStatus((await repo.acquisitionsFor(radId))[0].id, st);
  await repo.changeStatus(radId, "collected");
  const hylla1 = (await repo.storageLocations()).find((l) => l.name === "Hylla 1");
  if (hylla1) await repo.storeObject(radId, hylla1.id);
  const rad = await repo.object(radId);
  if (rad) await repo.rawPut("objects", { ...rad, created_at: "2025-06-14T09:00:00.000Z", updated_at: "2025-06-14T09:00:00.000Z" });

  // Ett nytt fynd som väntar på granskning
  const dorrCap = await repo.saveCapture(crypto.randomUUID(), { text: "Tre ekdörrar gratis från Lena i Storvik, hämtas före december", kind: "find", media_ids: [] });
  await repo.attachProposal(dorrCap.id, fromHeuristics(parseCaptureText(dorrCap.input.text), await repo.persons()));

  // M4: 30 tegel sålda via Blocket (AC-04: 250 i bruk, 120 i lager, 30 sålda)
  if (tegel) {
    const annons = await repo.saveListing({ object_id: tegel.id, type: "sell", title: "Handslaget tegel", description: "Gammalt murtegel med fina färgskiftningar, rensat från bruk", price: 450, quantity: 30, locality: "Storvik", image_ids: [] });
    await repo.publishChannel(annons.id, "blocket", "https://www.blocket.se/annons/demo", "manual");
    const johan = await repo.createPerson({ name: "Johan", locality: "Sandviken", roles: [], how_we_met: "Svarade på annonsen ”Handslaget tegel”", organization_id: null, contact: "", notes: "" });
    const lead = await repo.addLead({ listing_id: annons.id, person_id: johan.id, channel: "blocket", message: "Hej! Finns teglet kvar? Kan hämta på lördag.", bid: null });
    await repo.agreeLead(lead.id);
    await repo.completeDisposal(annons.id, { price: 450, payment_method: "Swish" });
    await repo.removeChannel(annons.id, "blocket");
  }

  // En efterlysning med en intressent som väntar på svar
  const sokes = await repo.saveListing({ object_id: null, type: "wanted", title: "Spröjsade fönster till orangeriet", description: "Gärna äldre fönster med spröjs, minst 60 cm breda", price: null, quantity: null, locality: "Storvik", image_ids: [] });
  await repo.publishChannel(sokes.id, "facebook_group", "", "manual");
  const maja = await repo.createPerson({ name: "Maja", locality: "Hofors", roles: [], how_we_met: "Svarade på efterlysningen i Facebookgruppen", organization_id: null, contact: "", notes: "" });
  await repo.addLead({ listing_id: sokes.id, person_id: maja.id, channel: "facebook_group", message: "Jag har fyra spröjsade fönster i förrådet som du får hämta.", bid: null });

  // Bidrag och ömsesidighet
  const erik = await repo.createPerson({ name: "Erik", locality: "Storvik", roles: ["Hantverkare"], how_we_met: "Granne", organization_id: null, contact: "", notes: "" });
  await repo.addContribution({ person_id: erik.id, kind: "tid", description: "Hjälpte till att mura orangeriets södra mur", hours: 6, object_id: tegel?.id ?? null, zone_id: orangeriZon.id, project: "Orangeriet", visibility: "shareable" });
  await repo.addContribution({ person_id: erik.id, kind: "kunskap", description: "Lärde oss blanda kalkbruk", hours: null, object_id: null, zone_id: null, project: "Orangeriet", visibility: "shareable" });
  if (anders) await repo.addReciprocity(anders.id, "Fick rhododendronsticklingar från trädgården");

  // M6: projekt och platser utanför Vreta
  await repo.createProject({ name: "Jordkällaren", kind: "Bygge", status: "planned", description: "Mura upp den gamla jordkällaren vid ladan igen, med kalkbruk och sten från fastigheten.", zone_id: null, structure_id: null, started_on: null, finished_on: null });
  const atervinning = await repo.createExternalPlace({ name: "Återbruket", kind: "atervinning", locality: "Gävle", notes: "Återbruksdelen vid återvinningscentralen. Bra för tegel och fönster.", address: "" });
  const radAcq = (await repo.acquisitionsFor(radId))[0];
  if (radAcq) await repo.setAcquisitionPlace(radAcq.id, atervinning.id);
  await repo.createExternalPlace({ name: "Kyrkans loppis", kind: "loppis", locality: "Sandviken", notes: "Öppet lördagar 10–14.", address: "" });

  // M7: orangeriets behov och yta på kartan
  const orangeriet = (await repo.projects()).find((p) => p.name === "Orangeriet");
  if (orangeriet) {
    await repo.setProjectGeom(orangeriet.id, DEMO_GEOM.orangerietBygge);
    const tegelBehov = await repo.createNeed({ project_id: orangeriet.id, title: "Tegel till södra muren", quantity: 400, unit: "st", notes: "" });
    if (tegel) await repo.fulfillNeed({ need_id: tegelBehov.id, quantity: 250, object_id: tegel.id, contribution_id: null, note: "Första skiftet" });
    const fonster = await repo.createNeed({ project_id: orangeriet.id, title: "Fönster till långsidan", quantity: 12, unit: "st", notes: "Gärna spröjsade, minst 60 cm breda" });
    await repo.updateNeed(fonster.id, { listing_id: sokes.id });
    await repo.createNeed({ project_id: orangeriet.id, title: "Kalkbruk", quantity: null, unit: "säckar", notes: "" });
  }

  // M8: relationer och organisationer
  const everyone = await repo.persons();
  const who = (name: string) => everyone.find((p) => p.name === name);
  const hembygd = await repo.createOrganization({ name: "Storviks hembygdsförening", kind: "Förening", locality: "Storvik" });
  await repo.updatePerson(erik.id, { organization_id: hembygd.id });
  const lena = who("Lena");
  const goran = who("Göran");
  const johanP = who("Johan");
  if (lena) await repo.addRelation({ person_id: erik.id, other_id: lena.id, kind: "granne", note: "" });
  if (anders && goran) await repo.addRelation({ person_id: anders.id, other_id: goran.id, kind: "introduced", note: "Visste att Göran hade radiatorer kvar efter sin renovering" });
  if (birgitta && johanP) await repo.addRelation({ person_id: birgitta.id, other_id: johanP.id, kind: "familj", note: "Johan är Birgittas brorson" });
}
