#!/usr/bin/env bash
# mp3-to-midi.sh
# Usage: mp3-to-midi.sh <output_mid_path>
# This script is intended to be run from the `api` directory (as the Node server does),
# but it resolves paths robustly using the script location. It will:
# - source the virtualenv at /root/uta-proj/.venv/bin/activate
# - take one arg: the output MID path (e.g. ./files/cream.mid)
# - derive the input MP3 as ./files/<base>.mp3
# - run: basic-pitch <output_dir> <input_mp3>
# - find the produced .mid in the output_dir and move it to the requested output path
# - exit with meaningful codes for the API

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_ACTIVATE="../.venv/bin/activate"

if [[ "$#" -ne 1 ]]; then
    echo "Usage: $0 <output_mid_path>" >&2
    exit 1
fi

# Resolve output path: if absolute, use it; otherwise make it relative to the script dir
ARG_OUT="$1"
if [[ "$ARG_OUT" = /* ]]; then
    OUT_PATH="$ARG_OUT"
else
    # strip leading ./ if present
    CLEAN="${ARG_OUT#./}"
    OUT_PATH="$SCRIPT_DIR/$CLEAN"
fi

OUT_DIR="$(dirname "$OUT_PATH")"
BASE_NAME="$(basename "$OUT_PATH" .mid)"
INPUT_PATH="$SCRIPT_DIR/files/${BASE_NAME}.mp3"

# Ensure virtualenv exists and source it
if [[ -f "$VENV_ACTIVATE" ]]; then
    # shellcheck disable=SC1090
    source "$VENV_ACTIVATE"
else
    echo "Virtualenv activate not found at $VENV_ACTIVATE" >&2
    exit 2
fi

# Validate input
if [[ ! -f "$INPUT_PATH" ]]; then
    echo "Input MP3 not found: $INPUT_PATH" >&2
    exit 3
fi

# Ensure output directory exists
mkdir -p "$OUT_DIR"

# Create a temporary output directory for basic-pitch (it expects a directory)
TMP_OUT_DIR="$(mktemp -d "$OUT_DIR/${BASE_NAME}.bp.XXXXXX")"
# Ensure cleanup on exit
cleanup() {
    rm -rf "${TMP_OUT_DIR}" || true
}
trap cleanup EXIT

# Run basic-pitch with the required argument order: <output_dir> <input>
if command -v basic-pitch >/dev/null 2>&1; then
    echo "Running: basic-pitch '$TMP_OUT_DIR' '$INPUT_PATH'"
    if basic-pitch "$TMP_OUT_DIR" "$INPUT_PATH"; then
        # Find the first .mid produced in the temp dir
        MID_FILE="$(find "$TMP_OUT_DIR" -maxdepth 1 -type f -iname '*.mid' | head -n 1 || true)"
        if [[ -z "${MID_FILE}" ]]; then
            echo "basic-pitch completed but no .mid file found in $TMP_OUT_DIR" >&2
            exit 6
        fi

        # Move the produced MIDI to the requested output path (overwrite if exists)
        mv -f "$MID_FILE" "$OUT_PATH"
        echo "basic-pitch succeeded, moved MIDI to: $OUT_PATH"
        # cleanup will run from trap
        exit 0
    else
        echo "basic-pitch failed" >&2
        exit 4
    fi
else
    echo "basic-pitch not found in PATH. Make sure it's installed in the virtualenv." >&2
    exit 5
fi
