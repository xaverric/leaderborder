#!/usr/bin/env bash
set -euo pipefail

[ "$#" -eq 1 ] || { echo "Usage: scripts/fetch-tokscale-binary.sh <arm64|x64>" >&2; exit 2; }
case "$1" in arm64|x64) ;; *) echo "Unsupported architecture" >&2; exit 2 ;; esac
name="@tokscale/cli-darwin-$1"

read -r version integrity < <(node -e '
  const entry = require("./package-lock.json").packages["node_modules/" + process.argv[1]];
  if (!entry?.version || !entry?.integrity) process.exit(1);
  console.log(entry.version, entry.integrity);
' "$name") || { echo "::error::$name is not locked in package-lock.json" >&2; exit 1; }

dest=$(mktemp -d)
trap 'rm -rf "$dest"' EXIT
pack=$(npm pack "$name@$version" --pack-destination "$dest" --ignore-scripts --json)

read -r file packed < <(node -e '
  const [entry] = JSON.parse(process.argv[1]);
  console.log(entry.filename, entry.integrity);
' "$pack")

if [ "$packed" != "$integrity" ]; then
  echo "::error::$name@$version integrity mismatch: lockfile $integrity, registry $packed" >&2
  exit 1
fi

target="node_modules/$name"
rm -rf "$target"
mkdir -p "$target"
tar -xzf "$dest/$file" -C "$target" --strip-components=1
echo "installed $name@$version into $target"
