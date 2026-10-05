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
