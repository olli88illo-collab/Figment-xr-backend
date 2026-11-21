const express = require("express");
const db = require("../lib/db");
const { hashPassword, verifyPassword, issueToken } = require("../lib/auth");
const asyncHandler = require("../lib/asyncHandler");
const reports = require("../lib/reports");

const router = express.Router();

const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

// Only Residents ever hit this — Visitors browse without an account, same
// as the client already does. This endpoint doesn't accept a "visitor"
// role signup at all, so the database only ever gains Resident accounts.
// The six Resident levels. Patron and Collector can look around, follow and talk to artists;
// Artist, Gallery, Museum, Business and Gamer can also install installations.
const LEVELS = ["patron", "collector", "artist", "gallery", "museum", "business", "gamer", "architect"];
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

// ---- Contact FigmentXR: the app posts the message (and any attachments) here; we email it to the FigmentXR inbox ----
// Sent through Resend (https://resend.com). Settings (Render -> Environment):
//   RESEND_API_KEY  (required)   CONTACT_TO (default Contact@figmentxr.com)   CONTACT_FROM (a sender on your verified domain)
const CONTACT_MAX_FILES = 10;
const CONTACT_MAX_BYTES = 15 * 1024 * 1024;               // total size of all attachments
const BLOCKED_EXT = /\.(exe|bat|cmd|com|scr|msi|apk|jar|js|vbs|ps1|sh|dll|lnk|iso|dmg)$/i;
const contactHits = new Map();                           // address -> recent send times (simple spam limit)

router.post("/contact", asyncHandler(async (req, res) => {
  const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
  const now = Date.now();
  const recent = (contactHits.get(ip) || []).filter(ts => now - ts < 60 * 60 * 1000);
  if (recent.length >= 5) return res.status(429).json({ error: "You have sent several messages recently. Please try again in an hour." });

  const replyTo = String(req.body.email || "").trim().slice(0, 200);
  const subject = String(req.body.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 120) || "Message from the FigmentXR app";
  const message = String(req.body.message || "").trim().slice(0, 5000);
  if (!EMAIL_RE.test(replyTo)) return res.status(400).json({ error: "Please enter your email address so we can reply." });
  if (!message) return res.status(400).json({ error: "Please write a message first." });

  // Signed-in Residents: include their username (the token is optional)
  let who = "Visitor (not signed in)";
  try {
    const h = req.headers.authorization || "";
    if (h.startsWith("Bearer ")) {
      const payload = require("jsonwebtoken").verify(h.slice(7), process.env.JWT_SECRET);
      if (payload && payload.sub) who = "Resident @" + String(payload.sub);
    }
  } catch (e) { /* not signed in: fine */ }

  const files = Array.isArray(req.body.attachments) ? req.body.attachments : [];
  if (files.length > CONTACT_MAX_FILES) return res.status(400).json({ error: "You can attach up to " + CONTACT_MAX_FILES + " files." });
  let total = 0;
  const attachments = [];
  for (const f of files) {
    const filename = String((f && f.filename) || "file").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 100) || "file";
    const content = String((f && f.data) || "");
    if (!content) continue;
    if (BLOCKED_EXT.test(filename)) return res.status(400).json({ error: "“" + filename + "” is a file type we can’t accept. Please send it as a .zip or a link instead." });
    total += Math.floor(content.length * 3 / 4);
    if (total > CONTACT_MAX_BYTES) return res.status(413).json({ error: "Attachments are over 15 MB in total. Please send fewer or smaller files." });
    attachments.push({ filename, content });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Email isn’t set up on the server yet. Please try again later." });
  const to = process.env.CONTACT_TO || "Contact@figmentxr.com";
  const from = process.env.CONTACT_FROM || "FigmentXR App <onboarding@resend.dev>";

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [to], reply_to: replyTo, subject: "[FigmentXR app] " + subject,
      text: message + "\n\n—\nFrom: " + replyTo + "\n" + who + "\nSent from the FigmentXR app",
      attachments,
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.error("contact email failed", r.status, detail.slice(0, 300));
    return res.status(502).json({ error: "We couldn’t send your message just now. Please try again in a moment." });
  }
  recent.push(now); contactHits.set(ip, recent);
  res.json({ ok: true });
}));

// ---- Report an installation: saved for the admin to review, and emailed to the FigmentXR inbox ----
const REPORT_REASONS = ["Inappropriate or not family friendly", "Harassment", "Copyright or someone else’s work", "Dangerous or private location", "Other"];
const reportHits = new Map();

router.post("/report", asyncHandler(async (req, res) => {
  const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
  const now = Date.now();
  const recent = (reportHits.get(ip) || []).filter(ts => now - ts < 60 * 60 * 1000);
  if (recent.length >= 10) return res.status(429).json({ error: "You have sent several reports recently. Please try again later." });

  const sculptureId = String(req.body.sculptureId || "").slice(0, 100);
  const reason = String(req.body.reason || "").slice(0, 100);
  const note = String(req.body.note || "").trim().slice(0, 1000);
  if (!sculptureId) return res.status(400).json({ error: "Which installation? Please try again." });
  if (!REPORT_REASONS.includes(reason)) return res.status(400).json({ error: "Please choose a reason." });

  const s = await db.getOne("sculptures", (x) => x.id === sculptureId);
  if (!s) return res.status(404).json({ error: "That installation no longer exists." });

  let reporter = "Visitor";
  try {
    const h = req.headers.authorization || "";
    if (h.startsWith("Bearer ")) {
      const p = require("jsonwebtoken").verify(h.slice(7), process.env.JWT_SECRET);
      if (p && p.sub) reporter = "@" + String(p.sub);
    }
  } catch (e) { /* not signed in: fine */ }

  await reports.add({ sculptureId, sculptureName: s.name, owner: s.ownerUsername, reason, note, reporter });
  recent.push(now); reportHits.set(ip, recent);

  // Email a copy (best effort: the report is already saved even if the email fails)
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.CONTACT_FROM || "FigmentXR App <onboarding@resend.dev>",
          to: [process.env.CONTACT_TO || "Contact@figmentxr.com"],
          subject: "[FigmentXR report] " + String(s.name || "Installation").replace(/[\r\n]+/g, " ").slice(0, 80),
          text: "Installation: " + s.name + "\nID: " + sculptureId + "\nOwner: @" + (s.ownerUsername || "unknown") +
                "\nReason: " + reason + "\nNote: " + (note || "(none)") + "\nReported by: " + reporter +
                "\n\nReview and delete it in the FigmentXR admin area if it breaks the rules.",
        }),
      });
    } catch (e) { console.error("report email failed", e.message); }
  }
  console.log(`[report] ${reporter} reported "${s.name}" (${sculptureId}): ${reason}`);
  res.json({ ok: true });
}));

module.exports = router;
