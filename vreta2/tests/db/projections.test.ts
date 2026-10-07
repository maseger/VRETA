// Läckagetester för publika projektioner: inga privata fält, inga personer utan samtycke, inga exakta
// känsliga positioner, inga vistelser (Designdokument 2.0, Kvalitet och test).
import { beforeAll, describe, expect, test } from "vitest";
import { seeded, type Seeded } from "./seeded";

let s: Seeded;
let pubText: string;
let guestText: string;
let secrets: string[];

beforeAll(async () => {
  s = await seeded();
  const { h, owner, ids } = s;
  // Slå på allt publikt och gör det som får vara publikt publikt – sedan ska ändå inget privat synas.
  for (const flag of ["live", "culture", "hospitality", "life"]) await h.ok(owner, "SetFeatureFlag", { flag, enabled: true });
  await h.ok(owner, "SetVisibility", { id: ids.fonster, visibility: "public" });
  await h.ok(owner, "SetVisibility", { id: ids.johan, visibility: "public" });
  await h.ok(owner, "SetVisibility", { id: ids.karin, visibility: "public" });
  await h.ok(owner, "SetVisibility", { id: ids.story_fonster, visibility: "public" });
  await h.ok(owner, "SetVisibility", { id: ids.listing_help, visibility: "public" });
  // En vistelse och en känslig art
  const acc = await h.ok(owner, "CreateAccommodation", { space_id: ids.gastrummet, name: "Bo i Orangeriet", capacity: 2, public_description: "Gästrum med utsikt", facilities: ["wc", "shower"] });
  await h.ok(owner, "SetVisibility", { id: acc.accommodation_id, visibility: "public" });
  const req = await h.api(null, "submit_contribution", { site: ids.site, kind: "want_to_come", name: "Hemlig Gäst", contact: "hemlig@exempel.se", message: "Vi vill bo en helg", starts_on: "2026-11-20", ends_on: "2026-11-22", party_size: 2 });
  expect(req.ok).toBe(true);
  const sub = (await h.q(owner, "q_review_queue")).submissions[0];
  await h.ok(owner, "ConvertSubmission", { submission_id: sub.id });
  const sr = (await h.q(owner, "q_hospitality")).requests[0];
  await h.ok(owner, "UpdateFields", { id: sr.id, fields: {} }).catch(() => null);
  await h.sql("update hospitality.stay_request set accommodation_id = $1 where id = $2", [acc.accommodation_id, sr.id]);
  await h.ok(owner, "DecideStayRequest", { stay_request_id: sr.id, status: "approved" });
  const sens = (await h.sql("select id from life.taxon where scientific_name = 'Accipiter nisus'"))[0].id;
  await h.ok(owner, "RecordObservation", { taxon_id: sens, description: "Sparvhök häckar i granen", geometry: { type: "Point", coordinates: [17.5851, 59.8421] }, place_id: ids.skogstradgarden });
  await h.jobs(owner);
  const dump = async (table: string) => JSON.stringify(await h.sql(`select * from ${table}`));
  pubText = (await Promise.all(["pub.live_item", "pub.wanted", "pub.tour", "pub.tour_stop", "pub.map_feature", "pub.hosted_event", "pub.accommodation", "pub.person", "pub.story"].map(dump))).join("\n");
  guestText = await dump("pub.guest_item");
  secrets = ["Byvägen", "070-123", "Industrigatan", "Vretavägen", "hemlig@exempel.se", "Hemlig Gäst", "Pall A", "Hylla 3", "Inplantering", "Hyllorna vänster vägg", "1200", "3100", "800", "Karin", "Torsten", "Lena", "Sara", "Swish", "Sparvhök"];
});

describe("publika projektioner", () => {
  test("VRETA Live innehåller det som är publikt", async () => {
    const live = await s.h.q(null, "q_live", { site: s.ids.site });
    expect(live.stories.length).toBe(1);
    expect(live.people.map((p: any) => p.name)).toEqual(["Johan Ek"]);
    expect(live.stay[0].name).toBe("Bo i Orangeriet");
    expect(live.wanted.length).toBe(1);
  });

  test("inga privata uppgifter, personer utan samtycke, lagerplatser, priser eller vistelser läcker", () => {
    for (const secret of secrets) expect(pubText.includes(secret), `"${secret}" i publik projektion`).toBe(false);
    expect(pubText).not.toMatch(/stay|checked_in|requester/);
  });

  test("gästvyn visar människor bara med samtycke och aldrig priser, adresser eller lagerplatser (INV-14)", () => {
    for (const secret of ["Byvägen", "070-123", "Industrigatan", "Vretavägen", "hemlig@exempel.se", "Hemlig Gäst", "Pall A", "Hylla 3", "Hyllorna", "Karin Söder", "Torsten", "Lena Berg", "Sara Nyman", "Swish", "1200", "3100", "\"price\""]) {
      expect(guestText.includes(secret), `"${secret}" i gästvyn`).toBe(false);
    }
    expect(guestText).toContain("Anders Lind");
    expect(guestText).toContain("Johan Ek");
  });

  test("namn utan samtycke byts mot \"någon\" i systemets egna texter", async () => {
    const rows = await s.h.sql("select pub.redact_names($1, 'Tegel från Lena Berg och Anders Lind') as t", [s.ids.site]);
    expect(rows[0].t).toBe("Tegel från någon och Anders Lind");
  });

  test("en känslig art visas aldrig med exakt position", async () => {
    const f = await s.h.sql("select count(*)::int n from rm.map_feature where layer_code = 'observations' and label ilike '%sparvhök%' and extensions.st_equals(geom, extensions.st_setsrid(extensions.st_makepoint(17.5851, 59.8421), 4326))");
    expect(f[0].n).toBe(0);
  });

  test("en rundvandring publiceras bara med grönt läckagetest", async () => {
    const { h, owner, ids } = s;
    const t = await h.sql("insert into place.tour (site_id, title, status) values ($1, 'Vreta på 30 minuter', 'published') returning id", [ids.site]);
    await h.sql("insert into place.tour_stop (site_id, tour_id, ordinal, entity_id, title, what_happened) values ($1, $2, 1, $3, 'Orangeriet', 'Lena Berg gav teglet')", [ids.site, t[0].id, ids.orangeriet]);
    await h.ok(owner, "UpdateFields", { id: ids.orangeriet, fields: { description: "Uppdaterad" } });
    await h.jobs(owner);
    expect((await h.sql("select count(*)::int n from pub.tour"))[0].n).toBe(0);
    await h.sql("update place.tour set leakage_test_passed_at = now() where id = $1", [t[0].id]);
    await h.ok(owner, "UpdateFields", { id: ids.orangeriet, fields: { description: "Igen" } });
    await h.jobs(owner);
    const tour = await h.q(null, "q_public_tour", { id: t[0].id });
    expect(tour.stops[0].what_happened).toBe("någon gav teglet");
  });

  test("Bidra kräver att Live är påslaget och begränsar mängden inskick", async () => {
    await s.h.ok(s.owner, "SetFeatureFlag", { flag: "live", enabled: false });
    await expect(s.h.api(null, "submit_contribution", { site: s.ids.site, message: "Hej" })).rejects.toThrow(/inte öppet/);
  });
});
