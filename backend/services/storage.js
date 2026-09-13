const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Content-addressed storage: the sha256 IS the filename, so identical
// uploads from the same user are naturally deduplicated (see the
// UNIQUE(user_id, sha256) constraint on documents) and a stored file can
// never be path-traversed to since the name is a hex digest we compute.
function createStorage(dataDir) {
  const dir = path.join(dataDir, 'uploads');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }

  return {
    save(buffer) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        /* ignore */
      }
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const key = `${sha256}.pdf`;
      const target = path.join(dir, key);
      if (!fs.existsSync(target)) fs.writeFileSync(target, buffer);
      return { key, sha256 };
    },
    read(key) {
      if (!/^[0-9a-f]{64}\.pdf$/.test(key)) throw new Error('invalid storage key');
      return fs.readFileSync(path.join(dir, key));
    },
  };
}

module.exports = { createStorage };
