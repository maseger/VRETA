# VRETA

Digitalt operativsystem för återbruk, regenerativ platsutveckling och berättande – med Vreta / Villa Solgläntan som första plats.

VRETA följer resurser från fynd till nytt liv eller ny ägare, håller ihop människorna som bidrar (leverantörer, givare, medskapare, köpare) och gör varje händelse till en berättelse som kan delas.

## Specifikation

Gällande specifikation är [**VRETA – Specifikation R1**](docs/spec-r1.md), exporterad från Claude Docs. Den ersätter systemspecifikationerna V1 och V2.0.

Kärnflöde i R1: fånga → anskaffning → hämtning → lager → nytt liv → utflöde, med CRM och Berätta längs hela vägen. Därtill Vretakartan (egen fastighetskarta), talstöd och chatboten Fråga Vreta.

## Rekommenderad stack (ADR-001)

- React + TypeScript + Vite som PWA
- Supabase: Postgres med PostGIS och pgvector, Auth med Row Level Security, Storage, Edge Functions
- Vretakartan: MapLibre GL med egna kartplattor från kommunens baskarta; Google Maps endast för adresser och navigering
- AI: Claude via Anthropic API; separat taltjänst för svenska
- GDAL för kartimport (installeras automatiskt i Claude Code-molnsessioner via `.claude/hooks/session-start.sh`)

## Integritet

Kartunderlag, bilder och personuppgifter visar fastighetens läge och berör privatpersoner. De checkas aldrig in i repot (se `.gitignore`) utan lagras i applikationens privata lagring.

## Kom igång (milstolpe M1)

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # enhetstester (vitest)
npm run build      # typkontroll + produktionsbygge (PWA)
scripts/test-db.sh # migrationer + RLS mot en tillfällig PostgreSQL (kräver postgresql)
```

**Demoläge:** utan `VITE_SUPABASE_URL` körs appen helt i webbläsaren (IndexedDB) med påhittade exempeldata. Fångster tolkas då med en enkel regelbaserad tolkning och berättelser skrivs från mallar. Under Inställningar kan du byta roll (ägare, medhjälpare, läsare).

**Med Supabase:**

1. Skapa ett Supabase-projekt och kör migrationerna i `supabase/migrations/` (`supabase db push`).
2. Lägg Claude-nyckeln som hemlighet: `supabase secrets set ANTHROPIC_API_KEY=...`
3. Driftsätt funktionerna: `supabase functions deploy capture-agent story-agent marketplace-agent ask-vreta`
4. Kopiera `.env.example` till `.env.local` och fyll i projektets URL och anon-nyckel.
5. Logga in med e-postlänk – första inloggningen skapar platsen och gör dig till ägare.

## Vad M1 innehåller

| Del | Var |
| --- | --- |
| Datamodell, tillståndsmaskin, audit, händelser, RLS | `supabase/migrations/20261005123925_m1_grund.sql` |
| Capture Agent och Story Agent (Claude, strukturerade svar, server-side fallback) | `supabase/functions/` |
| Privacy Guard (deterministisk) och reservtolkning | `supabase/functions/_shared/` |
| Datalager: Supabase + lokalt (IndexedDB) med samma regler | `src/data/` |
| Global +, kamera, diktering, offline-kö | `src/pages/CapturePage.tsx` |
| Att granska – fältvis godkänn/ändra/ta bort | `src/pages/ProposalPage.tsx` |
| Objektsida med resa, fakta, människor, ekonomi och nästa steg | `src/pages/ObjectPage.tsx` |
| Berätta-studio med granskning och delningsmeny | `src/pages/StoryStudioPage.tsx` |
| EXIF/GPS-rensning av alla bilder som kan delas | `src/services/images.ts` |

Formspråket hämtar färger från byggnadsvårdens material – kalkputs, linoljefärg, Falu rödfärg, ockra, järnvitriol och mossa – med Fraunces för rubriker och Source Sans 3 för text.

## Vad M2 innehåller (inflöde och lager)

| Del | Var |
| --- | --- |
| Organisationer, kontakthistorik (privat), anskaffningsflöde, hämtningar, checklistor, lagerplatser, RLS | `supabase/migrations/20261005124018_m2_infloede_lager.sql` |
| Avsluta hämtning i en transaktion: kvittering, status, händelse, lagerplats, anskaffning (AC-03) | `complete_pickup` i migrationen |
| Offline-kö för fångst, bilder, checklistor och avslut + läscache för hämtningar (AC-02) | `src/data/outbox.ts`, `src/data/offlineSupabaseRepo.ts` |
| Saker: Objekt · Inköp (pipeline) · Hämtningar · Annonser | `src/pages/saker/` |
| Personkort med roller, samtycke, privata uppgifter, kontakthistorik och diktering (AC-09) | `src/pages/PersonPage.tsx` |
| Planera hämtning och hämtning på plats med navigering, checklista, foton och kvittering | `src/pages/NewPickupPage.tsx`, `src/pages/PickupPage.tsx` |
| Lagerträd, lagerplats med QR-kod och utskrivbara etiketter | `src/pages/StoragePage.tsx`, `StorageLocationPage.tsx`, `LabelsPage.tsx` |

QR-koderna innehåller en länk till lagerplatsen, så telefonens vanliga kamera öppnar rätt hylla direkt i appen.

## Vad M3 innehåller (nytt liv och journal)

| Del | Var |
| --- | --- |
| Partier med fördelning (INV-11 kontrolleras vid commit), nytt liv, demontering, observationer, beslut, kartlager, PostGIS | `supabase/migrations/20261005124129_m3_nytt_liv_journal.sql` |
| `record_usage` och `store_allocation`: nytt liv för hela objekt eller delar av partier, en händelse i objekt-, zon- och platsjournal (AC-04, AC-05, AC-06) | migrationen |
| Vretakartan (Platser → På Vreta): egna grundbilder och överlägg, zoner och byggnader, nålar för nytt liv och observationer, "Här" med GPS, rita och flytta hörn, area – helt offline | `src/geo/VretaMap.tsx`, `src/pages/platser/OnSitePlaces.tsx` |
| Lägg till kartlager med hörnfil eller tre stödpunkter | `src/pages/MapLayerPage.tsx`, `src/geo/geo.ts` |
| Nytt liv-formulär, partiets fördelning och demontering på objektsidan | `src/ui/UsageForm.tsx`, `src/pages/ObjectPage.tsx` |
| Platsjournal med filter, zonsida, observationer och beslut | `src/pages/JournalPage.tsx`, `src/pages/ZonePage.tsx`, `src/ui/JournalForms.tsx` |

### Lägga in fastighetens baskarta

Kartfilerna visar fastighetens läge och ska aldrig ligga i repot.

```bash
python3.12 scripts/prepare-basemap.py baskarta.pdf ut/    # GeoPDF eller GeoTIFF → ut/baskarta.png + ut/baskarta.json
```

Ladda sedan upp båda filerna under **Platser → Lager → Lägg till kartlager → Jag har en hörnfil**. Skriptet läser kartans inbäddade georeferens (t.ex. SWEREF 99 18 00), räknar om till Web Mercator och klipper vid kartramen. Ritningar utan georeferens placeras i appen med tre stödpunkter mot grundbilden.

Databastesterna kräver PostGIS: `apt-get install postgresql-16-postgis-3`.

## Vad M4 innehåller (utflöde och CRM)

| Del | Var |
| --- | --- |
| Annonser, kanalposter, intressenter, utflöde (privat pris), bidrag, ömsesidighet, samtycke per inlägg, RLS | `supabase/migrations/20261005124246_m4_utflode_crm.sql` |
| `publish_channel` delar av partiet, `agree_lead` / `release_lead` reserverar och släpper, `complete_disposal` sätter status, köpare, pris, händelse och nedtagningspåminnelser i en transaktion (AC-08) | migrationen |
| Kanaladaptrar (Blocket, Facebook Marketplace, Facebookgrupp, Tiptapp) – gränserna är konfiguration och ska verifieras (Q-03) | `supabase/functions/_shared/channels.ts` |
| Annonspaket, integritetsfilter för annonser, prisförslag och svarsutkast | `supabase/functions/_shared/listingPackage.ts` |
| Marketplace Agent (Claude): skriver paket per kanal; inköpspriset skickas aldrig, och texten kontrolleras igen innan den lämnas ut | `supabase/functions/marketplace-agent/` |
| Annonsstudion: gemensamma fält, bildval, flik per kanal, dela/kopiera, instruktion till Claude i Chrome, klistra in länk, intressentkö, avslut (AC-07) | `src/pages/ListingStudioPage.tsx`, `src/pages/listing/LeadQueue.tsx` |
| Bidrag, ömsesidighet och tack med samtycke per inlägg (AC-10) | `src/pages/PersonPage.tsx`, `src/pages/ThanksPage.tsx` |
| Idag: intressenter som väntar på svar och personer att tacka | `src/pages/TodayPage.tsx` |
| Integritetssvit med 338 genererade fall för Berätta och annonser (AC-11) | `src/test/privacy.test.ts` |

**Webbläsaragenten:** knappen *Låt agent publicera* kopierar en instruktion och sparar bilderna. Klistra in den i Claude i Chrome, som fyller i kanalens formulär i din inloggade webbläsare. Inloggning, betalning och sista publiceringsklicket gör du alltid själv (INV-04). Klistra sedan in annonslänken i studion. En MCP-server med `get_listing_package` och `mark_channel_posted` (9.4) är nästa steg.

**Tack** skrivs från mallar i båda lägena, med samma integritetsfilter. Story Agent på servern får nu också bidrag och samtycke per inlägg, och dess text kontrolleras på samma sätt.

## Saker · Människor · Platser

Navigeringen följer vad saker är: **Saker** hanteras, **Människor** hanterar dem och har relationer, **Platser** är där det sker.

| Del | Var |
| --- | --- |
| Nedre fältet: Idag · Saker · + · Människor · Platser (Fråga via den runda knappen); fliken är markerad även på detaljsidorna | `src/ui/AppShell.tsx` |
| Saker: objekt, inköp, hämtningar, annonser | `src/pages/SakerPage.tsx`, `src/pages/saker/` |
| Människor: personer med roller, samtycke, bidrag (nu med projekt) | `src/pages/ManniskorPage.tsx`, `src/pages/manniskor/` |
| Platser på Vreta: karta, zoner och byggnader samt förvaring, projekt och observationer | `src/pages/PlatserPage.tsx`, `src/pages/platser/OnSitePlaces.tsx` |
| Projekt: nytt liv och bidrag samlade per projektnamn | `src/pages/ProjectsPage.tsx`, `src/domain/places.ts` |
| Platser utanför Vreta: orterna där saker hämtas, köps och lämnas | `src/pages/platser/ExternalPlaces.tsx` |

Gamla adresser (`/samla`, `/vreta`) skickas vidare till de nya.

### M6: projekt och platser utanför Vreta

| Del | Var |
| --- | --- |
| Tabellerna `projects`, `external_places` (+ privat adress), `project_id` på nytt liv och bidrag, `place_id` på inköp, hämtningar och avslut, RLS | `supabase/migrations/20261006071304_m6_projekt_platser.sql` |
| Projektnamn i fritext blir projekt (`resolve_project`); händelsen länkas till projektet; befintliga namn migreras | migrationen |
| Projektlista och projektsida med status, saker, människor och projektjournal | `src/pages/ProjectsPage.tsx`, `src/pages/ProjectPage.tsx` |
| Platser utanför Vreta: lista, ny plats, platssida med vad som kom in, lämnades och hämtades | `src/pages/platser/ExternalPlaces.tsx`, `src/pages/ExternalPlacePage.tsx` |
| Fliken Platser på objektsidan; plats på ny hämtning; projektförslag i formulären | `src/pages/ObjectPage.tsx`, `src/ui/ExternalPlaceSelect.tsx`, `src/ui/ProjectInput.tsx` |
| Databastester | `supabase/tests/m6_rls_test.sql` |

### M7: behov, projektytor och Fråga Vreta om projekt och platser

| Del | Var |
| --- | --- |
| `needs` och `need_fulfillments` med RLS; uppfyllelse blir händelse i projektjournalen; `need_fulfilled()`; projektyta (`projects.geom` + PostGIS) | `supabase/migrations/20261006071324_m7_behov_projektytor.sql` |
| Behov på projektsidan: förlopp, fyll på (med förslag från lagret), efterlys, stryk | `src/ui/ProjectNeeds.tsx`, `src/domain/places.ts` |
| Efterlysning från ett behov kopplas tillbaka till behovet | `src/pages/NewListingPage.tsx` (`?behov=`) |
| Projektytor på Vretakartan: rita, flytta hörn, visa från projektsidan | `src/pages/platser/OnSitePlaces.tsx` (`?rita=` / `?visa=`) |
| Fråga Vreta: `projects`, `project_overview`, `open_needs`, `place_overview`, och sökning i projekt och platser | `supabase/functions/_shared/knowledge.ts` |
| Databastester | `supabase/tests/m7_rls_test.sql` |

### M8: relationer mellan människor

| Del | Var |
| --- | --- |
| `person_relations` (symmetriska relationer + riktad "tipsade oss om"), unik oavsett håll, RLS: bara ägare och medhjälpare | `supabase/migrations/20261006071338_m8_relationer.sql` |
| Nätverk på personkortet: organisation, relationer, "kom till oss via" | `src/ui/PersonNetwork.tsx` |
| Organisationer under Människor och en organisationssida med medlemmar och saker | `src/pages/manniskor/OrganizationsList.tsx`, `src/pages/OrganizationPage.tsx` |
| Fråga Vreta: `person_network` | `supabase/functions/_shared/knowledge.ts` |
| Databastester | `supabase/tests/m8_rls_test.sql` |

### Lägga till platser

*Ny plats* under Platser (`/platser/ny`, `src/pages/NewPlacePage.tsx`): område, byggnad eller anläggning, lagerplats eller plats utanför Vreta. Områden och byggnader kan ritas in på Vretakartan direkt (`/platser?rita=zone:<id>`) eller senare via *Rita in*.

Platstyperna för områden och byggnader är en katalog för en regenerativ återbruksfastighet (hushåll, skogsträdgård, plantering, kompost, damm, svackdike, parkering, materialgård, hönshus, regnvattentank …) med förklaring och permakulturzon 0–5; egna typer går också att skriva: `src/domain/placeTypes.ts`, `src/ui/PlaceTypeSelect.tsx`.

### M9: gäster utan konto

| Del | Var |
| --- | --- |
| Gästlänkar (bara hash sparas), `redeem_guest_link` med anonym inloggning, `revoke_guest_link`, `is_guest()`; gäster ser bara människor, bidrag och händelser med samtycke och inga hämtningar, uppgifter eller citat | `supabase/migrations/20261006071952_m9_gaster.sql` |
| Gästlänkar under Inställningar: skapa, skicka, se användning, stäng | `src/ui/GuestLinks.tsx` |
| `/gast/<nyckel>` och gästens startsida; Fråga, Fånga och inköp/hämtningar döljs | `src/pages/GuestEntryPage.tsx`, `src/pages/GuestHomePage.tsx`, `src/ui/AppShell.tsx` |
| Fråga Vreta nekar gäster på servern | `supabase/functions/ask-vreta/` |
| Databastester | `supabase/tests/m9_rls_test.sql` |

**Med Supabase:** slå på anonym inloggning (Authentication → Sign In / Providers → Allow anonymous sign-ins), kör `supabase db push` och driftsätt `ask-vreta`.

### Fånga känner igen plats, projekt och tipsare

| Del | Var |
| --- | --- |
| Lokal tolkning: "på Återbruket", "till orangeriet", "Anders tipsade" / "tips från" / "via" | `supabase/functions/_shared/captureHeuristics.ts` |
| Capture Agent: fälten `place`, `project`, `introduced_by`; får namnen på kända projekt och platser | `supabase/functions/_shared/agentSchemas.ts`, `agents.ts`, `capture-agent/` |
| Matchning mot platser, projekt, behov och personer, och kopplingarna vid godkännande | `src/services/proposalLinks.ts` |
| Kopplingar under Att granska | `src/ui/ProposalLinksCard.tsx`, `src/pages/ProposalPage.tsx` |

Med Supabase: kör `supabase db push` för att lägga in migrationerna och driftsätt `ask-vreta` och `capture-agent` igen (`supabase functions deploy ask-vreta capture-agent`).

## Vad M5 innehåller (kunskap och härdning)

| Del | Var |
| --- | --- |
| Kunskapsverktygen: hitta, lager per person, bidrag och tack, intressenter, idag, längst i lager, köpt och sålt, zoner, perioder, fritext – och åtgärder som bara föreslås | `supabase/functions/_shared/knowledge.ts` |
| Fråga Vreta med Claude och verktyg; verktygen läser med användarens inloggning så att radnivåsäkerheten filtrerar innan något når modellen | `supabase/functions/ask-vreta/`, `_shared/knowledgeStore.ts` |
| Chatten: källkort, "Allmänt råd" skilt från fakta om Vreta, bekräftelse av åtgärder, privata trådar, vet vilken skärm du kom från (AC-13, AC-14, AC-25) | `src/pages/AskPage.tsx`, `src/services/askVreta.ts` |
| Röstläge med uppläsning och "ja/nej/stopp"; röstkommandon som "Lägg tegelpartiet på pall A" flyttar först efter "ja" (AC-22) | `src/services/speech.ts`, `src/pages/AskPage.tsx` |
| Handsfree-checklista vid hämtning (AC-21) | `src/ui/HandsfreeChecklist.tsx` |
| Idag prioriterar: granska, hämtningar, försenat, intressenter, uppföljning, att tacka, legat i lager över ett år | `src/pages/TodayPage.tsx` |
| Export som ZIP: alla tabeller som JSON och CSV, originalbilder och kartor (AC-16) | `src/services/exportArchive.ts` |
| Egen backup och återställningstest (NFR-008) | `scripts/backup.sh`, `scripts/restore-test.sh`, `RESTORE_TEST=1 scripts/test-db.sh` |
| Fulltextsök på svenska, index, privata trådar, AI-förbrukning per funktion med månadstak (NFR-014) | `supabase/migrations/20261005124317_m5_kunskap_hardning.sql` |
| Tillgänglighet: hoppa-till-innehåll-länk, aria-live, etiketter; axe (WCAG 2.2 AA) utan anmärkningar på kärnflödena | `src/ui/AppShell.tsx` m.fl. |
| Prestanda: alla sidor utom Idag laddas vid behov; startpaketet gick från 725 kB till 168 kB | `src/App.tsx`, `vite.config.ts` |
| Fälttestprotokoll för en vecka | `docs/falttest.md` |

**Röst:** uppläsning och taligenkänning använder webbläsarens inbyggda tjänster (svenska). En egen taltjänst med VRETA:s ordlista (FR-064, NFR-016) är nästa steg och kräver ett val av leverantör (ADR-003).

**Månadstak för AI:** `update sites set ai_monthly_token_cap = 2000000;` – när taket är nått svarar Fråga Vreta med den lokala tolkningen i stället.

