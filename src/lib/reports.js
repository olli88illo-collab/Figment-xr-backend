// Reports about installations ("Report this installation" in the app). Stored in their own small table, so no other file has to change.
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

let ready = null;
function init() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        sculpture_id TEXT NOT NULL,
        sculpture_name TEXT,
        owner TEXT,
        reason TEXT NOT NULL,
        note TEXT,
        reporter TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function add(r) {
  await init();
  await pool.query(
    "INSERT INTO reports (sculpture_id, sculpture_name, owner, reason, note, reporter) VALUES ($1,$2,$3,$4,$5,$6)",
    [r.sculptureId, r.sculptureName || null, r.owner || null, r.reason, r.note || null, r.reporter || null]
  );
}

async function list() {
  await init();
  const { rows } = await pool.query("SELECT * FROM reports ORDER BY created_at DESC LIMIT 500");
  return rows.map((x) => ({
    id: x.id, sculptureId: x.sculpture_id, sculptureName: x.sculpture_name, owner: x.owner,
    reason: x.reason, note: x.note, reporter: x.reporter, createdAt: x.created_at,
  }));
}

async function remove(id) {
  await init();
  await pool.query("DELETE FROM reports WHERE id = $1", [id]);
}

module.exports = { add, list, remove };
