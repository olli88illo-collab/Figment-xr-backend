require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const meRoutes = require("./routes/me");
const sculptureRoutes = require("./routes/sculptures");
const fileRoutes = require("./routes/files");
const billingRoutes = require("./routes/billing");

const app = express();
app.use(cors());
app.use(express.json({ limit: "40mb" })); // STL geometry as JSON can run much larger than the raw file — a detailed model came in at ~25MB, so this needs real headroom, not just a token allowance

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/sculptures", sculptureRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/billing", billingRoutes);

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
