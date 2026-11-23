// Counts how many different people have downloaded each installation. Own small table, so no other file has to change.
// One count per person: a signed-in Resident by username, a Visitor by an anonymous id the app makes up. The artist's own downloads are not counted.
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

let ready = null;
function init() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS downloads (
        sculpture_id TEXT NOT NULL,
        who TEXT NOT NULL,
        first_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (sculpture_id, who)
      )`).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function record(sculptureId, who) {
  await init();
  await pool.query("INSERT INTO downloads (sculpture_id, who) VALUES ($1,$2) ON CONFLICT DO NOTHING", [sculptureId, who]);
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM downloads WHERE sculpture_id = $1", [sculptureId]);
  return rows[0].n;
}

async function counts() {
  await init();
  const { rows } = await pool.query("SELECT sculpture_id, COUNT(*)::int AS n FROM downloads GROUP BY sculpture_id");
  return new Map(rows.map((r) => [r.sculpture_id, r.n]));
}

/** Adds downloadCount to a list of installations (never fails the request if the counter is unavailable). */
async function attach(list) {
  let m;
  try { m = await counts(); } catch (e) { console.error("downloads unavailable", e.message); return list; }
  return list.map((s) => ({ ...s, downloadCount: m.get(s.id) || 0 }));
}

module.exports = { record, counts, attach };
