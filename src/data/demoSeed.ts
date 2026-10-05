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
  }

  const people = await repo.persons();
  const anders = people.find((p) => p.name === "Anders");
  if (anders) await repo.updateConsent(anders.id, { consent_name: "yes", consent_contribution: "yes" });

  // Ett nytt fynd som väntar på granskning
  const capId = crypto.randomUUID();
  const media = withImages ? [await addImage(repo, "handtag", "capture", capId)] : [];
  const cap = await repo.saveCapture(capId, { text: "Fyra mässingshandtag från Anders, 50 kr styck, hämtas före 15 november", kind: "find", media_ids: media.map((m) => m.id) });
  await repo.attachProposal(cap.id, fromHeuristics(parseCaptureText(cap.input.text), await repo.persons()));
}
