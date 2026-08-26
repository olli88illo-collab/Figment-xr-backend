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
app.use(express.json({ limit: "8mb" })); // generous limit for STL geometry payloads

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
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Figment XR backend listening on :${PORT}`);
});
