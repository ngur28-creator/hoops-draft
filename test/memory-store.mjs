// In-memory stand-in for a Netlify Blobs store (the subset the leaderboard uses), for tests and local runs.
export function memoryStore() {
  const m = new Map();
  return {
    _m: m,
    async get(key, opts) { if (!m.has(key)) return null; const v = m.get(key); return opts?.type === "json" ? JSON.parse(v) : v; },
    async setJSON(key, value, opts = {}) { return this.set(key, JSON.stringify(value), opts); },
    async set(key, value, opts = {}) {
      if (opts.onlyIfNew && m.has(key)) return { modified: false };
      m.set(key, String(value)); return { modified: true, etag: String(Math.random()) };
    },
    async delete(key) { m.delete(key); },
    async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key, etag: "x" })), directories: [] }; },
  };
}
