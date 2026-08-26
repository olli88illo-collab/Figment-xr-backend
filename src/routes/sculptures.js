const express = require("express");
const crypto = require("crypto");
const db = require("../lib/db");
const { requireAuth, requireResident } = require("../lib/auth");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();
const INSTALL_QUOTA = 3;

// Public — anyone (including guests) can browse every installed sculpture.
router.get("/", asyncHandler(async (req, res) => {
  res.json(await db.getAll("sculptures"));
}));

router.post("/", requireAuth, requireResident, asyncHandler(async (req, res) => {
  const mine = await db.getAll("sculptures", (s) => s.ownerUsername === req.auth.sub);
  if (mine.length >= INSTALL_QUOTA) {
    return res.status(403).json({ error: `Beta quota reached — ${INSTALL_QUOTA} sculptures max.` });
  }

  const { name, desc, lat, lon, city, state, format, color, geomType, stlPositions, photo, heightM } = req.body;
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

  const { name, desc, lat, lon, city, state, format, color, geomType, stlPositions, photo, heightM } = req.body;
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
