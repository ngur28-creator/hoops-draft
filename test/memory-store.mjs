// In-memory stand-in for a Netlify Blobs store (the subset the leaderboard and duels use), for tests and local runs.
export function memoryStore() {
  const m = new Map(), tags = new Map();
  let n = 0;
  return {
    _m: m,
    async get(key, opts) { if (!m.has(key)) return null; const v = m.get(key); return opts?.type === "json" ? JSON.parse(v) : v; },
    async getWithMetadata(key, opts) { if (!m.has(key)) return null; const v = m.get(key); return { data: opts?.type === "json" ? JSON.parse(v) : v, etag: tags.get(key), metadata: {} }; },
    async setJSON(key, value, opts = {}) { return this.set(key, JSON.stringify(value), opts); },
    async set(key, value, opts = {}) {
      if (opts.onlyIfNew && m.has(key)) return { modified: false };
      if (opts.onlyIfMatch !== undefined && tags.get(key) !== opts.onlyIfMatch) return { modified: false };
      const etag = `"${++n}"`;
      m.set(key, String(value)); tags.set(key, etag);
      return { modified: true, etag };
    },
    async delete(key) { m.delete(key); tags.delete(key); },
    async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key, etag: tags.get(key) })), directories: [] }; },
  };
}
