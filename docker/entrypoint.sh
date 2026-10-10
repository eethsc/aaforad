#!/bin/sh
set -eu

: "${PDK_ROOT:=/opt/pdks}"
: "${PDK:=sky130A}"
: "${SKY130_PDK_VERSION:=7519dfb04400f224f140749cda44ee7de6f5e095}"
: "${PDK_MODEL_FILE:=$PDK_ROOT/$PDK/libs.tech/ngspice/sky130.lib.spice}"
export PDK_ROOT PDK SKY130_PDK_VERSION PDK_MODEL_FILE

if [ ! -f "$PDK_MODEL_FILE" ]; then
  echo "[fusion] Downloading pinned SKY130 PDK build $SKY130_PDK_VERSION to $PDK_ROOT ..."
  # Volare uses PDK_ROOT and downloads the public, pre-built open_pdks artifact.
  # The named Docker volume retains it, so this only happens once per machine/version.
  volare enable --pdk sky130 "$SKY130_PDK_VERSION"
fi

if [ ! -f "$PDK_MODEL_FILE" ]; then
  echo "[fusion] SKY130 model file was not found after installation: $PDK_MODEL_FILE" >&2
  exit 70
fi

echo "[fusion] ngspice + SKY130 model ready: $PDK_MODEL_FILE"
exec "$@"
