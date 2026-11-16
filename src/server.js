require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const meRoutes = require("./routes/me");
const userRoutes = require("./routes/users");
const sculptureRoutes = require("./routes/sculptures");
const fileRoutes = require("./routes/files");
const adminRoutes = require("./routes/admin");
const path = require("path");
const billingRoutes = require("./routes/billing");

const app = express();
app.set("trust proxy", 1); // behind Render's proxy: lets the admin login limiter see each visitor's real address
app.use(cors());
app.use(express.json({ limit: "40mb" })); // STL geometry as JSON can run much larger than the raw file — a detailed model came in at ~25MB, so this needs real headroom, not just a token allowance

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/users", userRoutes);
app.use("/api/sculptures", sculptureRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/admin", adminRoutes);

// The admin page (log in, review and delete installations and users). Staff only: everything it shows needs the admin login.
app.get("/admin", (req, res) => {
  res.set({
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
  res.sendFile(path.join(__dirname, "admin", "admin.html"));
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  // Payload-too-large has its own status/message worth surfacing directly —
  // otherwise this shows up to the user as an opaque "Internal server
  // error" with no clue what actually happened (exactly what happened here).
  if (err.type === "entity.too.large" || err.status === 413) {
    return res.status(413).json({ error: "That file is too large to upload. Try a smaller or simpler model." });
  }
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Figment XR backend listening on :${PORT}`);
});
