const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireResident(req, res, next) {
  if (req.auth?.role !== "resident") {
    return res.status(403).json({ error: "Residents only" });
  }
  next();
}

module.exports = { hashPassword, verifyPassword, issueToken, requireAuth, requireResident };
