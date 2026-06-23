require("dotenv").config();

const express = require("express");
const https = require("https");

const router = express.Router();

/**
 * POST /api/verify-payment
 *
 * Body: { reference, plan, uid }
 *   reference — Paystack transaction reference returned to the app
 *   plan      — "online" | "monthly" | "annual"
 *   uid       — Firebase UID of the paying user
 *
 * Verifies the transaction with Paystack, then stamps the user's
 * subscription tier in Firestore so it roams across devices.
 *
 * Required env vars:
 *   PAYSTACK_SECRET_KEY  — your Paystack secret key (sk_live_... or sk_test_...)
 *   GOOGLE_SERVICE_ACCOUNT_JSON — stringified service-account JSON for
 *                                  Firebase Admin SDK (or set up a credentials file)
 */
router.post("/verify-payment", async (req, res) => {
  const { reference, plan, uid } = req.body;

  if (!reference || !plan || !uid) {
    return res.status(400).json({ error: "reference, plan and uid are required" });
  }

  const allowedPlans = ["online", "monthly", "annual"];
  if (!allowedPlans.includes(plan)) {
    return res.status(400).json({ error: "Invalid plan" });
  }

  try {
    const paystackData = await verifyWithPaystack(reference);

    if (paystackData.data.status !== "success") {
      return res.status(400).json({ error: "Payment not successful" });
    }

    const expectedAmountKobo = expectedAmount(plan);
    const paidAmount = paystackData.data.amount;

    if (paidAmount < expectedAmountKobo) {
      return res.status(400).json({ error: "Payment amount does not match" });
    }

    const tier = plan === "online" ? "ONLINE" : "PREMIUM";
    let premiumExpiryMs = 0;

    if (tier === "PREMIUM") {
      const now = Date.now();
      // annual = 365 days, monthly = 31 days (a little extra to be safe)
      premiumExpiryMs = plan === "annual"
        ? now + 365 * 24 * 60 * 60 * 1000
        : now + 31  * 24 * 60 * 60 * 1000;
    }

    await updateFirestore(uid, tier, plan, premiumExpiryMs);

    return res.json({
      ok: true,
      tier,
      plan,
      premiumExpiryMs
    });

  } catch (err) {
    console.error("verify-payment error:", err);
    return res.status(500).json({ error: "Payment verification failed" });
  }
});

// ----------------------------------------------------------------
// Paystack verification
// ----------------------------------------------------------------

function verifyWithPaystack(reference) {
  return new Promise((resolve, reject) => {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      reject(new Error("PAYSTACK_SECRET_KEY not configured"));
      return;
    }

    const options = {
      hostname: "api.paystack.co",
      path: `/transaction/verify/${encodeURIComponent(reference)}`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`
      }
    };

    const req = https.request(options, (resp) => {
      let data = "";
      resp.on("data", chunk => { data += chunk; });
      resp.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.status) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.message || "Paystack verification failed"));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

// ----------------------------------------------------------------
// Expected amounts (kobo)
// ----------------------------------------------------------------

function expectedAmount(plan) {
  switch (plan) {
    case "online":  return 49_900;
    case "monthly": return 120_000;
    case "annual":  return 1_137_600;
    default:        return Infinity;
  }
}

// ----------------------------------------------------------------
// Firestore write (Firebase Admin SDK)
// ----------------------------------------------------------------

let firestoreAdmin = null;

async function getFirestore() {
  if (firestoreAdmin) return firestoreAdmin;

  const admin = require("firebase-admin");

  if (admin.apps.length === 0) {
    const serviceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
      : null;

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } else {
      // Falls back to Application Default Credentials if running on GCP/Firebase
      admin.initializeApp();
    }
  }

  firestoreAdmin = admin.firestore();
  return firestoreAdmin;
}

async function updateFirestore(uid, tier, plan, premiumExpiryMs) {
  const db = await getFirestore();

  const data = {
    subscriptionTier: tier,
    subscriptionUpdatedAt: Date.now()
  };

  if (tier === "PREMIUM") {
    data.premiumPlan = plan;
    data.premiumExpiryMs = premiumExpiryMs;
  }

  await db.collection("users").doc(uid).set(data, { merge: true });
}

module.exports = router;
