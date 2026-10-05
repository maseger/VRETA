#!/bin/bash
# Egen säkerhetskopia av VRETA (NFR-008), utöver Supabase dagliga backup.
#   SUPABASE_DB_URL=postgresql://... scripts/backup.sh [målmapp]
# Skapar <målmapp>/<datum>/ med databasdump (pg_dump, eget format), radantal per tabell
# och – om Supabase CLI finns och är inloggad – originalbilder och kartor från lagringen.
# Kopiorna innehåller privata uppgifter och kartor: lägg dem aldrig i git (backups/ är ignorerad).
set -euo pipefail
: "${SUPABASE_DB_URL:?Sätt SUPABASE_DB_URL (Project Settings → Database → Connection string)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/backups}/$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DEST"
chmod 700 "$DEST"

echo "Databas → $DEST/vreta.dump"
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-acl --schema=public --file "$DEST/vreta.dump"

echo "Radantal → $DEST/counts.txt"
psql "$SUPABASE_DB_URL" -At -c "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1" |
  while read -r t; do echo "$t $(psql "$SUPABASE_DB_URL" -At -c "select count(*) from public.\"$t\"")"; done > "$DEST/counts.txt"

if command -v supabase >/dev/null 2>&1 && [ "${SKIP_STORAGE:-}" != "1" ]; then
  for bucket in media-original media-clean maps; do
    echo "Lagring: $bucket"
    supabase storage cp -r "ss:///$bucket" "$DEST/storage/$bucket" --experimental || echo "  (kunde inte kopiera $bucket – kör 'supabase login' och 'supabase link')"
  done
else
  echo "Hoppar över lagringen (Supabase CLI saknas eller SKIP_STORAGE=1)."
fi
echo "Klart: $DEST"
