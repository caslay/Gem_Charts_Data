/**
 * ecosystem.config.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PM2 Process Manager Configuration for Flow-State Local Headless Daemon.
 * ─────────────────────────────────────────────────────────────────────────────
 */

module.exports = {
  apps: [
    {
      name: 'flow-state-local',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'scripts/headless-daemon.ts',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8681842826:AAE_ya3wQ_IABtCXHofLDppNjOAyRDTdcVs',
        TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '1553743624',
        TELEGRAM_ENABLED: 'true',
      },
    },
  ],
};
