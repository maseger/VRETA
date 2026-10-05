# VRETA

Digitalt operativsystem för återbruk, regenerativ platsutveckling och berättande – med Vreta / Villa Solgläntan som första plats.

VRETA följer resurser från fynd till nytt liv eller ny ägare, håller ihop människorna som bidrar (leverantörer, givare, medskapare, köpare) och gör varje händelse till en berättelse som kan delas.

## Specifikation

Gällande specifikation är **VRETA – Specifikation R1** (Claude Docs, privat). Den ersätter systemspecifikationerna V1 och V2.0.

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
3. Driftsätt funktionerna: `supabase functions deploy capture-agent story-agent`
4. Kopiera `.env.example` till `.env.local` och fyll i projektets URL och anon-nyckel.
5. Logga in med e-postlänk – första inloggningen skapar platsen och gör dig till ägare.

## Vad M1 innehåller

| Del | Var |
| --- | --- |
| Datamodell, tillståndsmaskin, audit, händelser, RLS | `supabase/migrations/20261005000000_m1_grund.sql` |
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
| Organisationer, kontakthistorik (privat), anskaffningsflöde, hämtningar, checklistor, lagerplatser, RLS | `supabase/migrations/20261006000000_m2_infloede_lager.sql` |
| Avsluta hämtning i en transaktion: kvittering, status, händelse, lagerplats, anskaffning (AC-03) | `complete_pickup` i migrationen |
| Offline-kö för fångst, bilder, checklistor och avslut + läscache för hämtningar (AC-02) | `src/data/outbox.ts`, `src/data/offlineSupabaseRepo.ts` |
| Samla: Objekt · Människor · Inköp (pipeline) · Hämtningar | `src/pages/samla/` |
| Personkort med roller, samtycke, privata uppgifter, kontakthistorik och diktering (AC-09) | `src/pages/PersonPage.tsx` |
| Planera hämtning och hämtning på plats med navigering, checklista, foton och kvittering | `src/pages/NewPickupPage.tsx`, `src/pages/PickupPage.tsx` |
| Lagerträd, lagerplats med QR-kod och utskrivbara etiketter | `src/pages/StoragePage.tsx`, `StorageLocationPage.tsx`, `LabelsPage.tsx` |

QR-koderna innehåller en länk till lagerplatsen, så telefonens vanliga kamera öppnar rätt hylla direkt i appen.
