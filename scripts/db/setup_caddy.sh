#!/usr/bin/env bash
set -e

echo "======================================================================"
echo "⚙️ CONFIGURING CADDYFILE FOR QUEGAR DOMAINS"
echo "======================================================================"

sudo tee /etc/caddy/Caddyfile > /dev/null << 'EOF'
# =====================================================================
# 🏛️ QUEGAR QUANT ENGINE — CADDY STEALTH EDGE REVERSE PROXY
# =====================================================================

quegar.com {
    header Content-Type application/json
    header Cache-Control "no-store, max-age=0"
    header X-Content-Type-Options nosniff
    respond `{"status":"healthy","service":"telemetry-node","region":"ap-northeast-1"}` 200
}

core.quegar.com {
    reverse_proxy localhost:5522
}

mcp.quegar.com {
    reverse_proxy localhost:5522
}
EOF

sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile

echo "======================================================================"
echo "🚀 ENABLING & RESTARTING CADDY SERVICE"
echo "======================================================================"

sudo systemctl enable --now caddy
sudo systemctl restart caddy

echo "✅ Caddy Edge Reverse Proxy is fully deployed and active!"
