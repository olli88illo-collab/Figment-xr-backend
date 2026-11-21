// Star ratings (1 to 5) for installations. Own small table, so no other file has to change.
// One rating per person: a signed-in Resident is counted by username, a Visitor by an anonymous id the app makes up.
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

let ready = null;
function init() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS ratings (
        sculpture_id TEXT NOT NULL,
        rater TEXT NOT NULL,
        stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (sculpture_id, rater)
      )`).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function rate(sculptureId, rater, stars) {
  await init();
  await pool.query(
    `INSERT INTO ratings (sculpture_id, rater, stars) VALUES ($1,$2,$3)
     ON CONFLICT (sculpture_id, rater) DO UPDATE SET stars = EXCLUDED.stars, updated_at = now()`,
    [sculptureId, rater, stars]
  );
  return summary(sculptureId);
}

async function summary(sculptureId) {
  await init();
  const { rows } = await pool.query("SELECT AVG(stars)::float AS avg, COUNT(*)::int AS n FROM ratings WHERE sculpture_id = $1", [sculptureId]);
  const r = rows[0] || {};
  return { avg: r.n ? Math.round(r.avg * 10) / 10 : 0, count: r.n || 0 };
}

/** Every installation's rating in one query: Map of sculpture id -> { avg, count }. */
async function summaries() {
  await init();
  const { rows } = await pool.query("SELECT sculpture_id, AVG(stars)::float AS avg, COUNT(*)::int AS n FROM ratings GROUP BY sculpture_id");
  const m = new Map();
  for (const r of rows) m.set(r.sculpture_id, { avg: Math.round(r.avg * 10) / 10, count: r.n });
  return m;
}

/** Adds ratingAvg / ratingCount to a list of installations (never fails the request if ratings are unavailable). */
async function attach(list) {
  let m;
  try { m = await summaries(); } catch (e) { console.error("ratings unavailable", e.message); return list; }
  return list.map((s) => { const r = m.get(s.id); return r ? { ...s, ratingAvg: r.avg, ratingCount: r.count } : s; });
}

module.exports = { rate, summary, summaries, attach };
