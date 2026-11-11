/**
 * PM2 Ecosystem Configuration
 * Deploy and manage multiple Node.js processes in cluster mode
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 start ecosystem.config.js --only production
 *   pm2 logs
 *   pm2 monit
 *   pm2 kill && pm2 start ecosystem.config.js
 */

const os = require('os');
const path = require('path');

const numWorkers = parseInt(process.env.WORKERS || os.cpus().length, 10);
const env = process.env.NODE_ENV || 'production';

module.exports = {
  apps: [
    {
      // Application name
      name: 'manawa-api',
      script: path.join(__dirname, 'backend', 'index.js'),

      // Execution mode: cluster for horizontal scaling
      exec_mode: 'cluster',
      instances: numWorkers,

      // Cluster options
      merge_logs: true,
      autorestart: true,
      watch: false,

      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 4000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
      },

      // Resource limits
      max_memory_restart: '512M',

      // Restart policy
      max_restarts: 10,
      min_uptime: '30s',

      // Graceful shutdown
      listen_timeout: 10000,
      kill_timeout: 5000,

      // Logging
      output: path.join(__dirname, 'logs', 'out.log'),
      error: path.join(__dirname, 'logs', 'error.log'),

      // Increment port for each worker
      increment_var: 'PORT',
      port_increment: 100,

      // Arguments
      args: [],

      // Node options
      node_args: [
        '--max-old-space-size=512',
        '--enable-source-maps',
      ],

      // Ignore patterns
      ignore_watch: [
        'node_modules',
        'logs',
        'uploads',
        '.git',
        'dist',
      ],

      // Watch directories (disabled by default to reduce overhead)
      watch: false,

      // Monitoring
      max_memory_restart: '512M',

      // Stop timeout
      stop_exit_codes: [0],
    },
  ],

  // Deployment configuration (optional)
  deploy: {
    production: {
      user: 'nodejs',
      host: 'your-server-ip',
      ref: 'origin/main',
      repo: 'https://github.com/manawa/backend.git',
      path: '/home/nodejs/manawa',
      'post-deploy': 'npm install && npm run migrate && pm2 reload ecosystem.config.js --env production',
      'pre-deploy-local': 'echo "Deploying to production"',
    },
  },
};
