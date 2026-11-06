#!/usr/bin/env bash
# Prepares the throw-away CRM the README demo tapes use, from the PUBLISHED
# package (never the repository build). Idempotent: wipes and rebuilds
# /tmp/acrm-cli-demo every time (render.sh runs it before each tape).
#   .github/demos/setup.sh
# No cloud account: an encrypted journal dataset in a local folder, demo data,
# the generated passphrase stored in the demo's own AGENTCRM_HOME.
set -euo pipefail
VERSION="${AGENTCRM_DEMO_VERSION:-0.12.2}"
PKG="@fleox-agent-crm/agentcrm@$VERSION"
DEMO=/tmp/acrm-cli-demo
export AGENTCRM_HOME="$DEMO/home"
export npm_config_cache="$DEMO/npm-cache"
export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false

mkdir -p "$DEMO"
cd "$DEMO"
rm -rf home data site work claude-home warm ext
mkdir -p work claude-home

# Warm the npx cache (and the scaffold's dev dependencies) so nothing
# downloads while recording.
npx -y "$PKG" version >/dev/null
if [ ! -f "$DEMO/.warm-$VERSION" ]; then
  mkdir -p warm && (cd warm && npx -y "$PKG" ext new module warmup >/dev/null && cd warmup && npm install --silent >/dev/null)
  rm -rf warm
  touch "$DEMO/.warm-$VERSION"
fi

cat > plan.json <<JSON
{
  "alias": "demo",
  "name": "Acme CRM",
  "owner": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "data": { "backend": "journal", "location": { "type": "local-folder", "settings": { "path": "$DEMO/data" } } },
  "hosting": { "type": "local-folder", "settings": { "path": "$DEMO/site" } },
  "demo": true
}
JSON
npx -y "$PKG" install --plan plan.json >/dev/null 2>&1
npx -y "$PKG" site use demo >/dev/null

# schema.tape inputs.
cat > work/crm-schema.json <<'JSON'
{
  "objects": [
    { "id": "markets", "labelSingular": "Market", "labelPlural": "Markets", "icon": "Globe",
      "fields": [
        { "id": "code", "label": "Code", "type": "text", "unique": true },
        { "id": "companyCount", "label": "Companies", "type": "number",
          "drilldown": { "object": "companies", "field": "markets" } },
        { "id": "archived", "label": "Archived", "type": "boolean" }
      ] },
    { "id": "companies", "labelSingular": "Company", "labelPlural": "Companies",
      "fields": [
        { "id": "markets", "label": "Markets", "type": "relation",
          "relation": { "object": "markets", "cardinality": "many" } }
      ] }
  ]
}
JSON
cat > work/day1.json <<'JSON'
[
  { "key": "FR", "fields": { "name": "France", "companyCount": 12 } },
  { "key": "DE", "fields": { "name": "Germany", "companyCount": 9 } },
  { "key": "UK", "fields": { "name": "United Kingdom", "companyCount": 7 } }
]
JSON
cat > work/day2.json <<'JSON'
[
  { "key": "FR", "fields": { "name": "France", "companyCount": 14 } },
  { "key": "DE", "fields": { "name": "Germany", "companyCount": 9 } },
  { "key": "ES", "fields": { "name": "Spain", "companyCount": 4 } }
]
JSON
echo "demo CRM ready in $DEMO"
