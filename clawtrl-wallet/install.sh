#!/bin/bash
# Clawtrl Wallet — One-command installer
# Works with or without root/sudo.
#
# With root (VPS):
#   curl -sSL https://raw.githubusercontent.com/PortalFnd/hermes-openclaw-skills/main/clawtrl-wallet/install.sh | sudo bash
#   Installs to /opt/clawtrl/, sets up systemd service, symlinks to /usr/local/bin/
#
# Without root (agent / container):
#   curl -sSL https://raw.githubusercontent.com/PortalFnd/hermes-openclaw-skills/main/clawtrl-wallet/install.sh | bash
#   Installs to ~/.clawtrl/, adds to PATH, runs proxy as background process
#
# Via npx:
#   npx clawtrl-wallet
#   Detects root/non-root automatically

set -e

REPO="https://github.com/PortalFnd/hermes-openclaw-skills"
RAW="https://raw.githubusercontent.com/PortalFnd/hermes-openclaw-skills/main/clawtrl-wallet"

# Detect root vs non-root
if [ "$(id -u)" = "0" ]; then
  MODE="root"
  INSTALL_DIR="/opt/clawtrl/signing-proxy"
  TOOLS_DIR="/opt/clawtrl/wallet-tools"
  BIN_DIR="/usr/local/bin"
else
  MODE="user"
  INSTALL_DIR="$HOME/.clawtrl/signing-proxy"
  TOOLS_DIR="$HOME/.clawtrl/wallet-tools"
  BIN_DIR="$HOME/.clawtrl/bin"
fi

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     Clawtrl Wallet Installer         ║"
echo "  ║     ERC-8128 + x402 + Transfers      ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  Mode: $MODE"
echo "  Install dir: $INSTALL_DIR"
echo ""

# Check for Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is required. Install it first:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
  echo "  apt-get install -y nodejs"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "ERROR: Node.js 18+ required (found v$NODE_VERSION)"
  exit 1
fi
echo "[ok] Node.js $(node -v)"

# Check for curl
if ! command -v curl &>/dev/null; then
  echo "ERROR: curl is required"
  exit 1
fi

# Detect if running from cloned repo or via curl pipe
SKILL_DIR=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || true
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/src/signing-proxy.js" ]; then
  SKILL_DIR="$SCRIPT_DIR"
  echo "[ok] Installing from local clone"
fi

# Create directories
echo ""
echo "[1/6] Creating directories..."
mkdir -p "$INSTALL_DIR/src"
mkdir -p "$TOOLS_DIR"
mkdir -p "$BIN_DIR"

# Install signing proxy
echo "[2/6] Installing signing proxy..."
if [ -n "$SKILL_DIR" ]; then
  cp "$SKILL_DIR/package.json" "$INSTALL_DIR/package.json"
  cp "$SKILL_DIR/src/signing-proxy.js" "$INSTALL_DIR/src/signing-proxy.js"
  # Vendored Clawtrl Private Payments engine (source + prebuilt CommonJS dist)
  if [ -d "$SKILL_DIR/src/privacy" ]; then cp -R "$SKILL_DIR/src/privacy" "$INSTALL_DIR/src/privacy"; fi
  if [ -d "$SKILL_DIR/src/privacy-dist" ]; then cp -R "$SKILL_DIR/src/privacy-dist" "$INSTALL_DIR/src/privacy-dist"; fi
else
  echo "       Downloading from GitHub..."
  curl -sSL "$RAW/package.json" -o "$INSTALL_DIR/package.json"
  curl -sSL "$RAW/src/signing-proxy.js" -o "$INSTALL_DIR/src/signing-proxy.js"
  # Fetch the vendored privacy engine (prebuilt dist) via repo tarball so the
  # whole directory comes across in one shot.
  echo "       Fetching private-payments engine..."
  TARBALL="https://codeload.github.com/PortalFnd/hermes-openclaw-skills/tar.gz/refs/heads/main"
  TMP_TAR="$(mktemp -d)"
  if curl -sSL "$TARBALL" -o "$TMP_TAR/repo.tgz" && tar -xzf "$TMP_TAR/repo.tgz" -C "$TMP_TAR" 2>/dev/null; then
    SRC_PRIV="$(find "$TMP_TAR" -type d -path '*clawtrl-wallet/src/privacy' | head -1)"
    SRC_DIST="$(find "$TMP_TAR" -type d -path '*clawtrl-wallet/src/privacy-dist' | head -1)"
    [ -n "$SRC_PRIV" ] && cp -R "$SRC_PRIV" "$INSTALL_DIR/src/privacy"
    [ -n "$SRC_DIST" ] && cp -R "$SRC_DIST" "$INSTALL_DIR/src/privacy-dist"
  else
    echo "       (warning) could not fetch privacy engine; private payments will be unavailable"
  fi
  rm -rf "$TMP_TAR"
fi

# Install npm dependencies
echo "[3/6] Installing npm dependencies..."
cd "$INSTALL_DIR"
npm install --production 2>&1 | tail -3 || {
  echo "       Retrying with --legacy-peer-deps..."
  npm install --production --legacy-peer-deps 2>&1 | tail -3 || true
}

# Install shell tools
echo "[4/6] Installing shell tools..."
TOOLS="wallet-info wallet-balance signed-fetch crypto-send erc8128-sign paytoll token-balance tx-status contract-read contract-write ens-resolve gas-estimate wallet-tx-log token-allowance token-revoke wallet-summary wallet-stats contract-events token-price wallet-label private-status private-balance private-deposit private-pay private-fetch"
for tool in $TOOLS; do
  if [ -n "$SKILL_DIR" ]; then
    cp "$SKILL_DIR/bin/$tool" "$TOOLS_DIR/$tool"
  else
    curl -sSL "$RAW/bin/$tool" -o "$TOOLS_DIR/$tool"
  fi
  chmod +x "$TOOLS_DIR/$tool"
  # Symlink into BIN_DIR
  ln -sf "$TOOLS_DIR/$tool" "$BIN_DIR/$tool"
done

# For non-root: also try to symlink into a PATH dir if possible
if [ "$MODE" = "user" ]; then
  # Add ~/.clawtrl/bin to PATH if not already there
  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    export PATH="$BIN_DIR:$PATH"
    # Persist to shell profile
    for rc in "$HOME/.bashrc" "$HOME/.profile"; do
      if [ -f "$rc" ] && ! grep -q ".clawtrl/bin" "$rc" 2>/dev/null; then
        echo 'export PATH="$HOME/.clawtrl/bin:$PATH"' >> "$rc"
        break
      fi
    done
  fi
fi

# Find wallet key
HAS_KEY=false
ENV_FILE=""
if [ -n "$AGENT_WALLET_PRIVATE_KEY" ]; then
  HAS_KEY=true
elif [ -f "/opt/openclaw/.env" ] && grep -q "AGENT_WALLET_PRIVATE_KEY" /opt/openclaw/.env 2>/dev/null; then
  HAS_KEY=true
  ENV_FILE="/opt/openclaw/.env"
elif [ -f "$HOME/.env" ] && grep -q "AGENT_WALLET_PRIVATE_KEY" "$HOME/.env" 2>/dev/null; then
  HAS_KEY=true
  ENV_FILE="$HOME/.env"
elif [ -f "$HOME/.clawtrl/.env" ] && grep -q "AGENT_WALLET_PRIVATE_KEY" "$HOME/.clawtrl/.env" 2>/dev/null; then
  HAS_KEY=true
  ENV_FILE="$HOME/.clawtrl/.env"
fi

# Load env file if found
if [ -n "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# Start the proxy
if [ "$MODE" = "root" ]; then
  # Root mode: use systemd
  echo "[5/6] Setting up systemd service..."
  cat > /etc/systemd/system/clawtrl-signing.service <<EOF
[Unit]
Description=Clawtrl ERC-8128 Signing Proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/src/signing-proxy.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=-/opt/openclaw/.env

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable clawtrl-signing 2>/dev/null

  echo "[6/6] Starting signing proxy..."
  if [ "$HAS_KEY" = true ]; then
    systemctl restart clawtrl-signing
  else
    echo "       Skipping start (no wallet key found)"
  fi
else
  # Non-root mode: background process
  echo "[5/6] Skipping systemd (no root)..."

  echo "[6/6] Starting signing proxy..."
  # Kill any existing proxy
  pkill -f "signing-proxy.js" 2>/dev/null || true
  sleep 1

  if [ "$HAS_KEY" = true ]; then
    cd "$INSTALL_DIR"
    nohup node "$INSTALL_DIR/src/signing-proxy.js" > "$HOME/.clawtrl/proxy.log" 2>&1 &
    PROXY_PID=$!
    echo "$PROXY_PID" > "$HOME/.clawtrl/proxy.pid"
    echo "       Started with PID $PROXY_PID"
  else
    echo "       Skipping start (no wallet key found)"
  fi
fi

# Wait and check
sleep 2
if curl -sf http://127.0.0.1:8128/health &>/dev/null; then
  ADDR=$(curl -sf http://127.0.0.1:8128/identity 2>/dev/null | grep -o '"address":"[^"]*"' | cut -d'"' -f4)
  echo ""
  echo "  ✓ Signing proxy running on 127.0.0.1:8128"
  [ -n "$ADDR" ] && echo "  ✓ Wallet: $ADDR"
elif [ "$HAS_KEY" = true ]; then
  echo ""
  echo "  ! Proxy installed but failed to start"
  if [ "$MODE" = "root" ]; then
    echo "    Check logs: journalctl -u clawtrl-signing -n 20"
  else
    echo "    Check logs: cat $HOME/.clawtrl/proxy.log"
  fi
else
  echo ""
  echo "  ! No AGENT_WALLET_PRIVATE_KEY found"
  if [ "$MODE" = "root" ]; then
    echo "    Set it in /opt/openclaw/.env then run:"
    echo "    systemctl restart clawtrl-signing"
  else
    echo "    Set it in ~/.clawtrl/.env then re-run this installer"
  fi
fi

echo ""
echo "  ══════════════════════════════════════"
echo "  Installed to: $INSTALL_DIR"
echo "  Tools:"
echo "    wallet-info      — wallet address + chain"
echo "    wallet-balance   — ETH/USDC balances"
echo "    signed-fetch     — ERC-8128 + x402 requests"
echo "    crypto-send      — send ETH/USDC on Base"
echo "    erc8128-sign     — sign requests (headers only)"
echo "    paytoll          — 27 paid APIs via x402 (DeFi, swaps, AI, Twitter)"
echo "    token-balance    — balance of any ERC-20 on Base"
echo "    tx-status        — check status of a Base transaction"
echo "    contract-read    — call any view function on any contract"
echo "    contract-write   — call any state-changing function (DeFi, NFTs, DAOs)"
echo "    ens-resolve      — ENS name <-> address resolution"
echo "    gas-estimate     — estimate cost of a transaction"
echo "    wallet-tx-log    — recent transactions (transfers, payments, contract calls)"
echo "    token-allowance  — check ERC-20 approval amounts"
echo "    token-revoke     — revoke ERC-20 approvals (security)"
echo "    wallet-summary   — full overview: balances, spending, approvals"
echo "    wallet-stats     — spending analytics from transaction history"
echo "    contract-events  — query past events from any contract"
echo "    token-price      — USD price via Chainlink (ETH, USDC, DAI, etc.)"
echo "    wallet-label     — label addresses for human-readable references"
echo "  -- Private payments (opt-in: CLAWTRL_PRIVACY_ENABLED=true) --"
echo "    private-status   — privacy on/off + shielded balance"
echo "    private-balance  — shielded (private) USDC balance"
echo "    private-deposit  — shield USDC into the privacy pool"
echo "    private-pay      — unlinkable USDC payment (burner + ZK proof)"
echo "    private-fetch    — x402 request paid privately"
echo "  ══════════════════════════════════════"
if [ "${CLAWTRL_PRIVACY_ENABLED:-}" != "true" ]; then
  echo "  Private payments are OFF. Enable with CLAWTRL_PRIVACY_ENABLED=true"
  echo "  in your .env, then restart the proxy."
  echo "  ══════════════════════════════════════"
fi
echo "  Source: $REPO"
echo ""
