#!/bin/sh
set -eu

: "${PDK_ROOT:=/opt/pdks}"
: "${PDK:=sky130A}"
: "${SKY130_PDK_VERSION:=b344c97eacc2aaf8e14ae7e43e2e9dc0871de2c0}"
: "${PDK_MODEL_FILE:=$PDK_ROOT/$PDK/libs.tech/ngspice/sky130.lib.spice}"
export PDK_ROOT PDK SKY130_PDK_VERSION PDK_MODEL_FILE

model_root=$(dirname "$PDK_MODEL_FILE")
pdk_complete() {
  [ -f "$PDK_MODEL_FILE" ] \
    && [ -f "$model_root/corners/tt.spice" ] \
    && [ -f "$model_root/r+c/res_typical__cap_typical.spice" ] \
    && [ -f "$model_root/r+c/res_typical__cap_typical__lin.spice" ] \
    && [ -f "$model_root/corners/tt/specialized_cells.spice" ]
}

if ! pdk_complete; then
  echo "[fusion] Installing/recovering complete SKY130 PDK build $SKY130_PDK_VERSION to $PDK_ROOT ..."
  # Ciel distributes the complete open_pdks-generated ngspice hierarchy. The
  # previous Volare artifact could expose the top-level library while omitting
  # its corners/ and r+c/ includes, yielding a guaranteed ngspice failure.
  # This operates only inside the named Docker PDK volume.
  ciel enable --pdk-root "$PDK_ROOT" --pdk-family sky130 "$SKY130_PDK_VERSION"
fi

if ! pdk_complete; then
  echo "[fusion] Complete SKY130 ngspice model set was not found after installation: $PDK_MODEL_FILE" >&2
  exit 70
fi

echo "[fusion] ngspice + SKY130 model ready: $PDK_MODEL_FILE"
exec "$@"
