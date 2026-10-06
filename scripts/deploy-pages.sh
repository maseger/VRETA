#!/usr/bin/env bash
# Bygger appen och publicerar den på GitHub Pages (grenen gh-pages).
# Kräver VITE_SUPABASE_URL och VITE_SUPABASE_ANON_KEY (den publika nyckeln) i miljön.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VITE_SUPABASE_URL:?saknas}" "${VITE_SUPABASE_ANON_KEY:?saknas}"
export VITE_BASE="${VITE_BASE:-/VRETA/}"

npm run build
cp dist/index.html dist/404.html   # djuplänkar (t.ex. /lager/…) laddar appen i stället för GitHubs 404
touch dist/.nojekyll

OUT=$(mktemp -d)
cp -r dist/. "$OUT"
cd "$OUT"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name)" -c user.email="$(git -C "$OLDPWD" config user.email)" \
  commit -q -m "Publicera VRETA $(git -C "$OLDPWD" rev-parse --short HEAD)"
git push -f "$(git -C "$OLDPWD" remote get-url origin)" gh-pages
echo "Publicerad: https://$(git -C "$OLDPWD" remote get-url origin | sed -E 's#.*github.com/([^/]+)/.*#\1#').github.io${VITE_BASE}"
