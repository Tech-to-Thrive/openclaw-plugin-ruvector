#!/usr/bin/env bash
set -euo pipefail

# openclaw-plugin-ruvector setup script
# Builds the RuVector server, installs the plugin, and optionally starts the server.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
INSTALL_DIR="${RUVECTOR_INSTALL_DIR:-/usr/local/bin}"
EXTENSIONS_DIR="${OPENCLAW_EXTENSIONS:-$HOME/.openclaw/extensions}"
PLUGIN_NAME="memory-ruvector"

echo "╔══════════════════════════════════════════════╗"
echo "║  OpenClaw RuVector Memory Plugin — Setup     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# --- Step 1: Check prerequisites ---
echo "→ Checking prerequisites..."

if ! command -v cargo &>/dev/null; then
    echo "✗ Rust toolchain not found. Install from https://rustup.rs"
    exit 1
fi
echo "  ✓ Rust $(cargo --version | cut -d' ' -f2)"

if ! command -v node &>/dev/null; then
    echo "✗ Node.js not found. Install from https://nodejs.org (v20+)"
    exit 1
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
    echo "✗ Node.js v20+ required, found $(node -v)"
    exit 1
fi
echo "  ✓ Node.js $(node -v)"

# --- Step 2: Build RuVector server ---
echo ""
echo "→ Building RuVector server (this takes 1-2 minutes on first build)..."
cd "$SERVER_DIR"
cargo build --release 2>&1 | tail -3
BINARY="$SERVER_DIR/target/release/ruvector-server"

if [ ! -f "$BINARY" ]; then
    echo "✗ Build failed — binary not found at $BINARY"
    exit 1
fi
echo "  ✓ Server binary built ($(du -h "$BINARY" | cut -f1))"

# --- Step 3: Install server binary ---
echo ""
echo "→ Installing ruvector-server to $INSTALL_DIR..."
if [ -w "$INSTALL_DIR" ]; then
    cp "$BINARY" "$INSTALL_DIR/ruvector-server"
else
    echo "  (requires sudo)"
    sudo cp "$BINARY" "$INSTALL_DIR/ruvector-server"
fi
chmod +x "$INSTALL_DIR/ruvector-server"
echo "  ✓ Installed to $INSTALL_DIR/ruvector-server"

# --- Step 4: Install npm dependencies ---
echo ""
echo "→ Installing plugin dependencies..."
cd "$SCRIPT_DIR"
npm install --production 2>&1 | tail -1
echo "  ✓ npm dependencies installed"

# --- Step 5: Symlink into OpenClaw extensions ---
echo ""
if [ -L "$EXTENSIONS_DIR/$PLUGIN_NAME" ]; then
    echo "→ Symlink already exists at $EXTENSIONS_DIR/$PLUGIN_NAME"
elif [ -d "$EXTENSIONS_DIR/$PLUGIN_NAME" ]; then
    echo "→ Directory already exists at $EXTENSIONS_DIR/$PLUGIN_NAME (not overwriting)"
else
    mkdir -p "$EXTENSIONS_DIR"
    ln -s "$SCRIPT_DIR" "$EXTENSIONS_DIR/$PLUGIN_NAME"
    echo "→ Symlinked to $EXTENSIONS_DIR/$PLUGIN_NAME"
fi
echo "  ✓ Plugin registered"

# --- Step 6: macOS launchd service (optional) ---
if [ "$(uname)" = "Darwin" ]; then
    PLIST_SRC="$SCRIPT_DIR/com.ttt.ruvector-server.plist"
    PLIST_DST="$HOME/Library/LaunchAgents/com.ttt.ruvector-server.plist"
    if [ -f "$PLIST_SRC" ] && [ ! -f "$PLIST_DST" ]; then
        echo ""
        read -p "→ Install launchd service for auto-start on login? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            cp "$PLIST_SRC" "$PLIST_DST"
            # Replace placeholder with actual binary path
            sed -i '' "s|__RUVECTOR_SERVER__|$INSTALL_DIR/ruvector-server|g" "$PLIST_DST"
            launchctl load "$PLIST_DST" 2>/dev/null || true
            echo "  ✓ launchd service installed and started"
        fi
    fi
fi

# --- Step 7: Start server ---
echo ""
if curl -sf http://localhost:6333/health &>/dev/null; then
    echo "→ RuVector server already running on localhost:6333"
else
    read -p "→ Start RuVector server now? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        RUVECTOR_HOST=127.0.0.1 nohup "$INSTALL_DIR/ruvector-server" > /tmp/ruvector-server.log 2>&1 &
        sleep 1
        if curl -sf http://localhost:6333/health &>/dev/null; then
            echo "  ✓ Server running on localhost:6333 (PID $!)"
        else
            echo "  ✗ Server failed to start. Check /tmp/ruvector-server.log"
            exit 1
        fi
    fi
fi

# --- Done ---
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Setup complete!                             ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Server:  http://localhost:6333              ║"
echo "║  Plugin:  $EXTENSIONS_DIR/$PLUGIN_NAME"
echo "╠══════════════════════════════════════════════╣"
echo "║  Next: add to your openclaw.json config:     ║"
echo "║                                              ║"
echo '║  "plugins": {                                ║'
echo '║    "slots": { "memory": "memory-ruvector" }, ║'
echo '║    "entries": {                              ║'
echo '║      "memory-ruvector": {                    ║'
echo '║        "enabled": true,                      ║'
echo '║        "config": {                           ║'
echo '║          "embedding": {                      ║'
echo '║            "apiKey": "${GOOGLE_API_KEY}"     ║'
echo '║          }                                   ║'
echo '║        }                                     ║'
echo '║      }                                       ║'
echo '║    }                                         ║'
echo '║  }                                           ║'
echo "╚══════════════════════════════════════════════╝"
