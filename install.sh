#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/usr/local/bin/floyd-tty-bridge"
SDK_DIR="/usr/local/share/floyd"
NM_MANIFEST_DIR="/Library/Google/Chrome/NativeMessagingHosts"
NM_MANIFEST_NAME="com.floyd.tty.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_header() {
  echo ""
  echo "  Floyd's Labs TTY Bridge v5.0.0 — Installer"
  echo "  ============================================"
  echo ""
}

detect_extension_id() {
  local ext_dir="$HOME/Library/Application Support/Google/Chrome/Default/Extensions"
  if [[ -d "$ext_dir" ]]; then
    for dir in "$ext_dir"/*/; do
      if [[ -f "$dir"*/manifest.json ]]; then
        local name
        name=$(python3 -c "import json,glob;m=glob.glob('$dir/*/manifest.json');print(json.load(open(m[0]))['name'] if m else '')" 2>/dev/null || true)
        if [[ "$name" == *"Floyd"*"TTY"* ]]; then
          basename "$dir"
          return 0
        fi
      fi
    done
  fi
  return 1
}

install_native_host() {
  echo "[1/3] Installing native host to $INSTALL_DIR"
  sudo mkdir -p "$INSTALL_DIR"
  sudo cp "$SCRIPT_DIR/extension/native_host.py" "$INSTALL_DIR/native_host.py"
  sudo chmod 755 "$INSTALL_DIR/native_host.py"
  echo "      Done."
}

install_sdk() {
  echo "[2/3] Installing SDK to $SDK_DIR"
  sudo mkdir -p "$SDK_DIR"
  sudo cp "$SCRIPT_DIR/extension/floyd-tools.sh" "$SDK_DIR/floyd-tools.sh"
  sudo chmod 644 "$SDK_DIR/floyd-tools.sh"
  echo "      Done."
}

register_native_messaging() {
  echo "[3/3] Registering native messaging host"

  local ext_id=""
  if [[ -n "${1:-}" ]]; then
    ext_id="$1"
  else
    echo "      Attempting auto-detection of extension ID..."
    ext_id=$(detect_extension_id || true)
  fi

  if [[ -z "$ext_id" ]]; then
    echo ""
    echo "      Could not auto-detect extension ID."
    echo "      Load the extension in Chrome, then find the ID at chrome://extensions"
    echo ""
    read -rp "      Enter your extension ID: " ext_id
  fi

  if [[ -z "$ext_id" ]]; then
    echo "      ERROR: No extension ID provided. Skipping native host registration."
    echo "      Re-run: $0 <extension_id>"
    return 1
  fi

  echo "      Extension ID: $ext_id"

  local manifest
  manifest=$(cat <<EOF
{
  "name": "com.floyd.tty",
  "description": "Floyd's Labs TTY Bridge Native Host v5.0.0",
  "path": "$INSTALL_DIR/native_host.py",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$ext_id/"
  ]
}
EOF
)

  sudo mkdir -p "$NM_MANIFEST_DIR"
  echo "$manifest" | sudo tee "$NM_MANIFEST_DIR/$NM_MANIFEST_NAME" > /dev/null
  echo "      Manifest written to $NM_MANIFEST_DIR/$NM_MANIFEST_NAME"
  echo "      Done."
}

uninstall() {
  echo "Uninstalling Floyd TTY Bridge..."
  sudo rm -rf "$INSTALL_DIR"
  sudo rm -rf "$SDK_DIR"
  sudo rm -f "$NM_MANIFEST_DIR/$NM_MANIFEST_NAME"
  echo "Done. Extension must be removed manually from chrome://extensions"
}

print_header

case "${1:-install}" in
  install)
    install_native_host
    install_sdk
    register_native_messaging "${2:-}"
    echo ""
    echo "  Installation complete."
    echo "  Restart Chrome, then open the side panel with Cmd+Shift+Y"
    echo ""
    ;;
  uninstall)
    uninstall
    ;;
  *)
    echo "Usage: $0 [install|uninstall] [extension_id]"
    exit 1
    ;;
esac
