require("dotenv").config();
const express    = require("express");
const https      = require("https");
const router     = express.Router();
const admin      = require("../config/firebase");

/**
 * POST /api/verify-payment
 *
 * Verifies a Monnify transaction and stamps the subscription in Firestore.
 *
 * Body:
 *   { reference: "RDFY-LITE-XXXXXXXX", plan: "lite" | "monthly" | "annual", uid: "firebaseUid" }
 *
 * Monnify verification:
 *   GET https://sandbox.monnify.com/api/v2/transactions/{encodedReference}
 *   Authorization: Basic base64(apiKey:secretKey)
 *
 * Expected amounts (Naira):
 *   lite    →  700
 *   monthly →  1,200
 *   annual  →  11,376
 */

const MONNIFY_API_KEY    = process.env.MONNIFY_API_KEY    || "MK_TEST_EBEFAAP7KD";
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY || "FM8ZLQQP9QB6EUPE7DZ8X2E2H8SHSS06";

// Use sandbox URL for test mode — switch to https://api.monnify.com for production
const MONNIFY_BASE_URL = process.env.MONNIFY_ENV === "live"
    ? "api.monnify.com"
    : "sandbox.monnify.com";

const EXPECTED_AMOUNTS = {
    lite:    700,
    monthly: 1200,
    annual:  11376,
};

const TIER_MAP = {
    lite:    "ONLINE",   // maps to Readify Lite subscription tier
    monthly: "PREMIUM",
    annual:  "PREMIUM",
};

router.post("/verify-payment", async (req, res) => {
    const { reference, plan, uid } = req.body;

    if (!reference || !plan || !uid) {
        return res.status(400).json({ success: false, error: "reference, plan and uid are required." });
    }

    const expectedAmount = EXPECTED_AMOUNTS[plan];
    if (!expectedAmount) {
        return res.status(400).json({ success: false, error: `Unknown plan: ${plan}` });
    }

    try {
        // ── 1. Verify with Monnify ────────────────────────────────────
        const monnifyData = await verifyMonnifyTransaction(reference);

        if (!monnifyData || monnifyData.requestSuccessful !== true) {
            return res.status(400).json({ success: false, error: "Could not reach Monnify to verify this transaction." });
        }

        const txn = monnifyData.responseBody;

        // Check payment status
        if (txn.paymentStatus !== "PAID") {
            return res.status(400).json({
                success: false,
                error: `Payment not completed. Status: ${txn.paymentStatus}`
            });
        }

        // Verify amount paid matches what we expect (allow ±1 Naira for rounding)
        const amountPaid = parseFloat(txn.amountPaid || txn.amount || 0);
        if (Math.abs(amountPaid - expectedAmount) > 1) {
            console.warn(`Amount mismatch: expected ₦${expectedAmount}, got ₦${amountPaid} for ref ${reference}`);
            return res.status(400).json({
                success: false,
                error: `Amount mismatch: expected ₦${expectedAmount}, received ₦${amountPaid}`
            });
        }

        // ── 2. Stamp subscription in Firestore ────────────────────────
        const tier     = TIER_MAP[plan];
        const now      = admin.firestore.FieldValue.serverTimestamp();
        const expiryMs = plan === "annual"
            ? Date.now() + 365 * 24 * 60 * 60 * 1000
            : plan === "monthly"
                ? Date.now() + 30 * 24 * 60 * 60 * 1000
                : null; // Lite is one-time, no expiry

        const updateData = {
            subscriptionTier:      tier,
            subscriptionPlan:      plan,
            subscriptionUpdatedAt: now,
            lastPaymentReference:  reference,
            lastPaymentAmount:     amountPaid,
        };
        if (expiryMs) updateData.subscriptionExpiresAt = new Date(expiryMs);

        await admin.firestore()
            .collection("users")
            .doc(uid)
            .set(updateData, { merge: true });

        console.log(`[Subscription] ${uid} upgraded to ${tier} (${plan}) via Monnify ref ${reference}`);

        return res.json({
            success: true,
            tier,
            plan,
            amountPaid,
            expiresAt: expiryMs ? new Date(expiryMs).toISOString() : null,
        });

    } catch (err) {
        console.error("[verify-payment] Error:", err.message);
        return res.status(500).json({ success: false, error: "Payment verification failed. Please contact support." });
    }
});

// ── Monnify REST API helper ───────────────────────────────────────────

function verifyMonnifyTransaction(reference) {
    return new Promise((resolve, reject) => {
        const credentials = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString("base64");
        const encodedRef  = encodeURIComponent(reference);
        const path        = `/api/v2/transactions/${encodedRef}`;

        const options = {
            hostname: MONNIFY_BASE_URL,
            path,
            method: "GET",
            headers: {
                "Authorization": `Basic ${credentials}`,
                "Content-Type":  "application/json",
            },
        };

        const req = https.request(options, (res) => {
            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(new Error("Invalid JSON from Monnify")); }
            });
        });

        req.on("error", reject);
        req.setTimeout(10000, () => reject(new Error("Monnify verification timed out")));
        req.end();
    });
}

module.exports = router;
