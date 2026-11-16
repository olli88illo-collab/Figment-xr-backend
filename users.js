const express = require("express");
const db = require("../lib/db");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

// Public: anyone can look up an artist's name, bio and picture.
// Nothing private is ever returned (no password hash, no account flags).
router.get("/:username", asyncHandler(async (req, res) => {
  const username = String(req.params.username || "").trim().toLowerCase();
  const user = await db.getOne("users", (u) => u.username === username);
  if (!user) return res.status(404).json({ error: "Artist not found" });
  res.json({
    username: user.username,
    bio: user.bio || "",
    avatar: user.avatar || null,
    joined: user.joined || null,
  });
}));

module.exports = router;
