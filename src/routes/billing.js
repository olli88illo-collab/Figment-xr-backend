// ============================================================================
// BILLING — this is the file you'll need to finish once you have real Apple
// and Google developer accounts. It's wired up correctly (endpoints, auth,
// request/response shapes, where the entitlement gets granted) but the
// actual signature verification is intentionally left as a clearly marked
// TODO rather than hand-rolled here.
//
// Why: verifying an Apple StoreKit transaction or a Google Play purchase
// token correctly involves real cryptography (JWS/JWT signature checks
// against Apple's public keys, or a signed call to the Play Developer API
// with a service-account key). Getting that subtly wrong is a real
// security hole — it would let someone fake a "purchase" and unlock Pro
// for free. Rather than write crypto code I can't test against Apple's or
// Google's actual servers from here, use their OFFICIAL server libraries:
//
//   Apple:  npm install @apple/app-store-server-library
//           https://github.com/apple/app-store-server-library-node
//   Google: npm install googleapis
//           (Android Publisher API: purchases.subscriptions.get /
//            purchases.products.get)
//
// Both need real credentials only you can generate:
//   Apple:  App Store Connect → Users and Access → Integrations →
//           In-App Purchase key (.p8), Key ID, Issuer ID.
//   Google: Google Cloud Console → Service Account with access to your
//           Play Console app, downloaded as a JSON key.
// ============================================================================

const express = require("express");
const db = require("../lib/db");
const asyncHandler = require("../lib/asyncHandler");
const { requireAuth, requireResident } = require("../lib/auth");

const router = express.Router();

// --- iOS: called by your app right after StoreKit reports a successful
// purchase of the "Resident Pro" subscription/product. ---
router.post("/apple/verify", requireAuth, requireResident, async (req, res) => {
  const { signedTransactionInfo } = req.body; // the JWS string StoreKit gives you
  if (!signedTransactionInfo) {
    return res.status(400).json({ error: "signedTransactionInfo is required." });
  }

  // TODO: replace with real verification, e.g.:
  //   const { SignedDataVerifier } = require("@apple/app-store-server-library");
  //   const verifier = new SignedDataVerifier(appleRootCAs, true, Environment.PRODUCTION, bundleId);
  //   const payload = await verifier.verifyAndDecodeTransaction(signedTransactionInfo);
  //   if (payload.productId !== "resident_pro_monthly") throw new Error("wrong product");
  return res.status(501).json({
    error: "Apple receipt verification not yet implemented — see comments at the top of routes/billing.js",
  });

  // Once verification succeeds:
  // await db.update("users", u => u.username === req.auth.sub, { isPro: true });
  // res.json({ isPro: true });
});

// --- Android: called by your app right after Play Billing reports a
// successful purchase. ---
router.post("/google/verify", requireAuth, requireResident, async (req, res) => {
  const { purchaseToken, productId } = req.body;
  if (!purchaseToken || !productId) {
    return res.status(400).json({ error: "purchaseToken and productId are required." });
  }

  // TODO: replace with real verification, e.g.:
  //   const { google } = require("googleapis");
  //   const androidpublisher = google.androidpublisher({ version: "v3", auth });
  //   const result = await androidpublisher.purchases.subscriptions.get({
  //     packageName: "com.yourcompany.figmentxr",
  //     subscriptionId: productId,
  //     token: purchaseToken,
  //   });
  //   if (result.data.paymentState !== 1) throw new Error("not paid");
  return res.status(501).json({
    error: "Google Play receipt verification not yet implemented — see comments at the top of routes/billing.js",
  });

  // Once verification succeeds:
  // await db.update("users", u => u.username === req.auth.sub, { isPro: true });
  // res.json({ isPro: true });
});

// --- Webhooks: Apple (App Store Server Notifications V2) and Google
// (Real-time Developer Notifications via Pub/Sub) call these on their own
// when a subscription renews, cancels, or refunds — this is how you find
// out about lapses without the user opening your app.
//
// NOTE for when you implement real verification: signature checks often
// need the RAW request body, not the already-JSON-parsed one. If Apple's/
// Google's verification libraries want raw bytes, replace express.json()
// globally-parsed req.body here with express.raw({type: "*/*"}) on these
// two routes specifically, and parse JSON yourself after verifying. ---
router.post("/apple/webhook", (req, res) => {
  // TODO: verify req.body.signedPayload, then update the affected user's
  // isPro based on notificationType (DID_RENEW, EXPIRED, REFUND, etc).
  res.status(200).end();
});

router.post("/google/webhook", (req, res) => {
  // TODO: decode the Pub/Sub message, verify it's really from Google, then
  // update the affected user's isPro based on the notification type.
  res.status(200).end();
});

module.exports = router;

// --- DEV-ONLY testing bypass ---
// Lets you exercise the whole Resident Pro / File Library flow against the
// REAL backend and REAL database before billing.js above is finished, by
// flipping isPro the same way a verified purchase eventually will — instead
// of a client-side-only fake that wouldn't match what the server thinks.
//
// Disabled automatically outside development. Delete this route entirely
// once real Apple/Google verification is wired up above.
if (process.env.NODE_ENV !== "production") {
  router.post("/dev/set-pro", requireAuth, requireResident, asyncHandler(async (req, res) => {
    const isPro = !!req.body.isPro;
    const updated = await db.update("users", (u) => u.username === req.auth.sub, { isPro });
    if (!updated) return res.status(404).json({ error: "Account not found" });
    res.json({ isPro: updated.isPro });
  }));
}
