#!/usr/bin/env bash
# Downloads the official validation artefacts and Saxon into conformance/.cache,
# refusing any file whose SHA-256 differs from pins.txt. The artefacts are
# EUPL-1.2 and are fetched, never committed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cache="$here/.cache"
mkdir -p "$cache"
while IFS='|' read -r name url sha; do
  case "$name" in ''|'#'*) continue ;; esac
  if [ -f "$cache/$name" ] && [ "$(sha256sum "$cache/$name" | cut -d' ' -f1)" = "$sha" ]; then echo "have $name"; continue; fi
  rm -f "$cache/$name"
  for attempt in 1 2 3; do curl -sfL --retry 2 -o "$cache/$name" "$url" && break; echo "attempt $attempt failed: $name" >&2; sleep 3; done
  got="$(sha256sum "$cache/$name" | cut -d' ' -f1)"
  [ "$got" = "$sha" ] || { echo "$name: sha256 $got, expected $sha" >&2; rm -f "$cache/$name"; exit 1; }
  echo "ok   $name"
done < "$here/pins.txt"
if [ ! -f "$cache/ubl/xslt/EN16931-UBL-validation.xslt" ]; then rm -rf "$cache/ubl"; mkdir "$cache/ubl"; (cd "$cache/ubl" && unzip -q ../en16931-ubl-1.3.16.zip); fi
echo "$cache"
