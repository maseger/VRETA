#!/bin/bash
# Återställningstest (NFR-008: "återställning testas kvartalsvis").
#   scripts/restore-test.sh backups/<datum>
# Läser in dumpen i en tillfällig lokal PostgreSQL med PostGIS och jämför radantalen
# med counts.txt från säkerhetskopian. Kräver postgresql och postgis lokalt.
set -euo pipefail
SRC="${1:?Ange mappen med vreta.dump och counts.txt}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
DATA="$(mktemp -d)"
chown postgres "$DATA" 2>/dev/null || true
chmod a+r "$SRC"/vreta.dump 2>/dev/null || true
run() { if [ "$(id -u)" -eq 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$PGBIN/initdb -D $DATA -A trust -U postgres >/dev/null"
run "$PGBIN/pg_ctl -D $DATA -o '-p 55433 -k /tmp' -l $DATA/log start >/dev/null"
trap 'run "$PGBIN/pg_ctl -D $DATA stop -m fast >/dev/null"; rm -rf "$DATA"' EXIT
sleep 1
PSQL="psql -h /tmp -p 55433 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database vreta_restore"
# Supabase-specifika scheman (auth, storage) finns inte lokalt – stubbar räcker för att läsa in public.
$PSQL -d vreta_restore -f "$ROOT/supabase/tests/supabase_stubs.sql" >/dev/null
$PSQL -d vreta_restore -c "drop schema public cascade; create schema public; create extension if not exists postgis schema public;" >/dev/null 2>&1 || true
pg_restore -h /tmp -p 55433 -U postgres -d vreta_restore --no-owner --no-acl --schema=public --exit-on-error "$SRC/vreta.dump" 2>&1 | grep -v "already exists" || true

fail=0
while read -r table expected; do
  got=$($PSQL -d vreta_restore -At -c "select count(*) from public.\"$table\"" 2>/dev/null || echo "saknas")
  if [ "$got" != "$expected" ]; then echo "FEL  $table: väntade $expected, fick $got"; fail=1; else echo "ok   $table $got"; fi
done < "$SRC/counts.txt"
[ $fail -eq 0 ] && echo "ÅTERSTÄLLNINGEN GODKÄND" || { echo "ÅTERSTÄLLNINGEN MISSLYCKADES"; exit 1; }
