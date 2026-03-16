/**
 * Billing tier definitions and helper functions
 */

export const BILLING_TIERS = {
  free: {
    name: "Free",
    monthlyAiConvos: 25,
    price: 0,
    trialDays: 0,
  },
  starter: {
    name: "Starter",
    monthlyAiConvos: 100,
    price: 19,
    trialDays: 14,
  },
  pro: {
    name: "Pro",
    monthlyAiConvos: 300,
    price: 49,
    trialDays: 14,
  },
  enterprise: {
    name: "Enterprise",
    monthlyAiConvos: Infinity,
    price: null, // custom pricing
    trialDays: 0,
  },
};

// Maps Shopify billing plan names to internal tier names
export const SHOPIFY_PLAN_NAMES = {
  Starter: "starter",
  Pro: "pro",
};

/**
 * Get tier config for a plan name
 * @param {string} plan - Internal plan name (free, starter, pro, enterprise)
 * @returns {Object} Tier configuration
 */
export function getTierLimits(plan) {
  return BILLING_TIERS[plan] || BILLING_TIERS.free;
}

/**
 * Get the monthly AI conversation limit for a plan
 * @param {string} plan - Internal plan name
 * @returns {number} Monthly limit
 */
export function getAiConvoLimit(plan) {
  return (BILLING_TIERS[plan] || BILLING_TIERS.free).monthlyAiConvos;
}
