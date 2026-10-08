# VRETA 2

VRETA 2 är byggd från noll enligt **VRETA Regenerative Initiative – Designdokument 2.0**, med lärdomarna från prototypen (repots rot). Prototypen finns kvar och kan köras parallellt tills R2.0 är godkänd; ingen data förs över.

Den här koden är release **R2.0 – Fundament och kärna**:

- **F1 Plattform**: hela målschemat (migrering 001–013, 173 tabeller i tolv scheman), Domain API med kommandokatalog, behörighet med radnivåsäkerhet på varje tabell, offline-kommandojournal och *Synk att lösa*, read models och publika projektioner, MCP-server, CI med migreringar, RLS-tester och röktest.
- **F2 Kärna**: allt prototypen kunde, byggt på nytt ovanpå F1 – Fånga och Granska med evidens, saker och partier, anskaffning, hämtning med checklistor och röstläge, lager med QR, nytt liv, annonsstudio, människor med relationer och samtycke, Berätta med integritetsfilter, Vretakartan offline med kartunderlag, Fråga Vreta med röstläge och förhandsgranskade åtgärder, projekt och behov, platser utanför Vreta, gästlänkar och gästvy.

## Prova direkt (demoläge)

```bash
cd vreta2
npm ci
npm run dev          # http://localhost:5173
```

Utan Supabase-nycklar körs **hela VRETA i webbläsaren**: samma migreringar och samma Domain API i PGlite (Postgres med PostGIS och pgvector som WebAssembly), sparat i webbläsarens IndexedDB. Första starten bygger databasen och lägger in exempelplatsen Vreta via Domain API (ca 20 s); därefter startar appen direkt och fungerar offline.

- Byt roll uppe till höger: **Ägare**, **Medhjälpare**, **Läsare** eller **Gäst (via gästlänk)** – behörigheten avgörs av databasen, precis som i drift.
- AI-funktionerna använder den lokala reserven (samma regler, ingen modell). Inget lämnar webbläsaren.
- *Inställningar → Börja om demon* lägger in exempeldatan på nytt.

## Driftsätta med Supabase

VRETA 2 är ett eget Supabase-projekt: **vreta2** (`xokxunmudyjpiavmruws`, eu-north-1), bredvid prototypens projekt. Migrering 001–013 är körda och registrerade i migreringshistoriken, och de sex serverfunktionerna är uppe (från commit `8845670`; nästa driftsättning från `main` ersätter dem med samma kod). Kvar att göra i Supabase-panelen: punkt 2 och 4 nedan.

För att köra appen mot projektet: lägg `VITE_SUPABASE_URL=https://xokxunmudyjpiavmruws.supabase.co` och `VITE_SUPABASE_ANON_KEY=<publishable key>` i `vreta2/.env.local` (filen checkas aldrig in) och kör `npm run dev`. Första inloggningen skapar platsen och gör dig till ägare.


1. **Skapa projektet** och notera projektreferensen, den publika nyckeln och databaslösenordet.
2. **Inställningar** (görs av `supabase config push` från `supabase/config.toml`, eller för hand):
   - *Settings → API → Exposed schemas*: `api` (appen pratar bara med Domain API).
   - *Authentication*: e-post (inloggningslänk) och **anonym inloggning** (används av gästlänkar).
3. **Databasen**: `supabase link --project-ref <ref>` och `supabase db push` (kör 001–013; storage-bucketen `media`, policyer och pg_cron-jobb skapas av migreringarna).
4. **AI-nyckeln**: `supabase secrets set ANTHROPIC_API_KEY=...` – nyckeln finns bara på servern.
5. **Serverfunktionerna**: `supabase functions deploy capture-agent story-agent marketplace-agent ask-vreta mcp weather`.
6. **Appen**: bygg med `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (den publika nyckeln) och vid behov `VITE_BASE` (t.ex. `/VRETA/v2/`), och lägg `dist/` på valfri statisk värd. VRETA 2 publiceras på **https://maseger.github.io/VRETA/v2/**: jobbet `publicera` i arbetsflödet byter ut mappen `v2/` på grenen `gh-pages` när `main` ändras. Prototypens `scripts/deploy-pages.sh` behåller `v2/`, och prototypens service worker svarar inte för den adressen.

**Automatiskt (AC-31):** arbetsflödet `.github/workflows/vreta2.yml` testar varje ändring och driftsätter databas och funktioner på `main` när hemligheterna `VRETA2_SUPABASE_ACCESS_TOKEN`, `VRETA2_PROJECT_REF`, `VRETA2_DB_PASSWORD` (och för röktestet `VRETA2_ANON_KEY`) finns. Utan hemligheter hoppas driftsättningen över.

**Väder (R2.1):** funktionen `weather` hämtar prognos och uppmätt väder från Open-Meteo för platser med flaggan `weather`. Anropa den varje timme med tjänstenyckeln (t.ex. pg_cron + pg_net eller ett schemalagt arbetsflöde).

**MCP:** `https://<ref>.supabase.co/functions/v1/mcp` (MCP över HTTP), med användarens inloggning som `Authorization: Bearer <token>` och flaggan `mcp` påslagen. Verktyg: läsa (idag, sök, var finns, behov, projekt, platser, bidrag, lager, period), annonser (paket per kanal, skriva tillbaka publicerad länk) och fånga. Allt sker med användarens behörighet; inget kan godkännas eller delas härifrån.

## Arkitektur

```
 App (React-PWA)  ──  Repo ──┬── Demo: PGlite i Web Worker (samma SQL)
   offline-journal           └── Supabase: rpc api.run_command / api.q_*  ── Edge Functions (Claude)
                                   │
 Postgres  ── api.run_command → cmd.* (tillstånd + HistoryEvent + AuditEntry i en transaktion)
           ── api.q_* (security invoker, RLS)   ── rm.* read models   ── pub.* projektioner (gäst/publikt)
```

- **Domain API.** Ingen klient skriver direkt i kärntabeller. Varje ändring är ett namngivet, versionerat kommando (`api.run_command`) med idempotensnyckel. Kommandokatalogen (126 kommandon) anger roller, offline-klass (`append`, `simple`, `invariant`, `sensitive`) och vilken release/flagga kommandot hör till. Avvisade kommandon sparas med orsak och ofta ett färdigt förslag ("det finns bara 60 kvar där") som visas under *Synk att lösa*.
- **Historik.** Varje kommando skriver en HistoryEvent som länkas till alla berörda poster och platsens hela kedja (rum → byggnad → område), så att samma händelse syns i sakens, platsens och projektets tidslinje (AC-05). AuditEntry skrivs av triggers.
- **Tillståndsmaskiner som data** (`core.state`, `core.state_transition`) för saker, partier, anskaffningar, hämtningar, annonser, intressenter, uppgifter, projekt och berättelser.
- **Behörighet.** RLS med standardnej; varje tabell registreras med en policyklass (`core.register_table`). Roller: ägare, medhjälpare, läsare, gäst och värd. Privata uppgifter (priser, adresser, kontaktlogg, original) ligger i separata privata tabeller.
- **Läsmodeller och projektioner.** `rm.*` (Idag, kartan, projektduken, relationer, årsbild) byggs om av jobbkön efter ändringar; `pub.*` är det enda gäster och anonyma når. Namn utan samtycke byts mot "någon", lagerplatser och priser följer aldrig med.
- **AI.** Capture Agent, Story Agent, Marketplace Agent och Fråga Vreta körs som Edge Functions med användarens egen inloggning. Modell: Claude Opus 5.5 (`claude-opus-5-5`) med strukturerade svar och **reservmodell vid avböjande** (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Kostnad loggas per funktion och månad, med ett tak per plats. Allt som AI föreslår är förslag tills en människa godkänt det; Fråga Vretas åtgärder visas i en förhandsgranskning. När servern inte svarar (eller i demoläget) används en **lokal reserv** med samma regler.
- **Integritet.** *Privacy Guard* är deterministisk kod: den bygger den rensade kontext som Claude får, kontrollerar utkasten efteråt (namn utan samtycke, adresser, telefon, mejl, priser, lagerplatser, givares hemorter) och databasen gör en sista kontroll när en berättelse godkänns. Bilder som delas är omkodade utan platsdata.
- **Feature flags per plats** styr när senare releasers gränssnitt slås på; schemat finns alltid.

## Grafisk profil

Appen följer Vretas grafiska profil (brand book, oktober 2026):
- **Färger:** skogsgrön för rubriker och navigering, rost för primära knappar, bark för brödtext och kalk som grund. Solros, mossa, våtmarksblå, trä och ockra används bara som dekor. Färgerna finns i `tailwind.config.ts`; de äldre namnen (kalk, sot, falu …) pekar på profilens färger.
- **Typsnitt:** Sora för allt funktionellt, Fraunces kursiv bara för citat (`.quote`) och Caveat bara för korta handskrivna avslutningar (`.signoff`).
- **Former:** pill-formade knappar och chips, kort med 8 px radie, 1 px dimgrå ram och grönaktig skugga, samt en 2 px skogsgrön fokusram.
- **Logotyp:** `src/ui/brand.tsx` ritar bladmärket som vektor, eftersom profilens logofiler är lågupplösta platshållare. Byt mot originalfilerna när de finns.
- **Bilder:** inloggningssidan använder trädgårdsbilden och ängsblommorna ur profilen (`src/assets/brand/`).

## Kodstruktur

```
vreta2/
  supabase/
    migrations/001–013     målschemat, Domain API, read models, projektioner, härdning
    shim/                  det PGlite behöver för att likna Supabase (roller, auth)
    functions/
      _shared/             ren TypeScript som både appen och servern använder:
                           Privacy Guard, fångsttolkning, mallar, annonspaket, Fråga Vreta utan AI
      _server/             Domain API-anrop med användarens inloggning, Claude, svarsformat
      capture-agent/ story-agent/ marketplace-agent/ ask-vreta/ mcp/ weather/
  src/
    app/      appskal, kontext (roller, flaggor, kodlistor), rutter, format
    data/     Repo: PGlite (demo) och Supabase med offlinejournal och mediacache
    pages/    alla sidor
    services/ tal, delning, QR, GPS, bilder (utan platsdata), AI med lokal reserv, ZIP-export
    ui/       designsystemet, Vretakartan (MapLibre), fält med diktering, tidslinje
  tests/
    unit/ db/ functions/
```

## Tester

```bash
npm test            # 160 tester: enhet, databas (PGlite) och serverfunktioner
npx tsc -b          # typkontroll av app, tester och serverfunktioner
VRETA_PG_URL=postgres://postgres:lösen@127.0.0.1:5432/postgres npx vitest run tests/db tests/functions
                    # samma databas- och funktionstester mot en riktig Postgres med PostGIS och pgvector
```

- **RLS för varje tabell och roll** – även tabeller som saknar gränssnitt än (en tom tabell är också en läcka om policyn är fel).
- **Kommandon och tillståndsmaskiner**, idempotens och offlinesynk (två telefoner flyttar samma tegel).
- **Läckagetester** för publika projektioner och gästvyn; 60 genererade läckagefall för Privacy Guard.
- **Alla frågor för alla roller** utan behörighetsfel.
- **Serverfunktionerna** körs mot databasen via en låtsas-Supabase och en låtsas-Claude som sparar varje förfrågan – testerna kontrollerar att inget privat skickas till modellen och att AI-utkast med förbjudet innehåll ersätts.
- CI kör allt mot både PGlite och Postgres 16.

## Acceptanskriterier (AC-01–AC-31 i spec R1.1)

| AC | Hur det prövas |
|---|---|
| 01, 02 | Fånga → Granska (godkännandet testat; offlinekö och väntande bilder i Supabase-läget). Tid, kamera och flygplansläge: fälttest |
| 03, 04, 05, 06, 08, 09, 10, 13, 14, 15, 17, 20, 22, 23, 25, 26, 27, 28, 29 | Automatiska databastester |
| 07 | Annonsstudion: paket per kanal med rensade bilder (testat i funktionstesterna); tiden: fälttest |
| 11 | 71 enhetstester för Privacy Guard + efterkontrollen av AI-utkast |
| 12, 30 | Delning kopierar texten innan delningsmenyn öppnas och säger att den ska klistras in: fälttest på telefon |
| 16 | Export som ZIP med alla tabeller och originalbilder (prövat i webbläsaren) |
| 18 | MCP: annonspaket och tillbakaskriven länk (funktionstest); publiceringen görs av Claude i Chrome efter bekräftelse |
| 19 | **Inte byggt** (bevakningsmejl, P1) |
| 21, 24 | Röstläge i hämtningens checklista och Navigera till adressen: fälttest |
| 31 | CI driftsätter på `main` när Supabase-hemligheterna finns |

Klartkriteriet för R2.0 – att kriterierna går igenom på en riktig telefon ute på Vreta – återstår (se `docs/falttest.md` i roten).

## Avvikelser och tillägg mot designdokumentet

- **Specifikation R2** fanns inte med; kraven kommer från `docs/spec-r1.1.md` (AC-01–AC-31, tillståndsmaskiner, FR/NFR/INV) och designdokumentet.
- **Demoläget** (hela appen i webbläsaren med PGlite) är ett tillägg. Det gör att samma migreringar körs i tester, i demot och i drift.
- **Tal** använder webbläsarens taligenkänning och talsyntes på svenska; en egen taltjänst (ADR-003) är inte vald.
- **Vretakartan** ritas på "papper" utan extern karttjänst och fungerar offline. Kartunderlag läses in antingen som **kartpaket** från `scripts/prepare-basemap.py` + `scripts/kartpaket.py` (georefererade från originalfilerna) eller som bild som placeras med tre stödpunkter. Bakgrundskarta från OpenStreetMap kan slås på.
- **Senare releaser** (R2.1–R3) har schema, kommandon, RLS och tester men inget fullt gränssnitt än; knappar för t.ex. *Ögonblick* (flaggan `canvas`, R2.4) visas först när flaggan slås på. Väderfunktionen finns och Idag visar väder när flaggan `weather` är på.
- **Bevakningsmejl** (AC-19) är inte byggt.

## Öppna frågor

1. ~~Vilket Supabase-projekt?~~ **vreta2** är skapat. Hemligheterna ovan behövs i GitHub för automatisk driftsättning.
2. ~~Var ska appen publiceras?~~ GitHub Pages under `/VRETA/v2/`, bredvid prototypen.
3. Finns Specifikation R2? Den bör stämmas av mot det som byggts.
4. Taltjänst för svenska med VRETA:s ordlista (ADR-003) – webbläsarens räcker för fälttestet?
5. Kartunderlagen: originalfilerna behöver köras genom kartverktygen och läsas in som kartpaket i VRETA 2.
