#!/bin/bash
# Testar migrationerna och RLS mot en tillfällig lokal PostgreSQL (kräver postgresql installerat).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
DATA="$(mktemp -d)"
chown postgres "$DATA" 2>/dev/null || true
run() { if [ "$(id -u)" -eq 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$PGBIN/initdb -D $DATA -A trust -U postgres >/dev/null"
run "$PGBIN/pg_ctl -D $DATA -o '-p 55432 -k /tmp' -l $DATA/log start >/dev/null"
trap 'run "$PGBIN/pg_ctl -D $DATA stop -m fast >/dev/null"; rm -rf "$DATA"' EXIT
sleep 1
PSQL="psql -h /tmp -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database vreta_test"
$PSQL -d vreta_test -f "$ROOT/supabase/tests/supabase_stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do $PSQL -d vreta_test -f "$f"; done
$PSQL -d vreta_test -f "$ROOT/supabase/tests/m1_rls_test.sql"
