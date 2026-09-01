#!/usr/bin/env bash
set -e

echo "======================================================================"
echo "🚀 PULLING LATEST V17.16 CODE ON VPS"
echo "======================================================================"

cd /home/ubuntu/quegar
git fetch origin main
git reset --hard origin/main

echo "======================================================================"
echo "📦 INSTALLING DEPENDENCIES (INCLUDING PG POOL)"
echo "======================================================================"

npm ci

echo "======================================================================"
echo "🏗️ COMPILING NEXT.JS 16 PRODUCTION BUNDLE"
echo "======================================================================"

NODE_OPTIONS='--max-old-space-size=1536' npm run build

echo "======================================================================"
echo "🔄 RESTARTING PM2 PROCESSES (QUEGAR-SERVER & QUEGAR-DAEMON)"
echo "======================================================================"

pm2 restart all --update-env
pm2 save

echo "⏳ Waiting 3 seconds for services to settle..."
sleep 3

echo "======================================================================"
echo "🔍 VERIFYING PM2 PROCESSES & ENDPOINT RESPONSES"
echo "======================================================================"

pm2 status

echo ""
echo "▶ Testing /api/telemetry..."
curl -s http://localhost:5522/api/telemetry
echo ""

echo "▶ Testing /api/daemon/state..."
curl -s http://localhost:5522/api/daemon/state | cut -c 1-120
echo ""

echo "▶ Testing /api/strategies..."
curl -s http://localhost:5522/api/strategies | cut -c 1-120
echo ""

echo "✅ VPS Deployment & Hardening Complete!"
