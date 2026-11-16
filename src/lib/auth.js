const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail loudly rather than silently signing tokens with a guessable
  // default — a weak secret here would let anyone forge a session.
  throw new Error("JWT_SECRET is not set. Copy .env.example to .env and set a real secret.");
}

async function hashPassword(plain) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(plain, salt);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function issueToken(user) {
  return jwt.sign(
    { sub: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

// Express middleware: requires a valid "Authorization: Bearer <token>"
// header, and attaches the decoded { sub, role } to req.auth.
// Also checks the account still exists: when an admin deletes a user, that user's
// 30-day login token stops working right away instead of lingering.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });
  let auth;
  try {
    auth = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  try {
    if (auth.role !== "admin") {
      const user = await db.getOne("users", (u) => u.username === auth.sub);
      if (!user) return res.status(401).json({ error: "This account no longer exists." });
    }
  } catch (e) {
    return next(e);
  }
  req.auth = auth;
  next();
}

function requireResident(req, res, next) {
  if (req.auth?.role !== "resident") {
    return res.status(403).json({ error: "Residents only" });
  }
  next();
}

module.exports = { hashPassword, verifyPassword, issueToken, requireAuth, requireResident };
