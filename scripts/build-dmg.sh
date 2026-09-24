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

case "$arch" in arm64) app=packages/client/dist/mac-arm64/Leaderborder.app ;; x64) app=packages/client/dist/mac/Leaderborder.app ;; esac
if [ ! -d "$app" ]; then
  echo "::error::Built app not found at $app" >&2
  exit 1
fi

if [ -d node_modules/@electron/fuses ]; then
  fuses=$(npx --no-install @electron/fuses read --app "$app")
  for expected in "RunAsNode is Disabled" "EnableEmbeddedAsarIntegrityValidation is Enabled"; do
    if ! grep -qF -- "$expected" <<<"$fuses"; then
      echo "::error::Fuse check failed for $app, expected '$expected' in:" >&2
      echo "$fuses" >&2
      exit 1
    fi
  done
else
  echo "::warning::@electron/fuses is not installed, skipping the fuse check" >&2
fi

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
