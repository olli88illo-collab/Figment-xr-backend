// Real, persistent data layer backed by Postgres — replaces the earlier
// JSON-file version, which turned out to be a dead end on most free
// hosting: platforms like Render's free tier wipe local disk on every
// restart/redeploy/sleep cycle, so files written there don't survive.
//
// Every route file only ever calls the functions exported here
// (getAll/getOne/insert/update/remove), same names and shapes as before —
// they're just async now, since real DB queries are. That's the only
// ripple effect on the rest of the codebase.
//
// Storage model: each "collection" (users/sculptures/files) is a table
// with an id and a single JSONB column holding the whole record. This
// keeps the migration small and low-risk rather than redesigning a full
// relational schema — filtering happens in JS after fetching, exactly
// like the file-based version did. Fine at this app's scale; revisit if
// it ever needs to filter millions of rows efficiently.

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Most free Postgres providers (Neon, Supabase, etc.) require SSL and
  // use certificates that Node's default strict check doesn't recognize.
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

const COLLECTIONS = ["users", "sculptures", "files"];

let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      for (const name of COLLECTIONS) {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ${name} (
            id SERIAL PRIMARY KEY,
            data JSONB NOT NULL
          )
        `);
      }
      // Fast "what is near me" lookups: an index on the sculptures' latitude / longitude.
      // Wrapped so a bad old row can never stop the server from starting.
      try {
        await pool.query(`
          CREATE INDEX IF NOT EXISTS sculptures_geo_idx
          ON sculptures (((data->>'lat')::float8), ((data->>'lon')::float8))
        `);
      } catch (e) {
        console.warn("Could not create the sculptures geo index:", e.message);
      }
    })();
  }
  return readyPromise;
}

async function getAll(collection, filterFn) {
  await ready();
  const res = await pool.query(`SELECT data FROM ${collection}`);
  const rows = res.rows.map((r) => r.data);
  return filterFn ? rows.filter(filterFn) : rows;
}

async function getOne(collection, filterFn) {
  const rows = await getAll(collection);
  return rows.find(filterFn) || null;
}

async function insert(collection, row) {
  await ready();
  await pool.query(`INSERT INTO ${collection} (data) VALUES ($1)`, [JSON.stringify(row)]);
  return row;
}

async function update(collection, filterFn, patch) {
  await ready();
  const res = await pool.query(`SELECT id, data FROM ${collection}`);
  const match = res.rows.find((r) => filterFn(r.data));
  if (!match) return null;
  const updated = Object.assign({}, match.data, patch);
  await pool.query(`UPDATE ${collection} SET data = $1 WHERE id = $2`, [JSON.stringify(updated), match.id]);
  return updated;
}

async function remove(collection, filterFn) {
  await ready();
  const res = await pool.query(`SELECT id, data FROM ${collection}`);
  const toRemove = res.rows.filter((r) => filterFn(r.data)).map((r) => r.id);
  if (!toRemove.length) return 0;
  await pool.query(`DELETE FROM ${collection} WHERE id = ANY($1)`, [toRemove]);
  return toRemove.length;
}

/**
 * Sculptures inside a square around (lat, lon), found with the geo index (no full-table scan).
 * Returns the whole records; the caller trims them and sorts by exact distance.
 */
async function nearbyBox(lat, lon, radiusM) {
  await ready();
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const res = await pool.query(
    `SELECT data FROM sculptures
     WHERE (data->>'lat')::float8 BETWEEN $1 AND $2
       AND (data->>'lon')::float8 BETWEEN $3 AND $4`,
    [lat - dLat, lat + dLat, lon - dLon, lon + dLon]
  );
  return res.rows.map((r) => r.data);
}

module.exports = { getAll, getOne, insert, update, remove, nearbyBox };
