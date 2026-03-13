#!/usr/bin/env bash
set -euo pipefail

# openclaw-plugin-ruvector setup script
# Builds the RuVector server, installs the plugin, and optionally starts the server.
# Supports: macOS, Linux, Windows (Git Bash / WSL)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
EXTENSIONS_DIR="${OPENCLAW_EXTENSIONS:-$HOME/.openclaw/extensions}"
PLUGIN_NAME="memory-ruvector"

# Detect OS
OS="$(uname -s)"
case "$OS" in
    Darwin)  PLATFORM="macos" ;;
    Linux)   PLATFORM="linux" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
    *)       echo "⚠ Unknown OS: $OS — proceeding anyway"; PLATFORM="unknown" ;;
esac

# Default install dir (platform-aware)
if [ "$PLATFORM" = "windows" ]; then
    INSTALL_DIR="${RUVECTOR_INSTALL_DIR:-$HOME/.local/bin}"
else
    INSTALL_DIR="${RUVECTOR_INSTALL_DIR:-/usr/local/bin}"
fi

echo "╔══════════════════════════════════════════════╗"
echo "║  OpenClaw RuVector Memory Plugin — Setup     ║"
echo "║  Platform: $PLATFORM"
echo "╚══════════════════════════════════════════════╝"
echo ""

# --- Step 1: Check prerequisites ---
echo "→ Checking prerequisites..."

if ! command -v cargo &>/dev/null; then
    echo "✗ Rust toolchain not found."
    echo "  Install from https://rustup.rs:"
    if [ "$PLATFORM" = "windows" ]; then
        echo "    Download rustup-init.exe from https://rustup.rs"
    else
        echo "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    fi
    exit 1
fi
echo "  ✓ Rust $(cargo --version | cut -d' ' -f2)"

if ! command -v node &>/dev/null; then
    echo "✗ Node.js not found. Install v20+ from https://nodejs.org"
    exit 1
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
    echo "✗ Node.js v20+ required, found $(node -v)"
    exit 1
fi
echo "  ✓ Node.js $(node -v)"
echo "  ✓ Platform: $PLATFORM"

# --- Step 2: Build RuVector server ---
echo ""
echo "→ Building RuVector server (first build takes 2-3 minutes)..."
cd "$SERVER_DIR"
cargo build --release 2>&1 | tail -3

if [ "$PLATFORM" = "windows" ]; then
    BINARY="$SERVER_DIR/target/release/ruvector-server.exe"
    BINARY_NAME="ruvector-server.exe"
else
    BINARY="$SERVER_DIR/target/release/ruvector-server"
    BINARY_NAME="ruvector-server"
fi

if [ ! -f "$BINARY" ]; then
    echo "✗ Build failed — binary not found at $BINARY"
    exit 1
fi
echo "  ✓ Server binary built ($(du -h "$BINARY" | cut -f1 | xargs))"

# --- Step 3: Install server binary ---
echo ""
echo "→ Installing $BINARY_NAME to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
if [ -w "$INSTALL_DIR" ]; then
    cp "$BINARY" "$INSTALL_DIR/$BINARY_NAME"
elif command -v sudo &>/dev/null; then
    echo "  (requires sudo)"
    sudo cp "$BINARY" "$INSTALL_DIR/$BINARY_NAME"
else
    echo "  ✗ Cannot write to $INSTALL_DIR and sudo not available."
    echo "  Set RUVECTOR_INSTALL_DIR to a writable path and re-run."
    exit 1
fi
chmod +x "$INSTALL_DIR/$BINARY_NAME" 2>/dev/null || true
echo "  ✓ Installed to $INSTALL_DIR/$BINARY_NAME"

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
    if [ "$PLATFORM" = "windows" ]; then
        # Windows symlinks can be tricky — use junction or copy
        if command -v mklink &>/dev/null; then
            cmd //c "mklink /J \"$(cygpath -w "$EXTENSIONS_DIR/$PLUGIN_NAME")\" \"$(cygpath -w "$SCRIPT_DIR")\"" 2>/dev/null || cp -r "$SCRIPT_DIR" "$EXTENSIONS_DIR/$PLUGIN_NAME"
        else
            cp -r "$SCRIPT_DIR" "$EXTENSIONS_DIR/$PLUGIN_NAME"
        fi
    else
        ln -s "$SCRIPT_DIR" "$EXTENSIONS_DIR/$PLUGIN_NAME"
    fi
    echo "→ Linked to $EXTENSIONS_DIR/$PLUGIN_NAME"
fi
echo "  ✓ Plugin registered"

# --- Step 6: Platform-specific service installation (optional) ---
if [ "$PLATFORM" = "macos" ]; then
    PLIST_SRC="$SCRIPT_DIR/com.ttt.ruvector-server.plist"
    PLIST_DST="$HOME/Library/LaunchAgents/com.ttt.ruvector-server.plist"
    if [ -f "$PLIST_SRC" ] && [ ! -f "$PLIST_DST" ]; then
        echo ""
        read -p "→ Install launchd service for auto-start on login? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sed "s|__RUVECTOR_SERVER__|$INSTALL_DIR/$BINARY_NAME|g" "$PLIST_SRC" > "$PLIST_DST"
            launchctl load "$PLIST_DST" 2>/dev/null || true
            echo "  ✓ launchd service installed and started"
        fi
    fi
elif [ "$PLATFORM" = "linux" ]; then
    SYSTEMD_DIR="$HOME/.config/systemd/user"
    UNIT_FILE="$SYSTEMD_DIR/ruvector-server.service"
    if [ ! -f "$UNIT_FILE" ]; then
        echo ""
        read -p "→ Install systemd user service for auto-start? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            mkdir -p "$SYSTEMD_DIR"
            cat > "$UNIT_FILE" << SYSTEMD_EOF
[Unit]
Description=RuVector Vector Database Server
After=network.target

[Service]
Type=simple
ExecStart=$INSTALL_DIR/$BINARY_NAME
Environment=RUVECTOR_HOST=127.0.0.1
Environment=RUVECTOR_PORT=6333
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SYSTEMD_EOF
            systemctl --user daemon-reload
            systemctl --user enable ruvector-server
            systemctl --user start ruvector-server
            echo "  ✓ systemd user service installed and started"
            echo "    Manage: systemctl --user {start|stop|status|restart} ruvector-server"
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
        if [ "$PLATFORM" = "windows" ]; then
            RUVECTOR_HOST=127.0.0.1 "$INSTALL_DIR/$BINARY_NAME" &
        else
            RUVECTOR_HOST=127.0.0.1 nohup "$INSTALL_DIR/$BINARY_NAME" > /tmp/ruvector-server.log 2>&1 &
        fi
        sleep 2
        if curl -sf http://localhost:6333/health &>/dev/null; then
            echo "  ✓ Server running on localhost:6333 (PID $!)"
        else
            echo "  ✗ Server failed to start."
            [ "$PLATFORM" != "windows" ] && echo "    Check: cat /tmp/ruvector-server.log"
            exit 1
        fi
    fi
fi

# --- Done ---
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Setup complete!                                     ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Server:  http://localhost:6333                      ║"
echo "║  Plugin:  $EXTENSIONS_DIR/$PLUGIN_NAME"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Add to your openclaw.json:                          ║"
echo "║                                                      ║"
echo '║  "plugins": {                                        ║'
echo '║    "slots": { "memory": "memory-ruvector" },         ║'
echo '║    "entries": {                                      ║'
echo '║      "memory-ruvector": {                            ║'
echo '║        "enabled": true,                              ║'
echo '║        "config": {                                   ║'
echo '║          "embedding": {                              ║'
echo '║            "apiKey": "${GOOGLE_API_KEY}"             ║'
echo '║          }                                           ║'
echo '║        }                                             ║'
echo '║      }                                               ║'
echo '║    }                                                 ║'
echo '║  }                                                   ║'
echo "╚══════════════════════════════════════════════════════╝"
