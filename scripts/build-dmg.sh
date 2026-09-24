#!/usr/bin/env bash
set -euo pipefail

usage() { echo "Usage: scripts/build-dmg.sh <arm64|x64> <version> <out-dir>" >&2; exit 2; }
[ "$#" -eq 3 ] || usage
arch=$1 version=$2 out=$3
case "$arch" in arm64|x64) ;; *) usage ;; esac

marker=$(mktemp)
trap 'rm -f "$marker"' EXIT
sleep 1

(cd packages/client && npx --no-install electron-builder --mac dmg "--$arch" --config electron-builder.yml --publish never)

dmgs=()
while IFS= read -r -d '' file; do dmgs+=("$file"); done \
  < <(find packages/client -name '*.dmg' -newer "$marker" -not -path '*/node_modules/*' -print0)

if [ "${#dmgs[@]}" -ne 1 ]; then
  echo "::error::Expected exactly one new DMG for $arch, found ${#dmgs[@]}: ${dmgs[*]:-none}" >&2
  exit 1
fi

mkdir -p "$out"
target="$out/Leaderborder-$version-$arch.dmg"
mv "${dmgs[0]}" "$target"
echo "$target"
