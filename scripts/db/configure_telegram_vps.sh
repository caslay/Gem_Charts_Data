#!/usr/bin/env bash
set -e

echo "======================================================================"
echo "🤖 CONFIGURING TELEGRAM BOT INTEGRATION ON VPS"
echo "======================================================================"

TOKEN="${1:-$TELEGRAM_BOT_TOKEN}"
CHAT_ID="${2:-$TELEGRAM_CHAT_ID}"

if [ -z "$TOKEN" ] || [ -z "$CHAT_ID" ]; then
  echo "Usage: ./configure_telegram_vps.sh <BOT_TOKEN> <CHAT_ID>"
  exit 1
fi

cd /home/ubuntu/quegar
git fetch origin main
git reset --hard origin/main

# Update or append Telegram configuration in .env.production
sed -i '/TELEGRAM_ENABLED=/d' .env.production
sed -i '/TELEGRAM_BOT_TOKEN=/d' .env.production
sed -i '/TELEGRAM_LIVE_BOT_TOKEN=/d' .env.production
sed -i '/TELEGRAM_CHAT_ID=/d' .env.production

cat << EOF >> .env.production

# 4. Telegram Live Bot Configuration
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN="${TOKEN}"
TELEGRAM_LIVE_BOT_TOKEN="${TOKEN}"
TELEGRAM_CHAT_ID="${CHAT_ID}"
EOF

cp .env.production .env.local
chmod 600 .env.production .env.local

echo "✅ Environment files updated with Telegram Bot credentials!"

echo "======================================================================"
echo "🚀 RESTARTING QUEGAR-DAEMON IN PM2 WITH LIVE TELEGRAM POLLING"
echo "======================================================================"

pm2 restart quegar-daemon --update-env
pm2 save

echo "⏳ Waiting 3 seconds for daemon socket re-connection..."
sleep 3

echo "======================================================================"
echo "📡 DISPATCHING LIVE STARTUP HANDSHAKE TEST MESSAGE & KEYBOARD"
echo "======================================================================"

npx tsx scripts/test-telegram-commands.ts

echo "======================================================================"
echo "🔍 VERIFYING PM2 DAEMON LOGS"
echo "======================================================================"

pm2 logs quegar-daemon --lines 20 --nostream

echo "✅ Telegram Bot successfully paired and operational on VPS!"
