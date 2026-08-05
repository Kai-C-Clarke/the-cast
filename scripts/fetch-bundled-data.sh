#!/bin/bash
# Runs as this repo's Netlify BUILD command (see netlify.toml [build] command).
# Pulls the four search indexes fresh from the private glider-workshop repo
# into netlify/functions/data/, which netlify.toml's included_files then bakes
# into the archivist function's deployment package (5/8/26 concurrency fix --
# see the long comment above DATA_DIR in archivist.js for why this fetch
# happens here, at build time, rather than being committed to git).
#
# Soft-fails on purpose: if GITHUB_TOKEN is missing or a fetch fails, this
# script logs a warning and exits 0 rather than failing the whole site build.
# archivist.js falls back to its old live-GitHub-fetch path when a bundled
# file isn't present, so the worst case here is "the concurrency fix didn't
# apply to this deploy", not "the site is down".
#
# Also fetches the wk- SEARCH INDEX (term -> book/page postings only, no book
# prose) -- safe to bundle into the build artifact the same way, since this
# never gets committed to git, unlike the earlier reverted attempt. Does NOT
# touch wk-books/ (the actual 155 book texts) -- those stay on the private
# vintage-glider-knowledge-base repo, fetched per-request as before (see the
# loadWkBook comment in archivist.js for why).

set -uo pipefail
cd "$(dirname "$0")/.."
DATA_DIR="netlify/functions/data"
mkdir -p "$DATA_DIR"

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "WARNING: GITHUB_TOKEN not set at build time -- skipping index bundling, archivist.js will fall back to live GitHub fetches for every cold instance (the pre-fix behaviour)."
  exit 0
fi

fetch_raw() {
  local repo=$1 path=$2 out=$3
  curl -sf -H "Authorization: token $GITHUB_TOKEN" -H "Accept: application/vnd.github.raw" \
    "https://api.github.com/repos/$repo/contents/$path" -o "$out"
  if [ $? -ne 0 ]; then
    echo "WARNING: fetch failed for $repo/$path -- $out will be missing, archivist.js falls back to live fetch for this one file"
    rm -f "$out"
    return 0
  fi
  local sz
  sz=$(stat -c%s "$out" 2>/dev/null || echo 0)
  if [ "$sz" -lt 50 ]; then
    echo "WARNING: $out suspiciously small ($sz bytes) -- removing so the runtime fallback kicks in instead"
    rm -f "$out"
    return 0
  fi
  echo "$out: $sz bytes"
}

fetch_raw "Kai-C-Clarke/glider-workshop" "alf/tns_fulltext.json" "$DATA_DIR/tns_fulltext.json"
fetch_raw "Kai-C-Clarke/glider-workshop" "alf/reference_fulltext.json" "$DATA_DIR/reference_fulltext.json"
fetch_raw "Kai-C-Clarke/glider-workshop" "alf/tns_1970s.json" "$DATA_DIR/tns_1970s.json"
fetch_raw "Kai-C-Clarke/glider-workshop" "alf/tns_1980s.json" "$DATA_DIR/tns_1980s.json"
fetch_raw "Kai-C-Clarke/glider-workshop" "alf/tns_1990s.json" "$DATA_DIR/tns_1990s.json"
fetch_raw "Kai-C-Clarke/glider-workshop" "alf/tns_2000s.json" "$DATA_DIR/tns_2000s.json"
fetch_raw "Kai-C-Clarke/glider-workshop" "alf/tns_2010s.json" "$DATA_DIR/tns_2010s.json"
fetch_raw "Kai-C-Clarke/vintage-glider-knowledge-base" \
  "gliding_history_and_literature/wally_kahn_collection/search_index/index.json" \
  "$DATA_DIR/wk_index.json"

echo "Bundled data fetch complete. $(ls "$DATA_DIR" 2>/dev/null | wc -l) files in $DATA_DIR."
exit 0
