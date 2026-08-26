const express = require("express");
const crypto = require("crypto");
const db = require("../lib/db");
const { requireAuth, requireResident } = require("../lib/auth");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

// The actual paywall check now lives here — server-side — instead of a
// client-side toggle. isPro is only ever set true by the billing routes,
// after a verified purchase (see routes/billing.js).
const requirePro = asyncHandler(async (req, res, next) => {
  const user = await db.getOne("users", (u) => u.username === req.auth.sub);
  if (!user || !user.isPro) {
    return res.status(402).json({ error: "Resident Pro required", code: "UPGRADE_REQUIRED" });
  }
  next();
});

router.get("/", requireAuth, requireResident, requirePro, asyncHandler(async (req, res) => {
  res.json(await db.getAll("files", (f) => f.ownerUsername === req.auth.sub));
}));

router.post("/", requireAuth, requireResident, requirePro, asyncHandler(async (req, res) => {
  const { name, format, color, geomType, stlPositions } = req.body;
  if (!name) return res.status(400).json({ error: "name is required." });

  const file = {
    id: crypto.randomUUID(),
    ownerUsername: req.auth.sub,
    name: String(name).slice(0, 80),
    format: format || "file",
    color: color || "#5FE1FF",
    geomType: geomType || "bloom",
    stlPositions: Array.isArray(stlPositions) ? stlPositions : null,
    createdAt: new Date().toISOString(),
  };
  await db.insert("files", file);
  res.status(201).json(file);
}));

router.delete("/:id", requireAuth, requireResident, asyncHandler(async (req, res) => {
  const removed = await db.remove(
    "files",
    (f) => f.id === req.params.id && f.ownerUsername === req.auth.sub
  );
  if (!removed) return res.status(404).json({ error: "Not found (or not yours)" });
  res.status(204).end();
}));

module.exports = router;
