// Admin area for FigmentXR staff: log in, review installations and users, delete the ones that don't meet FigmentXR standards.
//
// Security notes:
//  - The admin login is NOT a normal user account. Its name and password come from the server's environment settings
//    (ADMIN_USERNAME, ADMIN_PASSWORD), so nobody can become admin by signing up.
//  - Admin tokens last 8 hours and carry role "admin"; normal users can never get that role.
//  - Failed logins are limited: 5 wrong tries from one address locks that address out for 15 minutes.
//  - Every delete is written to the server log (who, what, when).
const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../lib/db");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || "").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_ENABLED = ADMIN_USERNAME.length >= 3 && ADMIN_PASSWORD.length >= 12;
if (!ADMIN_ENABLED) {
  console.warn("Admin area is OFF: set ADMIN_USERNAME (3+ characters) and ADMIN_PASSWORD (12+ characters) to turn it on.");
}

function safeEqual(a, b) {
  // Compare fixed-length hashes so the check takes the same time however much of the guess is right.
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---- failed-login limiter (in memory: resets when the server restarts, which is fine) ----
const fails = new Map(); // ip -> { n, until }
function lockedOut(ip) {
  const f = fails.get(ip);
  return !!(f && f.until && f.until > Date.now());
}
function noteFail(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  if (f.until && f.until <= Date.now()) { f.n = 0; f.until = 0; }
  f.n += 1;
  if (f.n >= 5) f.until = Date.now() + 15 * 60 * 1000;
  fails.set(ip, f);
}

router.post("/login", asyncHandler(async (req, res) => {
  if (!ADMIN_ENABLED) return res.status(503).json({ error: "Admin login is not set up on this server." });
  const ip = req.ip || "unknown";
  if (lockedOut(ip)) return res.status(429).json({ error: "Too many wrong tries. Try again in 15 minutes." });

  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const okUser = safeEqual(username.toLowerCase(), ADMIN_USERNAME.toLowerCase());
  const okPass = safeEqual(password, ADMIN_PASSWORD);
  if (!(okUser && okPass)) {
    noteFail(ip);
    console.warn(`[admin] failed login from ${ip}`);
    return res.status(401).json({ error: "Username or password is incorrect." });
  }
  fails.delete(ip);
  console.log(`[admin] login ok from ${ip}`);
  const token = jwt.sign({ sub: `admin:${ADMIN_USERNAME}`, role: "admin" }, process.env.JWT_SECRET, { expiresIn: "8h" });
  res.json({ token });
}));

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Please log in." });
  try {
    const auth = jwt.verify(token, process.env.JWT_SECRET);
    if (auth.role !== "admin") return res.status(403).json({ error: "Admins only." });
    req.admin = auth.sub;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

// ---- installations ----
router.get("/sculptures", requireAdmin, asyncHandler(async (req, res) => {
  const list = await db.getAll("sculptures");
  list.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  res.json(list.map((s) => ({
    id: s.id, name: s.name, desc: s.desc || "", owner: s.ownerUsername || "",
    city: s.city || "", state: s.state || "", lat: s.lat, lon: s.lon,
    createdAt: s.createdAt || null, forSale: !!s.forSale, hasModel: !!(s.glbUrl || s.videoUrl || s.format === "glb"),
    photo: typeof s.photo === "string" ? s.photo : null,
  })));
}));

router.delete("/sculptures/:id", requireAdmin, asyncHandler(async (req, res) => {
  const s = await db.getOne("sculptures", (x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Installation not found." });
  await db.remove("sculptures", (x) => x.id === req.params.id);
  await deleteModelFile(s.glbUrl);
  await deleteModelFile(s.videoUrl);
  await deleteModelFile(s.audioUrl);
  await deleteModelFile(s.gameUrl);
  console.log(`[admin] ${req.admin} deleted installation "${s.name}" (${s.id}) by ${s.ownerUsername}`);
  res.status(204).end();
}));

// ---- users ----
router.get("/users", requireAdmin, asyncHandler(async (req, res) => {
  const users = await db.getAll("users");
  const sculptures = await db.getAll("sculptures");
  const counts = {};
  for (const s of sculptures) counts[s.ownerUsername] = (counts[s.ownerUsername] || 0) + 1;
  users.sort((a, b) => String(b.joined || "").localeCompare(String(a.joined || "")));
  res.json(users.map((u) => ({
    username: u.username, role: u.role || "resident", level: u.level || "artist", email: u.email || "",
    orgName: u.orgName || "", website: u.website || "", paymentStatus: u.paymentStatus || "free",
    isPro: !!u.isPro, bio: u.bio || "",
    avatar: typeof u.avatar === "string" ? u.avatar : null, joined: u.joined || null,
    installations: counts[u.username] || 0,
  })));
}));

// Deleting a user also deletes everything they installed.
router.delete("/users/:username", requireAdmin, asyncHandler(async (req, res) => {
  const username = String(req.params.username || "").toLowerCase();
  const u = await db.getOne("users", (x) => x.username === username);
  if (!u) return res.status(404).json({ error: "User not found." });
  const theirs = await db.getAll("sculptures", (s) => s.ownerUsername === username);
  await db.remove("sculptures", (s) => s.ownerUsername === username);
  await db.remove("files", (f) => f.ownerUsername === username);
  await db.remove("users", (x) => x.username === username);
  for (const s of theirs) { await deleteModelFile(s.glbUrl); await deleteModelFile(s.videoUrl); await deleteModelFile(s.audioUrl); await deleteModelFile(s.gameUrl); }
  console.log(`[admin] ${req.admin} deleted user "${username}" and ${theirs.length} installation(s)`);
  res.json({ deletedInstallations: theirs.length });
}));

// Best effort: remove the sculpture's .glb from file storage too. Never blocks or fails the delete.
async function deleteModelFile(url) {
  try {
    const base = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
    if (!url || !base || !(String(url).startsWith(base + "/glb/") || String(url).startsWith(base + "/video/") || String(url).startsWith(base + "/audio/") || String(url).startsWith(base + "/game/"))) return;
    if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET) return;
    const key = String(url).slice(base.length + 1);
    const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    });
    await client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  } catch (e) {
    console.warn("[admin] could not delete model file:", e.message);
  }
}

module.exports = router;
