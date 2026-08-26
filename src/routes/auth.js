const express = require("express");
const db = require("../lib/db");
const { hashPassword, verifyPassword, issueToken } = require("../lib/auth");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

// Only Residents ever hit this — Visitors browse without an account, same
// as the client already does. This endpoint doesn't accept a "visitor"
// role signup at all, so the database only ever gains Resident accounts.
router.post("/signup", asyncHandler(async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: "Username must be 3-24 characters: lowercase letters, numbers, underscore, or period." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  if (await db.getOne("users", (u) => u.username === username)) {
    return res.status(409).json({ error: "That username is already taken." });
  }

  const passwordHash = await hashPassword(password);
  const user = {
    username,
    passwordHash,
    role: "resident",
    isPro: false,
    bio: "",
    avatar: null,
    joined: new Date().toISOString(),
  };
  await db.insert("users", user);

  const token = issueToken(user);
  res.status(201).json({ token, user: publicUser(user) });
}));

router.post("/login", asyncHandler(async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = await db.getOne("users", (u) => u.username === username);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Username or password is incorrect." });
  }

  const token = issueToken(user);
  res.json({ token, user: publicUser(user) });
}));

function publicUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

module.exports = router;
