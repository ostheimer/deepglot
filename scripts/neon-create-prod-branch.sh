#!/usr/bin/env bash
# Create Neon branch "prod" from "main" and print connection strings (Variant A: 2 branches).
# Requires: NEON_API_KEY (create at https://console.neon.tech → Account → API keys).
# Optional: NEON_PROJECT_ID (if unset, uses first project from "neon projects list").
set -e

if [ -z "${NEON_API_KEY}" ]; then
  echo "FEHLER: NEON_API_KEY ist nicht gesetzt." >&2
  echo "Erstelle einen API Key unter: https://console.neon.tech → Account → API keys" >&2
  echo "Dann: export NEON_API_KEY=neon_..." >&2
  exit 1
fi

export NEON_API_KEY

# Resolve project ID
if [ -z "${NEON_PROJECT_ID}" ]; then
  echo "Projekt-ID wird aus 'neon projects list' ermittelt..."
  RAW=$(npx -y neonctl projects list --output json 2>/dev/null) || true
  NEON_PROJECT_ID=$(echo "${RAW}" | node -e "
    let d; try { d = JSON.parse(require('fs').readFileSync(0, 'utf8')); } catch { process.exit(1); }
    const projects = d.projects || d;
    const list = Array.isArray(projects) ? projects : [projects];
    const id = list[0]?.id ?? list[0]?.project_id;
    if (!id) process.exit(1);
    console.log(id);
  " 2>/dev/null) || true
  if [ -z "${NEON_PROJECT_ID}" ]; then
    echo "FEHLER: Konnte Projekt-ID nicht ermitteln (ungültiger API-Key oder kein Projekt)." >&2
    echo "Setze NEON_PROJECT_ID manuell (z.B. aus der Neon-Console URL)." >&2
    exit 1
  fi
  echo "Verwende Projekt: ${NEON_PROJECT_ID}"
fi

# Check if prod already exists
BRANCHES_JSON=$(npx -y neonctl branches list --project-id "${NEON_PROJECT_ID}" --output json 2>/dev/null || echo "[]")
if echo "${BRANCHES_JSON}" | node -e "
  let d; try { d = JSON.parse(require('fs').readFileSync(0, 'utf8')); } catch { process.exit(0); }
  const list = d.branches ?? (Array.isArray(d) ? d : [d]);
  const hasProd = list.some(b => (b.name || '') === 'prod');
  process.exit(hasProd ? 0 : 1);
" 2>/dev/null; then
  echo "Branch 'prod' existiert bereits."
else
  echo "Erstelle Branch 'prod' von 'main'..."
  npx -y neonctl branches create --name prod --parent main --project-id "${NEON_PROJECT_ID}" --output json >/dev/null
  echo "Branch 'prod' wurde erstellt."
fi

echo ""
echo "--- Connection Strings für Vercel Production (nur dort eintragen) ---"
echo ""
echo "DATABASE_URL (pooled):"
npx -y neonctl connection-string prod --project-id "${NEON_PROJECT_ID}" --pooled
echo ""
echo "DATABASE_URL_UNPOOLED:"
npx -y neonctl connection-string prod --project-id "${NEON_PROJECT_ID}"
echo ""
echo "--- Nächste Schritte ---"
echo "1. Schema auf prod anwenden:"
echo "   DATABASE_URL=\"\$(npx -y neonctl connection-string prod --project-id ${NEON_PROJECT_ID} --pooled)\" npx prisma db push"
echo "2. In Vercel → Settings → Environment Variables → Production die beiden Werte oben eintragen."
echo "3. Production-Deploy auslösen und prüfen."
