const express = require("express");
const crypto = require("crypto");
const db = require("../lib/db");
const { requireAuth, requireResident } = require("../lib/auth");
const asyncHandler = require("../lib/asyncHandler");
const { distanceM } = require("../lib/geo");
const storage = require("../lib/storage");
const ratings = require("../lib/ratings");

const router = express.Router();
const INSTALL_QUOTA = 3;
// GLB only: the model file must be a https link to a .glb (our own storage hands these out).
const isGlbUrl = (u) => typeof u === "string" && /^https:\/\/\S+\.glb(\?\S*)?$/i.test(u);
// Video installations: an https link to an .mp4 (our own storage hands these out).
const isVideoUrl = (u) => typeof u === "string" && /^https:\/\/\S+\.mp4(\?\S*)?$/i.test(u);
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
// Sound for an installation: an https link to an .mp3 / .m4a / .aac (our own storage hands these out), at most 5 MB.
const isAudioUrl = (u) => typeof u === "string" && /^https:\/\/\S+\.(mp3|m4a|aac)(\?\S*)?$/i.test(u);
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
// Games: an https link to the developer's AR game (a web page, e.g. WebXR), or a single .html file we host for them (at most 25 MB).
const isGameUrl = (u) => typeof u === "string" && u.length <= 500 && /^https:\/\/[^\s<>"']+$/i.test(u);
const MAX_GAME_BYTES = 25 * 1024 * 1024;
const clampNum = (v, lo, hi, dflt) => (typeof v === "number" && Number.isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : dflt;
// Only these membership levels may install work (Patrons and Collectors may not).
const INSTALLER_LEVELS = ["artist", "gallery", "museum", "business", "gamer", "architect"];

// Public — anyone (including guests) can browse every installed sculpture.
router.get("/", asyncHandler(async (req, res) => {
  res.json(await ratings.attach(await db.getAll("sculptures")));
}));

// Public — the sculptures near a spot, closest first. This is what the app calls when you arrive somewhere.
//   GET /api/sculptures/nearby?lat=40.1386&lon=-74.2591&radius=300
// radius is in metres (default 300, at most 5000). The list is light: big geometry and photos are left out;
// fetch one sculpture's full record with GET /api/sculptures/:id when you want to show it.
router.get("/nearby", asyncHandler(async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: "lat and lon are required numbers." });
  }
  const radius = Math.min(5000, Math.max(10, parseFloat(req.query.radius) || 300));
  const rows = await db.nearbyBox(lat, lon, radius);
  const out = [];
  for (const s of rows) {
    const d = distanceM(lat, lon, s.lat, s.lon);
    if (d > radius) continue;
    const { stlPositions, photo, ...light } = s;
    out.push({ ...light, hasGlb: !!light.glbUrl, distanceM: Math.round(d) });
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  res.json(await ratings.attach(out));
}));

// A signed-in Resident asks for permission to upload one .glb file; see lib/storage.js.
router.post("/upload-url", requireAuth, requireResident, asyncHandler(async (req, res) => {
  try {
    res.json(await storage.createGlbUpload());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}));

// A signed-in Resident asks for permission to upload one .mp4 video (at most 50 MB); see lib/storage.js.
router.post("/video-upload-url", requireAuth, requireResident, asyncHandler(async (req, res) => {
  const size = Number(req.body && req.body.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_VIDEO_BYTES) {
    return res.status(400).json({ error: "Videos can be at most 50 MB." });
  }
  try {
    res.json(await storage.createVideoUpload(Math.floor(size)));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}));

// A Gamer asks for permission to upload one single-file .html game (at most 25 MB); see lib/storage.js.
router.post("/game-upload-url", requireAuth, requireResident, asyncHandler(async (req, res) => {
  const me = await db.getOne("users", (u) => u.username === req.auth.sub);
  if (!me || me.level !== "gamer") return res.status(403).json({ error: "Only Gamer accounts can upload games." });
  const size = Number(req.body && req.body.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_GAME_BYTES) {
    return res.status(400).json({ error: "Game files can be at most 25 MB." });
  }
  try {
    res.json(await storage.createGameUpload(Math.floor(size)));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}));

// A signed-in Resident asks for permission to upload one sound file (.mp3 / .m4a / .aac, at most 5 MB).
router.post("/audio-upload-url", requireAuth, requireResident, asyncHandler(async (req, res) => {
  const size = Number(req.body && req.body.size);
  const ext = String((req.body && req.body.ext) || "").toLowerCase().replace(".", "");
  if (!["mp3", "m4a", "aac"].includes(ext)) return res.status(400).json({ error: "Sound files must be .mp3, .m4a or .aac." });
  if (!Number.isFinite(size) || size <= 0 || size > MAX_AUDIO_BYTES) {
    return res.status(400).json({ error: "Sound files can be at most 5 MB." });
  }
  try {
    res.json(await storage.createAudioUpload(Math.floor(size), ext));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}));

// Public — one sculpture's full record .
router.get("/:id", asyncHandler(async (req, res) => {
  const s = await db.getOne("sculptures", (x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json((await ratings.attach([s]))[0]);
}));

router.post("/", requireAuth, requireResident, asyncHandler(async (req, res) => {
  const mine = await db.getAll("sculptures", (s) => s.ownerUsername === req.auth.sub);
  if (mine.length >= INSTALL_QUOTA) {
    return res.status(403).json({ error: `Beta quota reached — ${INSTALL_QUOTA} sculptures max.` });
  }

  const me = await db.getOne("users", (u) => u.username === req.auth.sub);
  const level = (me && me.level) || "artist";
  if (!INSTALLER_LEVELS.includes(level)) {
    return res.status(403).json({ error: "Your membership level cannot install work. Artists, Galleries, Museums and Businesses can." });
  }

  const { name, desc, lat, lon, city, state, format, color, geomType, photo, heightM, glbUrl, rotationDeg, heightOffset, videoUrl, videoAspect, videoSound, videoFacesViewer, audioUrl, audioRadiusM, audioVolume, gameUrl, gameRadiusM } = req.body;
  if (!name || typeof lat !== "number" || typeof lon !== "number") {
    return res.status(400).json({ error: "name, lat, and lon are required." });
  }
  if (glbUrl !== undefined && glbUrl !== null && !isGlbUrl(glbUrl)) {
    return res.status(400).json({ error: "Only .glb model files are supported." });
  }
  if (videoUrl !== undefined && videoUrl !== null && !isVideoUrl(videoUrl)) {
    return res.status(400).json({ error: "Only .mp4 video files are supported." });
  }
  if (audioUrl !== undefined && audioUrl !== null && !isAudioUrl(audioUrl)) {
    return res.status(400).json({ error: "Sound files must be .mp3, .m4a or .aac." });
  }
  if (gameUrl !== undefined && gameUrl !== null && !isGameUrl(gameUrl)) {
    return res.status(400).json({ error: "The game link must start with https://" });
  }
  if (gameUrl && level !== "gamer") {
    return res.status(403).json({ error: "Only Gamer accounts can install games." });
  }
  if (!isGlbUrl(glbUrl) && !isVideoUrl(videoUrl) && !isGameUrl(gameUrl)) {
    return res.status(400).json({ error: "Upload a .glb model, an .mp4 video or a game." });
  }

  const sculpture = {
    id: crypto.randomUUID(),
    ownerUsername: req.auth.sub,
    name: String(name).slice(0, 80),
    desc: String(desc || "").slice(0, 400),
    lat, lon,
    city: city || null,
    state: state || null,
    format: isGameUrl(gameUrl) && !isGlbUrl(glbUrl) && !isVideoUrl(videoUrl) ? "game" : isVideoUrl(videoUrl) ? "video" : "glb",
    color: color || "#5FE1FF",
    geomType: geomType || "bloom",
    photo: typeof photo === "string" ? photo : null,
    heightM: (typeof heightM === "number" && heightM > 0) ? heightM : 2,
    // The artist's model file (GLB) and how it was placed on site (turned from true north, raised / lowered in metres).
    glbUrl: isGlbUrl(glbUrl) ? glbUrl : null,
    rotationDeg: typeof rotationDeg === "number" ? rotationDeg : 0,
    heightOffset: typeof heightOffset === "number" ? heightOffset : 0,
    // Video installations: a flat panel. Sound is off and the panel faces the viewer unless the artist changes that.
    videoUrl: isVideoUrl(videoUrl) ? videoUrl : null,
    videoAspect: (typeof videoAspect === "number" && videoAspect > 0.2 && videoAspect < 5) ? videoAspect : 16 / 9,
    videoSound: videoSound === true,
    videoFacesViewer: videoFacesViewer !== false,
    // Sound: plays more loudly the closer the viewer gets. On by default once the artist has attached a file.
    audioUrl: isAudioUrl(audioUrl) ? audioUrl : null,
    audioOn: isAudioUrl(audioUrl),
    audioRadiusM: clampNum(audioRadiusM, 3, 50, 15),
    audioVolume: clampNum(audioVolume, 0.1, 1, 0.8),
    // Games: players must be within gameRadiusM metres to start it.
    gameUrl: isGameUrl(gameUrl) ? gameUrl : null,
    gameRadiusM: clampNum(gameRadiusM, 5, 200, 30),
    createdAt: new Date().toISOString(),
  };
  await db.insert("sculptures", sculpture);
  res.status(201).json(sculpture);
}));

router.patch("/:id", requireAuth, asyncHandler(async (req, res) => {
  const existing = await db.getOne(
    "sculptures",
    (s) => s.id === req.params.id && s.ownerUsername === req.auth.sub
  );
  if (!existing) return res.status(404).json({ error: "Not found (or not yours)" });

  const { name, desc, lat, lon, city, state, format, color, geomType, photo, heightM, glbUrl, rotationDeg, heightOffset,
    forSale, touchRotate, autoRotate, autoRotateCw, autoRotateSpeed, videoSound, videoFacesViewer, audioOn, audioRadiusM, audioVolume, gameRadiusM } = req.body;
  const patch = {};
  if (name !== undefined) patch.name = String(name).slice(0, 80);
  if (desc !== undefined) patch.desc = String(desc || "").slice(0, 400);
  if (typeof lat === "number") patch.lat = lat;
  if (typeof lon === "number") patch.lon = lon;
  if (city !== undefined) patch.city = city || null;
  if (state !== undefined) patch.state = state || null;
  if (color !== undefined) patch.color = color;
  if (geomType !== undefined) patch.geomType = geomType;
  if (photo !== undefined) patch.photo = typeof photo === "string" ? photo : null;
  if (typeof heightM === "number" && heightM > 0) patch.heightM = heightM;
  if (isGlbUrl(glbUrl)) patch.glbUrl = glbUrl;
  if (typeof rotationDeg === "number") patch.rotationDeg = rotationDeg;
  if (typeof heightOffset === "number") patch.heightOffset = heightOffset;
  if (typeof forSale === "boolean") patch.forSale = forSale;
  if (typeof touchRotate === "boolean") patch.touchRotate = touchRotate;
  if (typeof autoRotate === "boolean") patch.autoRotate = autoRotate;
  if (typeof autoRotateCw === "boolean") patch.autoRotateCw = autoRotateCw;
  if (typeof autoRotateSpeed === "number" && Number.isFinite(autoRotateSpeed)) patch.autoRotateSpeed = Math.min(90, Math.max(1, autoRotateSpeed));
  if (typeof videoSound === "boolean") patch.videoSound = videoSound;
  if (typeof videoFacesViewer === "boolean") patch.videoFacesViewer = videoFacesViewer;
  if (typeof audioOn === "boolean") patch.audioOn = audioOn;
  if (typeof audioRadiusM === "number") patch.audioRadiusM = clampNum(audioRadiusM, 3, 50, 15);
  if (typeof audioVolume === "number") patch.audioVolume = clampNum(audioVolume, 0.1, 1, 0.8);
  if (typeof gameRadiusM === "number") patch.gameRadiusM = clampNum(gameRadiusM, 5, 200, 30);

  const updated = await db.update(
    "sculptures",
    (s) => s.id === req.params.id && s.ownerUsername === req.auth.sub,
    patch
  );
  res.json(updated);
}));

router.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  const removed = await db.remove(
    "sculptures",
    (s) => s.id === req.params.id && s.ownerUsername === req.auth.sub
  );
  if (!removed) return res.status(404).json({ error: "Not found (or not yours)" });
  res.status(204).end();
}));

module.exports = router;
