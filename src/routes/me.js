const express = require("express");
const db = require("../lib/db");
const { requireAuth } = require("../lib/auth");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const user = await db.getOne("users", (u) => u.username === req.auth.sub);
  if (!user) return res.status(404).json({ error: "Account not found" });
  const { passwordHash, ...publicUser } = user;
  res.json(publicUser);
}));

router.patch("/", requireAuth, asyncHandler(async (req, res) => {
  const patch = {};
  if (typeof req.body.bio === "string") patch.bio = req.body.bio.slice(0, 160);
  // Avatars arrive as a data URL from the client (same as the artifact's
  // canvas-resized upload) — a real deployment should instead upload to
  // object storage (S3, R2, etc.) and store a URL here, not the raw image.
  if (typeof req.body.avatar === "string") patch.avatar = req.body.avatar;

  const updated = await db.update("users", (u) => u.username === req.auth.sub, patch);
  if (!updated) return res.status(404).json({ error: "Account not found" });
  const { passwordHash, ...publicUser } = updated;
  res.json(publicUser);
}));

// ============================================================================
// DEV/TESTING ONLY — real billing (routes/billing.js) is still a documented
// stub, so there's currently no legitimate way to grant isPro. This lets you
// (and the client's "Simulate Resident Pro" demo toggle) test the AR File
// Library end-to-end before Apple/Google verification is wired up.
//
// DELETE THIS ROUTE before shipping to real users — it lets anyone with a
// valid login grant themselves Pro for free, which is exactly the kind of
// hole real receipt verification exists to prevent.
// ============================================================================
router.post("/simulate-pro", requireAuth, asyncHandler(async (req, res) => {
  const isPro = !!req.body.isPro;
  const updated = await db.update("users", (u) => u.username === req.auth.sub, { isPro });
  if (!updated) return res.status(404).json({ error: "Account not found" });
  const { passwordHash, ...publicUser } = updated;
  res.json(publicUser);
}));

module.exports = router;
