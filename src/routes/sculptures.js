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

  const { name, desc, lat, lon, city, state, format, color, geomType, stlPositions, photo } = req.body;
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
    createdAt: new Date().toISOString(),
  };
  await db.insert("sculptures", sculpture);
  res.status(201).json(sculpture);
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
