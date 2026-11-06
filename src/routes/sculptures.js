const express = require("express");
const crypto = require("crypto");
const db = require("../lib/db");
const { requireAuth, requireResident } = require("../lib/auth");
const asyncHandler = require("../lib/asyncHandler");
const { distanceM } = require("../lib/geo");
const storage = require("../lib/storage");

const router = express.Router();
const INSTALL_QUOTA = 3;

// Public — anyone (including guests) can browse every installed sculpture.
router.get("/", asyncHandler(async (req, res) => {
  res.json(await db.getAll("sculptures"));
}));

// Public — the sculptures near a spot, closest first. This is what the app calls when you arrive somewhere.
//   GET /api/sculptures/nearby?lat=40.1386&lon=-74.2591&radius=300
// radius is in metres (default 300, at most 5000). The list is light: big geometry and photos are left out;
// fetch one sculpture's full record with GET /api/sculptures/:id when you want to show it.
router.get("/nearby", asyncHandler(async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: "lat and lon are required numbers." });
  }
  const radius = Math.min(5000, Math.max(10, parseFloat(req.query.radius) || 300));
  const rows = await db.nearbyBox(lat, lon, radius);
  const out = [];
  for (const s of rows) {
    const d = distanceM(lat, lon, s.lat, s.lon);
    if (d > radius) continue;
    const { stlPositions, photo, ...light } = s;
    out.push({ ...light, hasStl: Array.isArray(stlPositions) && stlPositions.length > 0, distanceM: Math.round(d) });
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  res.json(out);
}));

// A signed-in Resident asks for permission to upload one .glb file; see lib/storage.js.
router.post("/upload-url", requireAuth, requireResident, asyncHandler(async (req, res) => {
  try {
    res.json(await storage.createGlbUpload());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}));

// Public — one sculpture's full record (including geometry for older, non-GLB sculptures).
router.get("/:id", asyncHandler(async (req, res) => {
  const s = await db.getOne("sculptures", (x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json(s);
}));

router.post("/", requireAuth, requireResident, asyncHandler(async (req, res) => {
  const mine = await db.getAll("sculptures", (s) => s.ownerUsername === req.auth.sub);
  if (mine.length >= INSTALL_QUOTA) {
    return res.status(403).json({ error: `Beta quota reached — ${INSTALL_QUOTA} sculptures max.` });
  }

  const { name, desc, lat, lon, city, state, format, color, geomType, stlPositions, photo, heightM, glbUrl, rotationDeg, heightOffset } = req.body;
  if (!name || typeof lat !== "number" || typeof lon !== "number") {
    return res.status(400).json({ error: "name, lat, and lon are required." });
  }

  const sculpture = {
    id: crypto.randomUUID(),
    ownerUsername: req.auth.sub,
    name: String(name).slice(0, 80),
    desc: String(desc || "").slice(0, 400),
    lat, lon,
    city: city || null,
    state: state || null,
    format: format || "primitive",
    color: color || "#5FE1FF",
    geomType: geomType || "bloom",
    stlPositions: Array.isArray(stlPositions) ? stlPositions : null,
    photo: typeof photo === "string" ? photo : null,
    heightM: (typeof heightM === "number" && heightM > 0) ? heightM : 2,
    // The artist's model file (GLB) and how it was placed on site (turned from true north, raised / lowered in metres).
    glbUrl: typeof glbUrl === "string" && /^https:\/\//.test(glbUrl) ? glbUrl : null,
    rotationDeg: typeof rotationDeg === "number" ? rotationDeg : 0,
    heightOffset: typeof heightOffset === "number" ? heightOffset : 0,
    createdAt: new Date().toISOString(),
  };
  await db.insert("sculptures", sculpture);
  res.status(201).json(sculpture);
}));

router.patch("/:id", requireAuth, asyncHandler(async (req, res) => {
  const existing = await db.getOne(
    "sculptures",
    (s) => s.id === req.params.id && s.ownerUsername === req.auth.sub
  );
  if (!existing) return res.status(404).json({ error: "Not found (or not yours)" });

  const { name, desc, lat, lon, city, state, format, color, geomType, stlPositions, photo, heightM, glbUrl, rotationDeg, heightOffset } = req.body;
  const patch = {};
  if (name !== undefined) patch.name = String(name).slice(0, 80);
  if (desc !== undefined) patch.desc = String(desc || "").slice(0, 400);
  if (typeof lat === "number") patch.lat = lat;
  if (typeof lon === "number") patch.lon = lon;
  if (city !== undefined) patch.city = city || null;
  if (state !== undefined) patch.state = state || null;
  if (format !== undefined) patch.format = format;
  if (color !== undefined) patch.color = color;
  if (geomType !== undefined) patch.geomType = geomType;
  if (stlPositions !== undefined) patch.stlPositions = Array.isArray(stlPositions) ? stlPositions : null;
  if (photo !== undefined) patch.photo = typeof photo === "string" ? photo : null;
  if (typeof heightM === "number" && heightM > 0) patch.heightM = heightM;
  if (typeof glbUrl === "string" && /^https:\/\//.test(glbUrl)) patch.glbUrl = glbUrl;
  if (typeof rotationDeg === "number") patch.rotationDeg = rotationDeg;
  if (typeof heightOffset === "number") patch.heightOffset = heightOffset;

  const updated = await db.update(
    "sculptures",
    (s) => s.id === req.params.id && s.ownerUsername === req.auth.sub,
    patch
  );
  res.json(updated);
}));

router.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  const removed = await db.remove(
    "sculptures",
    (s) => s.id === req.params.id && s.ownerUsername === req.auth.sub
  );
  if (!removed) return res.status(404).json({ error: "Not found (or not yours)" });
  res.status(204).end();
}));

module.exports = router;
