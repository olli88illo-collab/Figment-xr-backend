const express = require("express");
const db = require("../lib/db");
const { hashPassword, verifyPassword, issueToken } = require("../lib/auth");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

// Only Residents ever hit this — Visitors browse without an account, same
// as the client already does. This endpoint doesn't accept a "visitor"
// role signup at all, so the database only ever gains Resident accounts.
// The six Resident levels. Patron and Collector can look around, follow and talk to artists;
// Artist, Gallery, Museum, Business and Gamer can also install installations.
const LEVELS = ["patron", "collector", "artist", "gallery", "museum", "business", "gamer"];
const ORG_LEVELS = ["gallery", "museum", "business"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

router.post("/signup", asyncHandler(async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const level = String(req.body.level || "artist").trim().toLowerCase();
  const email = String(req.body.email || "").trim().toLowerCase();
  const orgName = String(req.body.orgName || "").trim().slice(0, 80);
  let website = String(req.body.website || "").trim().slice(0, 200);
  // Optional first name: used only for the welcome greeting, never shown to other people.
  const firstName = String(req.body.firstName || "").replace(/[<>]/g, "").trim().slice(0, 30);

  if (!LEVELS.includes(level)) {
    return res.status(400).json({ error: "Choose a membership level." });
  }
  // Every Resident must accept the Terms and Conditions; the date and version are kept on the account.
  if (req.body.acceptTerms !== true) {
    return res.status(400).json({ error: "You must read and agree to the Terms and Conditions to register." });
  }
  const termsVersion = String(req.body.termsVersion || "").slice(0, 20);
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: "Username must be 3-24 characters: lowercase letters, numbers, underscore, or period." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  if (!EMAIL_RE.test(email) || email.length > 120) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (ORG_LEVELS.includes(level) && orgName.length < 2) {
    return res.status(400).json({ error: "Enter the name of your " + level + "." });
  }
  if (website && !/^https?:\/\//i.test(website)) website = "https://" + website;
  if (await db.getOne("users", (u) => u.username === username)) {
    return res.status(409).json({ error: "That username is already taken." });
  }
  if (await db.getOne("users", (u) => String(u.email || "").toLowerCase() === email)) {
    return res.status(409).json({ error: "That email address already has an account." });
  }

  const passwordHash = await hashPassword(password);
  const user = {
    username,
    passwordHash,
    role: "resident",
    level,
    email,
    firstName,
    orgName: ORG_LEVELS.includes(level) ? orgName : "",
    website: ORG_LEVELS.includes(level) ? website : "",
    // Nothing is charged for now: every level is free during the beta.
    paymentStatus: "free",
    isPro: false,
    bio: "",
    avatar: null,
    joined: new Date().toISOString(),
    termsAcceptedAt: new Date().toISOString(),
    termsVersion,
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
  if (!rest.level) rest.level = "artist";   // accounts made before levels existed
  return rest;
}

module.exports = router;
