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

module.exports = { configured, createGlbUpload };
