// Demodata för VRETA 2: platsen Vreta med exempelkedjorna A–D från specifikationen (R1.1 bilaga A).
// Allt skapas genom Domain API – samma kommandon som appen använder – så att demot också prövar reglerna.
// Används av demoläget (PGlite i webbläsaren) och av databastesterna. Personer och adresser är påhittade.

export type SeedRole = "owner" | "helper" | "reader";

export interface SeedApi {
  bootstrap(params: Record<string, unknown>): Promise<{ site_id: string }>;
  ok<T = any>(as: SeedRole, type: string, payload: Record<string, unknown>): Promise<T>;
  // Låter en demoanvändare ta emot en inbjudningslänk (medhjälpare/läsare).
  join(as: SeedRole, token: string): Promise<void>;
  // Valfritt: skapar en illustration som media och returnerar media-id (demoläget). Testerna hoppar över bilder.
  media?(as: SeedRole, spec: { title: string; kind: string; color: string; people?: boolean }): Promise<string | null>;
}

export type SeedIds = Record<string, string>;

const LON0 = 17.585;
const LAT0 = 59.842;
const M_LAT = 1 / 111320;
const M_LON = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180));

// Rektangel i meter runt en punkt (x österut, y norrut från platsens mitt).
export function rect(x: number, y: number, w: number, h: number, skew = 0) {
  const c = (dx: number, dy: number) => [LON0 + (x + dx) * M_LON, LAT0 + (y + dy) * M_LAT];
  return {
    type: "Polygon",
    coordinates: [[c(-w / 2, -h / 2), c(w / 2 + skew, -h / 2), c(w / 2, h / 2), c(-w / 2 - skew, h / 2), c(-w / 2, -h / 2)]],
  };
}

export function ellipse(x: number, y: number, rx: number, ry: number, n = 18) {
  const pts: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([LON0 + (x + Math.cos(a) * rx) * M_LON, LAT0 + (y + Math.sin(a) * ry) * M_LAT]);
  }
  return { type: "Polygon", coordinates: [pts] };
}

export function point(x: number, y: number) {
  return { type: "Point", coordinates: [LON0 + x * M_LON, LAT0 + y * M_LAT] };
}

export const DEMO_CENTER = { lon: LON0, lat: LAT0 };

const day = 24 * 3600 * 1000;
function ago(days: number, hour = 10) {
  const d = new Date(Date.now() - days * day);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
function ahead(days: number, hour = 10) {
  return ago(-days, hour);
}
function dateOnly(iso: string) {
  return iso.slice(0, 10);
}

export async function seedDemo(api: SeedApi, opts: { siteName?: string } = {}): Promise<SeedIds> {
  const ids: SeedIds = {};
  const media = async (spec: { title: string; kind: string; color: string; people?: boolean }) =>
    api.media ? await api.media("owner", spec) : null;
  const mids = async (...specs: { title: string; kind: string; color: string; people?: boolean }[]) =>
    (await Promise.all(specs.map(media))).filter((x): x is string => !!x);

  // ------------------------------------------------------------------ platsen och medlemmar
  const site = await api.bootstrap({
    name: opts.siteName ?? "Vreta",
    display_name: "Ägaren",
    description: "En regenerativ återbruksfastighet med skogsträdgård och permakultur.",
    approx_lat: 59.84,
    approx_lon: 17.59,
    address: "Vretavägen 12, 755 91 Uppsala",
  });
  ids.site = site.site_id;
  const helperLink = await api.ok("owner", "CreateGuestLink", { label: "Medhjälpare (demo)", role: "helper" });
  await api.join("helper", helperLink.token);
  const readerLink = await api.ok("owner", "CreateGuestLink", { label: "Läsare (demo)", role: "reader" });
  await api.join("reader", readerLink.token);
  const guestLink = await api.ok("owner", "CreateGuestLink", { label: "Familj och vänner" });
  ids.guest_token = guestLink.token;
  await api.ok("helper", "SetDisplayName", { display_name: "Medhjälparen" });
  await api.ok("reader", "SetDisplayName", { display_name: "Läsaren" });

  // ------------------------------------------------------------------ platser på Vreta
  const place = async (key: string, payload: Record<string, unknown>) => {
    const r = await api.ok("owner", "CreatePlace", payload);
    ids[key] = r.id;
    return r.id as string;
  };
  await place("skogstradgarden", { kind: "zone", name: "Skogsträdgården", type_code: "forest_garden", geometry: rect(-45, -10, 60, 45, 6), description: "Sju skikt från kronor till marktäcke." });
  await place("dammen", { kind: "zone", name: "Dammen", type_code: "pond", geometry: ellipse(30, -38, 18, 11), description: "Grävd 2025, med badplats och sandbank." });
  await place("frukttradgarden", { kind: "zone", name: "Fruktträdgården", type_code: "orchard", geometry: rect(30, 25, 40, 26) });
  await place("odlingszonen", { kind: "zone", name: "Odlingszonen", type_code: "vegetable_field", geometry: rect(-8, 32, 34, 22) });
  await place("angen", { kind: "zone", name: "Ängen", type_code: "meadow", geometry: rect(-50, 40, 40, 28, 4) });
  await place("rabatten", { kind: "zone", name: "Nordvästra rabatten", type_code: "perennial_bed", geometry: rect(-24, 18, 14, 6) });
  await place("villan", { kind: "structure", name: "Villan", type_code: "residence", geometry: rect(-14, 2, 14, 11) });
  await place("orangeriet", { kind: "structure", name: "Orangeriet", type_code: "orangery", geometry: rect(8, 6, 16, 8), description: "Återbrukat orangeri för odling, måltider och gäster." });
  await place("garage", { kind: "structure", name: "Garage", type_code: "garage", geometry: rect(-2, -16, 9, 7) });
  await place("honshuset", { kind: "structure", name: "Hönshuset", type_code: "henhouse", parent_id: ids.odlingszonen, geometry: rect(4, 36, 5, 4) });
  await place("vaxthuset", { kind: "structure", name: "Växthuset", type_code: "greenhouse", status: "planned", reality_mode: "vision", geometry: rect(18, 34, 10, 6) });
  await place("sodra_vaggen", { kind: "space", name: "Södra väggen", type_code: "wall", parent_id: ids.orangeriet });
  await place("gastrummet", { kind: "space", name: "Gästrummet", type_code: "guest_room", parent_id: ids.orangeriet });
  await place("vanster_vagg", { kind: "space", name: "Vänster vägg", type_code: "wall", parent_id: ids.garage });
  await place("lager_vanster", { kind: "storage_location", name: "Hyllorna vänster vägg", parent_id: ids.vanster_vagg });
  await place("hylla3", { kind: "storage_location", name: "Hylla 3", parent_id: ids.lager_vanster });
  await place("pall_a", { kind: "storage_location", name: "Pall A", parent_id: ids.garage });
  await place("inplantering", { kind: "storage_location", name: "Inplantering", parent_id: ids.odlingszonen });

  // ------------------------------------------------------------------ platser utanför Vreta
  await place("aterbruket", { kind: "external_place", name: "Återbruket", kind_code: "reuse_store", locality: "Uppsala", address: "Industrigatan 5, Uppsala" });
  await place("handelstradgarden", { kind: "external_place", name: "Handelsträdgården", kind_code: "nursery", locality: "Uppsala" });
  await place("grustaget", { kind: "external_place", name: "Grustaget", kind_code: "gravel_pit", locality: "Knivsta" });

  // ------------------------------------------------------------------ människor
  const person = async (key: string, payload: Record<string, unknown>) => {
    const r = await api.ok("owner", "CreatePerson", payload);
    ids[key] = r.person_id;
    return r.person_id as string;
  };
  await person("anders", { display_name: "Anders Lind", locality: "Ockelbo", how_we_met: "Annons på Blocket", phone: "070-123 45 67", address: "Byvägen 4, Ockelbo" });
  await person("lena", { display_name: "Lena Berg", locality: "Uppsala", how_we_met: "Tips från Anders" });
  await person("johan", { display_name: "Johan Ek", locality: "Uppsala", how_we_met: "Arbetsdag", roles: ["craftsperson"] });
  await person("birgitta", { display_name: "Birgitta Holm", locality: "Uppsala", how_we_met: "Granne" });
  await person("torsten", { display_name: "Torsten Lindholm", locality: "Gävle", how_we_met: "Facebookgrupp" });
  await person("karin", { display_name: "Karin Söder", locality: "Uppsala" });
  await person("sara", { display_name: "Sara Nyman", locality: "Uppsala" });
  await person("andreas", { display_name: "Andreas Grön", locality: "Knivsta", roles: ["supplier"] });
  await person("kejvan", { display_name: "Kejvan Rahimi", locality: "Uppsala", roles: ["transporter"] });
  const org = await api.ok("owner", "CreateOrganization", { name: "Gröns Schakt AB", kind_code: "company", locality: "Knivsta" });
  ids.grons = org.organization_id;
  await api.ok("owner", "LinkPersonOrganization", { person_id: ids.andreas, organization_id: ids.grons, role_title: "Ägare" });
  await api.ok("owner", "ChangeConsent", { person_id: ids.anders, name: "yes", image: "no", contribution: "yes", given_how: "muntligt" });
  await api.ok("owner", "ChangeConsent", { person_id: ids.johan, name: "yes", image: "yes", contribution: "yes", given_how: "muntligt" });
  await api.ok("owner", "ChangeConsent", { person_id: ids.birgitta, name: "yes", image: "ask", contribution: "yes", given_how: "meddelande" });
  await api.ok("owner", "ChangeConsent", { person_id: ids.karin, name: "no", image: "no", contribution: "ask", given_how: "muntligt" });
  await api.ok("owner", "SetPersonRelation", { person_id: ids.anders, other_person_id: ids.lena, kind_code: "introduced" });
  await api.ok("owner", "SetPersonRelation", { person_id: ids.lena, other_person_id: ids.johan, kind_code: "friend" });
  const johanPhoto = await media({ title: "Johan", kind: "person", color: "#7C8A5C", people: true });
  if (johanPhoto) await api.ok("owner", "SetPersonPhoto", { person_id: ids.johan, media_id: johanPhoto });

  // ------------------------------------------------------------------ projekt och behov
  const orangeriet = await api.ok("owner", "CreateProject", { name: "Orangeriet", kind_code: "build", status: "active", place_id: ids.orangeriet, description: "Ett varmt, återbrukat rum för odling, måltider och gäster.", geometry: rect(8, 6, 18, 10) });
  ids.p_orangeriet = orangeriet.project_id;
  ids.need_tegel = (await api.ok("owner", "AddNeed", { project_id: ids.p_orangeriet, title: "Tegel till muren", kind_code: "material", quantity: 1500, unit: "st", category: "brick" })).need_id;
  ids.need_mura = (await api.ok("owner", "AddNeed", { project_id: ids.p_orangeriet, title: "Hjälp att mura norra väggen", kind_code: "help" })).need_id;
  ids.need_fonster = (await api.ok("owner", "AddNeed", { project_id: ids.p_orangeriet, title: "Fönster till södra väggen", kind_code: "material", quantity: 8, unit: "st", category: "windows" })).need_id;
  ids.p_dammen = (await api.ok("owner", "CreateProject", { name: "Dammen", kind_code: "construction", status: "planned", place_id: ids.dammen, description: "Badplats, sandbank, plantering och filtrering." })).project_id;
  ids.need_lera = (await api.ok("owner", "AddNeed", { project_id: ids.p_dammen, title: "Lera till dammkanten", kind_code: "material", quantity: 4, unit: "ton" })).need_id;
  ids.p_skog = (await api.ok("owner", "CreateProject", { name: "Skogsträdgården fas 2", kind_code: "planting", status: "idea", place_id: ids.skogstradgarden })).project_id;

  // ------------------------------------------------------------------ Kedja A: gjutjärnsfönstren (köp → nytt liv → tack)
  const fonsterBild = await mids({ title: "Gjutjärnsfönster", kind: "window", color: "#4A463F" });
  ids.fonster = (await api.ok("owner", "CreateObject", {
    title: "Gjutjärnsfönster", quantity: 6, unit: "st", category: "windows", material: "Gjutjärn", age_period: "1890-tal",
    condition: 3, dimensions: "60 × 90 cm", weight_kg: 18, occurred_at: ago(25), media_ids: fonsterBild,
    story_why: "Från ett torp från 1890-talet i Ockelbo.", source_type: "ai_capture",
  })).object_id;
  ids.acq_fonster = (await api.ok("owner", "CreateAcquisition", {
    object_id: ids.fonster, type: "purchase", counterpart_person_id: ids.anders, price: 1200, payment_method: "Swish",
    source_url: "https://www.blocket.se/annons/exempel", occurred_at: ago(25),
  })).acquisition_id;
  await api.ok("owner", "AdvanceAcquisition", { acquisition_id: ids.acq_fonster, status: "contacted", occurred_at: ago(24) });
  await api.ok("owner", "LogInteraction", { person_id: ids.anders, channel_code: "message", summary: "Fönstren finns kvar, hämtas före november", body: "Hej! Ja, alla sex finns kvar. 200 kr styck. Du kan hämta en lördag. /Anders", occurred_at: ago(24) });
  await api.ok("owner", "AdvanceAcquisition", { acquisition_id: ids.acq_fonster, status: "agreed", occurred_at: ago(23), pickup_window_end: ago(-20) });
  ids.pickup_fonster = (await api.ok("owner", "PlanPickup", {
    acquisition_id: ids.acq_fonster, scheduled_on: dateOnly(ago(18)), window_start: ago(18, 10), window_end: ago(18, 12),
    from_address: "Byvägen 4, Ockelbo", checklist_template: "large_windows", resources: [{ label: "Skåpbil" }, { label: "Släp 750 kg" }],
  })).pickup_id;
  await api.ok("owner", "CompletePickup", { pickup_id: ids.pickup_fonster, occurred_at: ago(18, 14), receipts: [{ object_id: ids.fonster, receipt_status: "received" }] });
  await api.ok("owner", "MoveObject", { object_id: ids.fonster, to_place_id: ids.lager_vanster, occurred_at: ago(17) });
  await api.ok("owner", "UseObject", {
    object_id: ids.fonster, quantity: 4, type: "mounted", place_id: ids.sodra_vaggen, project_id: ids.p_orangeriet,
    need_id: ids.need_fonster, occurred_at: ago(4), note: "Renoverade med linoljekitt och monterade i södra väggen.",
    media_ids: await mids({ title: "Orangeriet – södra väggen", kind: "orangery", color: "#8C2F1D" }),
  });
  await api.ok("owner", "AdvanceAcquisition", { acquisition_id: ids.acq_fonster, status: "settled", occurred_at: ago(17) });

  // ------------------------------------------------------------------ Fångst → förslag → godkänn (AC-26): tegel från Lena, Anders tipsade
  const cap = await api.ok("helper", "RecordCapture", { text: "Tegel till orangeriet från Lena, Anders tipsade. 400 st gamla handslagna.", kind_hint: "find", client_created_at: ago(12) });
  const prop = await api.ok("owner", "CreateProposal", {
    capture_id: cap.capture_id, agent: "local_heuristics", summary: "400 tegel från Lena till orangeriet",
    cards: [
      { key: "object", kind: "object", fields: [
        { field: "title", value: "Tegel", confidence: 0.9, evidence: [{ kind: "text_excerpt", excerpt: "Tegel till orangeriet" }] },
        { field: "quantity", value: 400, confidence: 0.85, evidence: [{ kind: "text_excerpt", excerpt: "400 st" }] },
        { field: "unit", value: "st", confidence: 0.85 },
        { field: "category", value: "brick", confidence: 0.8 },
        { field: "description", value: "Gamla handslagna tegelstenar", confidence: 0.6 },
      ] },
      { key: "person", kind: "person", fields: [{ field: "display_name", value: "Lena", confidence: 0.6, evidence: [{ kind: "text_excerpt", excerpt: "från Lena" }] }, { field: "_match", value: null }],
        match_entity_id: ids.lena, match_candidates: [{ entity_id: ids.lena, title: "Lena Berg", shared: ["förnamn", "Anders tipsade om Lena"] }] },
      { key: "acquisition", kind: "acquisition", fields: [{ field: "type", value: "gift", confidence: 0.5 }] },
      { key: "links", kind: "links", fields: [
        { field: "project_id", value: ids.p_orangeriet, confidence: 0.8, evidence: [{ kind: "text_excerpt", excerpt: "till orangeriet" }] },
        { field: "need_id", value: ids.need_tegel, confidence: 0.75 },
        { field: "tipster", value: "Anders Lind", confidence: 0.7, evidence: [{ kind: "text_excerpt", excerpt: "Anders tipsade" }] },
        { field: "tipster_person_id", value: ids.anders, confidence: 0.7 },
      ] },
    ],
  });
  const approved = await api.ok("owner", "ApproveProposal", {
    proposal_id: prop.proposal_id,
    cards: [
      { key: "object", kind: "object", decision: "accept", fields: { title: "Tegel", quantity: 400, unit: "st", category: "brick", description: "Gamla handslagna tegelstenar", weight_kg: 2.5, occurred_at: ago(12) } },
      { key: "person", kind: "person", decision: "accept", match_entity_id: ids.lena, fields: {} },
      { key: "acquisition", kind: "acquisition", decision: "accept", fields: { type: "gift", occurred_at: ago(12) } },
      { key: "links", kind: "links", decision: "accept", fields: { project_id: ids.p_orangeriet, need_id: ids.need_tegel, tipster_person_id: ids.anders } },
    ],
  });
  ids.tegel = approved.object_id;
  ids.acq_tegel = approved.acquisition_id;
  await api.ok("owner", "AdvanceAcquisition", { acquisition_id: ids.acq_tegel, status: "agreed", occurred_at: ago(11) });
  ids.pickup_tegel = (await api.ok("helper", "PlanPickup", { acquisition_id: ids.acq_tegel, scheduled_on: dateOnly(ago(10)), checklist_template: "heavy", resources: [{ label: "Släp" }, { label: "Bärhjälp" }] })).pickup_id;
  await api.ok("helper", "CompletePickup", { pickup_id: ids.pickup_tegel, occurred_at: ago(10, 15), storage_location_id: ids.pall_a });
  await api.ok("owner", "UseObject", { object_id: ids.tegel, quantity: 340, type: "built_in", place_id: ids.sodra_vaggen, project_id: ids.p_orangeriet, need_id: ids.need_tegel, occurred_at: ago(3), note: "Södra muren klar." });
  // Andra tegelpartiet: köpt på Återbruket
  ids.tegel2 = (await api.ok("owner", "CreateObject", { title: "Tegel, röda", quantity: 620, unit: "st", category: "brick", status: "collected", occurred_at: ago(6), weight_kg: 2.5 })).object_id;
  await api.ok("owner", "CreateAcquisition", { object_id: ids.tegel2, type: "purchase", status: "received", external_place_id: ids.aterbruket, price: 3100, payment_method: "Kort", occurred_at: ago(6) });
  await api.ok("owner", "FulfillNeed", { need_id: ids.need_tegel, quantity: 620, source_kind: "acquisition", object_id: ids.tegel2, note: "Köpt på Återbruket" });
  await api.ok("owner", "MoveObject", { object_id: ids.tegel2, to_place_id: ids.pall_a, occurred_at: ago(6) });

  // ------------------------------------------------------------------ Kedja B: rhododendron (gåva → plantering → ett år senare)
  ids.rhodo = (await api.ok("owner", "CreateObject", {
    title: "Rhododendron", quantity: 12, unit: "st", category: "trees", living_material: true, species_variety: "Rhododendron 'Cunningham's White'",
    occurred_at: ago(40), media_ids: await mids({ title: "Rhododendron", kind: "plant", color: "#4F5E3A" }),
  })).object_id;
  const acqRhodo = await api.ok("owner", "CreateAcquisition", { object_id: ids.rhodo, type: "gift", counterpart_person_id: ids.birgitta, status: "agreed", occurred_at: ago(40) });
  ids.pickup_rhodo = (await api.ok("owner", "PlanPickup", { acquisition_id: acqRhodo.acquisition_id, scheduled_on: dateOnly(ago(39)), checklist_template: "plants" })).pickup_id;
  await api.ok("owner", "CompletePickup", { pickup_id: ids.pickup_rhodo, occurred_at: ago(39), storage_location_id: ids.inplantering });
  await api.ok("owner", "UseObject", { object_id: ids.rhodo, quantity: 10, type: "planted", place_id: ids.rabatten, occurred_at: ago(30), note: "Före-bild från samma vinkel som efter." });
  await api.ok("owner", "CompleteDisposal", { object_id: ids.rhodo, quantity: 2, type: "donated", counterpart_person_id: ids.sara, occurred_at: ago(29) });

  // ------------------------------------------------------------------ Kedja C: arbetsdagen (efterlysning → bidrag → tack)
  ids.listing_help = (await api.ok("owner", "CreateListing", { type: "help_wanted", need_id: ids.need_mura, title: "Hjälp att mura orangeriets norra vägg", description: "Lördag med lunch under eken. Ingen erfarenhet krävs.", channels: ["facebook_group"] })).listing_id;
  await api.ok("owner", "MarkChannelPosted", { listing_id: ids.listing_help, channel_code: "facebook_group", external_url: "https://www.facebook.com/groups/exempel/posts/1" });
  await api.ok("owner", "LogLead", { listing_id: ids.listing_help, person_id: ids.johan, message: "Jag kan komma och mura!" });
  await api.ok("owner", "RecordContribution", { person_id: ids.johan, type_code: "time", hours: 6, description: "Murade södra väggen", project_id: ids.p_orangeriet, need_id: ids.need_mura, occurred_at: ago(3), place_id: ids.orangeriet, story_value: true });
  await api.ok("owner", "RecordContribution", { person_id: ids.johan, type_code: "knowledge", description: "Lärde ut kalkbruk", project_id: ids.p_orangeriet, occurred_at: ago(3) });
  await api.ok("owner", "RecordContribution", { person_id: ids.karin, type_code: "food", description: "Lunch till arbetslaget", project_id: ids.p_orangeriet, occurred_at: ago(3) });
  await api.ok("owner", "RecordContribution", { person_id: ids.anders, type_code: "tip", description: "Tipsade om Lenas tegel", occurred_at: ago(13) });
  await api.ok("owner", "RecordReciprocity", { person_id: ids.johan, type_code: "plants", description: "Plantor med hem", occurred_at: ago(3) });

  // ------------------------------------------------------------------ Kedja D: överskott (lager → annons → ny ägare)
  ids.dorrar = (await api.ok("owner", "CreateObject", {
    title: "Spegeldörrar i furu", quantity: 3, unit: "st", category: "doors", material: "Furu", condition: 4, dimensions: "70 × 200 cm",
    status: "stored", place_id: ids.pall_a, occurred_at: ago(430), media_ids: await mids({ title: "Spegeldörrar", kind: "door", color: "#B9852B" }),
  })).object_id;
  await api.ok("owner", "CreateAcquisition", { object_id: ids.dorrar, type: "purchase", status: "settled", price: 450, payment_method: "Kontant", counterpart_person_id: ids.torsten, occurred_at: ago(430) });
  ids.listing_dorrar = (await api.ok("owner", "CreateListing", { type: "sell", object_id: ids.dorrar, title: "Tre spegeldörrar i furu, 70×200", price: 300, quantity: 3, locality: "Uppsala", description: "Gamla innerdörrar från en rivning, fint skick.", price_rationale: "Köpt 150 kr/st · skick 4/5 · sålda dörrar 250–400 kr", channels: ["blocket", "facebook_marketplace"] })).listing_id;
  await api.ok("owner", "SaveChannelPost", { listing_id: ids.listing_dorrar, channel_code: "blocket", title: "Tre spegeldörrar i furu, 70×200", body: "Gamla innerdörrar från en rivning, fint skick. 300 kr/st. Hämtas i Uppsala kommun." });
  await api.ok("owner", "MarkChannelPosted", { listing_id: ids.listing_dorrar, channel_code: "blocket", external_url: "https://www.blocket.se/annons/exempel-dorrar" });
  await api.ok("owner", "MarkChannelPosted", { listing_id: ids.listing_dorrar, channel_code: "facebook_marketplace", external_url: "https://www.facebook.com/marketplace/item/exempel" });
  const l1 = await api.ok("owner", "LogLead", { listing_id: ids.listing_dorrar, person_name: "Karin", message: "Kan jag titta på lördag?" });
  await api.ok("owner", "LogLead", { listing_id: ids.listing_dorrar, person_id: ids.johan, message: "Är de kvar? Visning lör 11:00?" });
  await api.ok("owner", "LogLead", { listing_id: ids.listing_dorrar, person_id: ids.sara, message: "Vad är måtten exakt?" });
  await api.ok("owner", "SetLeadStatus", { lead_id: l1.lead_id, status: "viewing_booked", viewing_at: ago(2, 11) });
  await api.ok("owner", "SetLeadStatus", { lead_id: l1.lead_id, status: "no_show" });

  // ------------------------------------------------------------------ lagret, nytt liv och journalen
  ids.handtag = (await api.ok("owner", "CreateObject", { title: "Mässingshandtag", quantity: 8, unit: "st", category: "fittings", material: "Mässing", status: "stored", place_id: ids.hylla3, occurred_at: ago(400) })).object_id;
  ids.radiator = (await api.ok("helper", "CreateObject", { title: "Gjutjärnsradiator", category: "radiators", material: "Gjutjärn", condition: 3, weight_kg: 60, occurred_at: ago(2) })).object_id;
  await api.ok("helper", "CreateAcquisition", { object_id: ids.radiator, type: "purchase", counterpart_person_id: ids.torsten, price: 800, occurred_at: ago(2) });
  ids.lampa = (await api.ok("owner", "CreateObject", { title: "Emaljlampa", category: "lamps", status: "stored", place_id: ids.hylla3, occurred_at: ago(60), condition: 4 })).object_id;
  await api.ok("owner", "RecordObservation", { kind_code: "species", place_id: ids.frukttradgarden, description: "Rödhake sjunger i äppelträdet", taxon_suggestion: "Rödhake", certainty: "probable", occurred_at: ago(5) });
  await api.ok("owner", "RecordObservation", { kind_code: "water", place_id: ids.dammen, description: "Grodrom i dammens grunda del", occurred_at: ago(20), story_value: true });
  await api.ok("helper", "RecordObservation", { kind_code: "weather_local", place_id: ids.skogstradgarden, description: "Frost i nordsluttningen i natt", occurred_at: ago(1, 7), follow_up_on: dateOnly(ahead(2)) });
  await api.ok("owner", "RecordObservation", { kind_code: "bloom", place_id: ids.rabatten, description: "Rhododendronen sätter knopp", occurred_at: ago(2) });
  await api.ok("owner", "RecordDecision", { question: "Var ska växthuset ligga?", background: "Söderläge och nära vatten.", alternatives: ["Vid odlingszonen", "Vid orangeriet"], choice: "Vid odlingszonen", rationale: "Kortare väg för vatten och närmare hönsen.", project_id: ids.p_orangeriet, place_id: ids.odlingszonen });
  await api.ok("owner", "CreateTask", { title: "Ring Torsten om radiatorerna", due_at: ahead(1), subject_entity_id: ids.torsten });
  await api.ok("owner", "CreateTask", { title: "Beställ kalkbruk till norra väggen", due_at: ago(1), subject_entity_id: ids.p_orangeriet });

  // ------------------------------------------------------------------ en fångst som väntar på granskning
  const cap2 = await api.ok("helper", "RecordCapture", { text: "Tre ekdörrar från Torsten Lindholm i Gävle, 150 kr styck, hämtas före 1 november, behöver släp.", kind_hint: "find", client_created_at: ago(0, 8) });
  await api.ok("owner", "CreateProposal", {
    capture_id: cap2.capture_id, agent: "local_heuristics", summary: "3 ekdörrar från Torsten Lindholm, Gävle",
    cards: [
      { key: "object", kind: "object", fields: [
        { field: "title", value: "Ekdörrar", confidence: 0.92, evidence: [{ kind: "text_excerpt", excerpt: "Tre ekdörrar" }] },
        { field: "quantity", value: 3, confidence: 0.9, evidence: [{ kind: "text_excerpt", excerpt: "Tre" }] },
        { field: "unit", value: "st", confidence: 0.9 },
        { field: "category", value: "doors", confidence: 0.8 },
      ] },
      { key: "person", kind: "person", fields: [
        { field: "display_name", value: "Torsten Lindholm", confidence: 0.82, evidence: [{ kind: "text_excerpt", excerpt: "från Torsten Lindholm i Gävle" }] },
        { field: "locality", value: "Gävle", confidence: 0.8, evidence: [{ kind: "text_excerpt", excerpt: "i Gävle" }] },
        { field: "_match", value: null },
      ], match_candidates: [{ entity_id: ids.torsten, title: "Torsten Lindholm", shared: ["samma namn", "samma ort", "sålde spegeldörrar"] }] },
      { key: "acquisition", kind: "acquisition", fields: [
        { field: "type", value: "purchase", confidence: 0.75 },
        { field: "price", value: 450, confidence: 0.7, evidence: [{ kind: "text_excerpt", excerpt: "150 kr styck" }] },
      ] },
      { key: "task", kind: "pickup", fields: [
        { field: "title", value: "Hämta ekdörrarna i Gävle", confidence: 0.7 },
        { field: "due_at", value: "2026-11-01", confidence: 0.65, evidence: [{ kind: "text_excerpt", excerpt: "hämtas före 1 november" }] },
        { field: "note", value: "Behöver släp", confidence: 0.6, evidence: [{ kind: "text_excerpt", excerpt: "behöver släp" }] },
      ] },
    ],
  });

  // ------------------------------------------------------------------ berättelser
  const story = await api.ok("owner", "CreateContent", { goal_code: "before_after", title: "Fönstren från Ockelbo", source_ids: [ids.fonster], person_ids: [ids.anders], channels: ["instagram", "facebook"] });
  ids.story_fonster = story.content_id;
  await api.ok("owner", "SaveChannelVariant", { content_id: ids.story_fonster, channel_code: "instagram", body: "Fönstren från ett torp i Ockelbo har fått nytt liv i orangeriet. Tack Anders för att du lät dem följa med hit! #återbruk #orangeri", media_ids: fonsterBild });
  await api.ok("owner", "SaveChannelVariant", { content_id: ids.story_fonster, channel_code: "facebook", body: "Sex gjutjärnsfönster från 1890-talet hämtades i Ockelbo i september. Nu sitter fyra av dem i orangeriets södra vägg, renoverade med linoljekitt. Tack Anders Lind för att du lät dem följa med hit!", media_ids: fonsterBild });
  await api.ok("owner", "ApproveContent", { content_id: ids.story_fonster });
  await api.ok("owner", "MarkContentShared", { content_id: ids.story_fonster, channels: ["instagram"], shared_url: "https://www.instagram.com/p/exempel" });
  await api.ok("helper", "AddStoryNote", { entity_id: ids.tegel, kind: "why", text: "Handslaget tegel från ett hus som revs 1960 – samma färg som orangeriets gamla mur." });

  return ids;
}
