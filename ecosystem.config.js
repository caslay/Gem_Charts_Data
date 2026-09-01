/**
 * ecosystem.config.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PM2 Process Manager Configuration for Quegar Quant Engine.
 * Manages:
 *  1. quegar-server : Next.js Production Server (Port 3000 on VPS)
 *  2. quegar-daemon : 24/7 Headless Execution Daemon (Binance WS Stream)
 *  3. quegar-dev    : Localhost Dev Sandbox (Port 4000, Read-Only Guarded)
 * ─────────────────────────────────────────────────────────────────────────────
 */

module.exports = {
  apps: [
    {
      name: 'quegar-server',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 5522',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 5522,
        IS_LIVE_VPS: 'true',
      },
    },
    {
      name: 'quegar-daemon',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'scripts/headless-daemon.ts',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        IS_LIVE_VPS: 'true',
        AUTO_EXECUTE: 'true',
        TELEGRAM_ENABLED: 'true',
      },
    },
    {
      name: 'quegar-dev',
      script: 'node_modules/next/dist/bin/next',
      args: 'dev -p 4000',
      cwd: __dirname,
      instances: 1,
      autorestart: false,
      watch: false,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'development',
        PORT: 4000,
        IS_LIVE_VPS: 'false',
        READ_ONLY_LOCAL: 'true',
        AUTO_EXECUTE: 'false',
        TELEGRAM_ENABLED: 'false',
      },
    },
  ],
};
