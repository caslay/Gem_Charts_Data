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
      },
    },
  ],
};
