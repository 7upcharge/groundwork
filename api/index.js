const path = require('path');

// Ensure writable temporary directory on serverless platforms (Vercel)
if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = '/tmp';
}

const { createApp } = require('../backend/app');
const { app } = createApp();

module.exports = app;
