"use strict";

const { getBudgetStatus, isEnforcementEnabled } =
        require("../services/analytics/budgetService");

/**
 * Stops runaway OpenAI spend.
 *
 * Behaviour when the ceiling is breached:
 *   - Paying users (PREMIUM / LITE_YEARLY) are never blocked. They bought the
 *     service; cutting them off would be the wrong failure mode.
 *   - Free-tier requests are refused with a clear, non-alarming message.
 *
 * Disabled by default (AI_BUDGET_ENFORCEMENT_ENABLED=false) so it can be
 * observed in the logs before it is allowed to reject anything. Any internal
 * error fails open — a monitoring problem must never take AI offline.
 */
function enforceBudget(req, res, next) {
  if (!isEnforcementEnabled()) return next();

  // Paid users bypass the ceiling entirely.
  if (req.isPremium === true) return next();

  getBudgetStatus()
    .then(status => {
      if (status.available && status.status === "exceeded") {
        console.warn(`[Budget] blocked free-tier ${req.path} for ${req.user?.uid}`);
        return res.status(503).json({
          error:   "AI_BUDGET_REACHED",
          message: "Readify's AI is very busy today. Please try again tomorrow, " +
                   "or upgrade to Premium for uninterrupted access.",
        });
      }
      return next();
    })
    .catch(error => {
      console.error("[Budget] check failed, allowing request:", error.message);
      return next();   // fail open
    });
}

module.exports = enforceBudget;
