const path = require('path');

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

module.exports = {
  port: int(process.env.PORT, 3000),
  production: process.env.NODE_ENV === 'production',
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  maxUploadBytes: 10 * 1024 * 1024,
  maxPages: 60,
  sessionDays: 30,
  llm: {
    geminiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    timeoutMs: int(process.env.LLM_TIMEOUT_MS, 30000),
  },
  google: {
    clientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  },


};

