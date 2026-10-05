# Fälttest R1 – en vecka på Vreta

Specifikationen (15.2) kräver en vecka av verklig användning innan R1 räknas som klar. Det här är protokollet. Kör det med Supabase och Claude påslagna, på telefonen som installerad PWA.

## Före start

- [ ] Supabase-projektet har alla migrationer och de fyra edge-funktionerna (`capture-agent`, `story-agent`, `marketplace-agent`, `ask-vreta`).
- [ ] Grundbilden (baskartan) är inlagd och zonerna inritade på Vretakartan.
- [ ] Appen är installerad på hemskärmen, och kartan har öppnats en gång med nät så att den finns offline.
- [ ] En export är gjord (Inställningar → Data och backup) och `scripts/backup.sh` + `scripts/restore-test.sh` har körts en gång.
- [ ] Ett månadstak för AI är satt: `update sites set ai_monthly_token_cap = 2000000;`

## Varje dag

| Moment | Gör | Notera |
| --- | --- | --- |
| Fånga | Minst ett fynd med kamera och röst | Sekunder från + till sparad fångst, och till godkänt objekt |
| Fråga Vreta | Minst tre frågor, varav en med röstläget | Fick svaret källkort? Stämde det? |
| Lager och nytt liv | Flytta eller använd något, gärna med röstkommando | Hamnade nålen i rätt zon med "Här"? |
| Journal | En observation i en zon | – |
| Idag | Börja dagen i Idag | Saknades något, eller var något brus? |

## Under veckan

- [ ] En hämtning med checklistan uppläst och avbockad med rösten, utan att röra skärmen (AC-21).
- [ ] Navigera till en hämtning med Google Maps (AC-24).
- [ ] En hämtning i flygplansläge: fångst, foton och checklista sparas och synkas efteråt (AC-02).
- [ ] Vretakartan i flygplansläge med en plantering registrerad med "Här" (AC-23).
- [ ] En annons ute på Blocket eller Facebook Marketplace, en intressent i kön, affären avslutad (AC-07, AC-08).
- [ ] Ett tack till någon som bidragit, med samtycke (AC-10).
- [ ] Ett inlägg delat från mobilen med text och bilder (AC-12).
- [ ] En medhjälpare som registrerar ett fynd och frågar "Vad har jag i lager från …?" – inga priser eller anteckningar ska synas (AC-17, AC-25).

## Mätetal att läsa av efter veckan (15.3)

| Mätetal | Hur |
| --- | --- |
| Tid från fångst till godkänt objekt | Egna anteckningar ovan; mål median under 60 s |
| Andel objekt med känd plats | Samla → Objekt: andel med lagerplats eller zon; mål över 95 % |
| Delade berättelser | Inställningar → Händelselogg, filter "Inlägg delat" |
| Andel bidragsgivare som tackats | Fråga Vreta: "Vilka har jag inte tackat?" |
| Tid från "Lägg ut" till publicerad annons | Egen tidtagning; mål under 3 min |
| AI-svar med källa | Andel svar i Fråga Vreta med källkort; mål 100 % för frågor om Vreta |
| AI-kostnad | Inställningar → AI-förbrukning denna månad |

## Efteråt

Skriv ner fel, saker som tog för lång tid och frågor chatboten inte klarade. De blir underlag för R1+ och för ordlistan till taligenkänningen (NFR-016: minst 20 inspelningar från Vreta).
