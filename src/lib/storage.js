// File storage for the artists' 3D models (.glb). The database is the wrong place for big files,
// and Render's free disk is wiped on every restart, so the files live in S3-compatible storage.
// Cloudflare R2 is the suggested choice: no charge for downloads, and a free tier that fits this app.
//
// Nothing here runs unless the R2_* settings in .env are filled in, so the server still starts without them.

const crypto = require("crypto");

function configured() {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_BASE_URL
  );
}

/**
 * A one-time upload address. The app (or website) sends the .glb file straight to uploadUrl with an HTTP PUT,
 * so the big file never passes through this server. publicUrl is what gets saved as the sculpture's glbUrl.
 */
async function createGlbUpload() {
  if (!configured()) {
    const err = new Error("File storage is not set up yet (R2_* settings are missing).");
    err.status = 501;
    throw err;
  }
  // Loaded only when needed, so the server runs fine before these packages are installed.
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const key = `glb/${crypto.randomUUID()}.glb`;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: "model/gltf-binary" }),
    { expiresIn: 600 }
  );
  const publicUrl = `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  return { uploadUrl, publicUrl, key, contentType: "model/gltf-binary" };
}

/**
 * Same idea for an .mp4 video. The upload address is signed for exactly [size] bytes, so storage itself
 * refuses anything bigger than the size the app declared (the route has already capped it at 50 MB).
 */
async function createVideoUpload(size) {
  if (!configured()) {
    const err = new Error("File storage is not set up yet (R2_* settings are missing).");
    err.status = 501;
    throw err;
  }
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const key = `video/${crypto.randomUUID()}.mp4`;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: "video/mp4", ContentLength: size }),
    { expiresIn: 600 }
  );
  const publicUrl = `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  return { uploadUrl, publicUrl, key, contentType: "video/mp4" };
}

/** Same idea for a sound file (.mp3 / .m4a / .aac, at most 5 MB; the address is signed for exactly [size] bytes). */
async function createAudioUpload(size, ext) {
  if (!configured()) {
    const err = new Error("File storage is not set up yet (R2_* settings are missing).");
    err.status = 501;
    throw err;
  }
  const type = ext === "mp3" ? "audio/mpeg" : ext === "aac" ? "audio/aac" : "audio/mp4";
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const key = `audio/${crypto.randomUUID()}.${ext}`;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: type, ContentLength: size }),
    { expiresIn: 600 }
  );
  const publicUrl = `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  return { uploadUrl, publicUrl, key, contentType: type };
}

/** A single-file .html game (at most 25 MB). Stored as a web page so the player's browser can open it. */
async function createGameUpload(size) {
  if (!configured()) {
    const err = new Error("File storage is not set up yet (R2_* settings are missing).");
    err.status = 501;
    throw err;
  }
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const key = `game/${crypto.randomUUID()}.html`;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: "text/html; charset=utf-8", ContentLength: size }),
    { expiresIn: 600 }
  );
  const publicUrl = `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  return { uploadUrl, publicUrl, key, contentType: "text/html; charset=utf-8" };
}

module.exports = { configured, createGlbUpload, createVideoUpload, createAudioUpload, createGameUpload };
