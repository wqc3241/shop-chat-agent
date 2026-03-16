import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server";
import { getChatSettings } from "../db.server";
import { BILLING_TIERS, getTierLimits } from "../services/billing-config.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getChatSettings(session.shop);
  const plan = settings?.billingPlan || "free";
  const tier = getTierLimits(plan);

  // Serialize plans for client rendering (Infinity → null for JSON)
  const plans = Object.entries(BILLING_TIERS).map(([key, t]) => ({
    key,
    name: t.name,
    monthlyAiConvos: t.monthlyAiConvos === Infinity ? null : t.monthlyAiConvos,
    price: t.price,
    trialDays: t.trialDays,
    shopifyName: key === "starter" ? "Starter" : key === "pro" ? "Pro" : null,
  }));

  return {
    plan,
    tierName: tier.name,
    used: settings?.monthlyAiConvoCount || 0,
    limit: tier.monthlyAiConvos === Infinity ? null : tier.monthlyAiConvos,
    resetAt: settings?.monthlyConvoResetAt,
    billingStatus: settings?.billingStatus || "active",
    plans,
  };
};

export const action = async ({ request }) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const selectedPlan = formData.get("plan");

  if (selectedPlan !== "Starter" && selectedPlan !== "Pro") {
    return { error: "Invalid plan selected" };
  }

  try {
    await billing.require({
      plans: [selectedPlan],
      isTest: true,
      onFailure: async () => {
        throw new Error("BILLING_REDIRECT");
      },
    });
    return { success: true };
  } catch (error) {
    if (error.message !== "BILLING_REDIRECT") {
      console.error("Billing error:", error);
      return { error: error.message };
    }
    throw error;
  }
};

export default function Billing() {
  const { plan, tierName, used, limit, resetAt, billingStatus, plans } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const formatResetDate = (iso) => {
    if (!iso) return "N/A";
    return new Date(iso).toLocaleDateString();
  };

  const isUnlimited = limit === null;
  const usagePercent = isUnlimited ? 0 : Math.min((used / limit) * 100, 100);

  return (
    <s-page heading="Billing" backAction={{ content: "Back", url: "/app" }}>
      {actionData?.error && (
        <s-section>
          <s-banner tone="critical">{actionData.error}</s-banner>
        </s-section>
      )}

      {/* Current plan + usage */}
      <s-section>
        <s-card>
          <s-box padding="base">
            <s-stack gap="base">
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <s-heading element="h2">Current Plan</s-heading>
                <span style={{
                  display: "inline-block",
                  padding: "2px 10px",
                  borderRadius: "12px",
                  fontSize: "13px",
                  fontWeight: 600,
                  backgroundColor: plan === "free" ? "#f1f5f9" : "#dbeafe",
                  color: plan === "free" ? "#475569" : "#1d4ed8",
                }}>
                  {tierName}
                </span>
                {billingStatus === "frozen" && (
                  <span style={{
                    padding: "2px 10px", borderRadius: "12px", fontSize: "13px",
                    fontWeight: 600, backgroundColor: "#fef3c7", color: "#92400e",
                  }}>Frozen</span>
                )}
              </div>

              <div>
                <div style={{ fontSize: "14px", color: "#374151", marginBottom: "8px" }}>
                  <strong>{used}</strong> of {isUnlimited ? "Unlimited" : limit} AI conversations used this month
                </div>
                {!isUnlimited && (
                  <div style={{
                    height: "8px", backgroundColor: "#e5e7eb", borderRadius: "4px", overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%", borderRadius: "4px", transition: "width 0.3s",
                      width: `${usagePercent}%`,
                      backgroundColor: usagePercent >= 90 ? "#ef4444" : usagePercent >= 70 ? "#f59e0b" : "#22c55e",
                    }} />
                  </div>
                )}
                {resetAt && (
                  <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "6px" }}>
                    Resets on {formatResetDate(resetAt)}
                  </div>
                )}
              </div>
            </s-stack>
          </s-box>
        </s-card>
      </s-section>

      {/* Plan comparison */}
      <s-section>
        <s-card>
          <s-box padding="base">
            <s-stack gap="base">
              <s-heading element="h2">Plans</s-heading>
              <s-text tone="subdued">
                All plans include every feature — live chat, web search, custom instructions, branding, and support hours.
                Only the monthly AI conversation limit differs.
              </s-text>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
                {plans.map((p) => {
                  const isCurrent = p.key === plan;
                  return (
                    <div key={p.key} style={{
                      border: isCurrent ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                      borderRadius: "12px", padding: "20px", textAlign: "center",
                      backgroundColor: isCurrent ? "#eff6ff" : "#fff",
                    }}>
                      <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>{p.name}</div>
                      <div style={{ fontSize: "28px", fontWeight: 700, color: "#111827", marginBottom: "4px" }}>
                        {p.price === null ? "Custom" : p.price === 0 ? "$0" : `$${p.price}`}
                      </div>
                      <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "12px" }}>
                        {p.price === null ? "Contact us" : "per month"}
                      </div>
                      <div style={{ fontSize: "14px", color: "#374151", marginBottom: "16px" }}>
                        {p.monthlyAiConvos === null ? "Unlimited" : p.monthlyAiConvos} AI conversations/mo
                      </div>
                      {p.trialDays > 0 && (
                        <div style={{ fontSize: "12px", color: "#059669", marginBottom: "12px" }}>
                          {p.trialDays}-day free trial
                        </div>
                      )}

                      {isCurrent ? (
                        <div style={{
                          padding: "8px 16px", borderRadius: "8px",
                          backgroundColor: "#dbeafe", color: "#1d4ed8",
                          fontSize: "14px", fontWeight: 600,
                        }}>Current Plan</div>
                      ) : p.key === "enterprise" ? (
                        <a href="mailto:support@nextlevelperformance.com" style={{
                          display: "inline-block", padding: "8px 16px", borderRadius: "8px",
                          backgroundColor: "#f3f4f6", color: "#374151",
                          fontSize: "14px", fontWeight: 600, textDecoration: "none",
                        }}>Contact Us</a>
                      ) : p.shopifyName ? (
                        <Form method="post">
                          <input type="hidden" name="plan" value={p.shopifyName} />
                          <button type="submit" disabled={isSubmitting} style={{
                            padding: "8px 16px", borderRadius: "8px", border: "none", cursor: "pointer",
                            backgroundColor: "#3b82f6", color: "#fff",
                            fontSize: "14px", fontWeight: 600,
                            opacity: isSubmitting ? 0.7 : 1,
                          }}>
                            {isSubmitting ? "Redirecting..." : plan === "free" ? "Upgrade" : "Switch"}
                          </button>
                        </Form>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </s-stack>
          </s-box>
        </s-card>
      </s-section>

      {/* Info note */}
      <s-section>
        <s-banner tone="info">
          Human/merchant live chat conversations are always <strong>free and unlimited</strong> on all plans.
          Only AI-powered conversations count toward your monthly limit.
        </s-banner>
      </s-section>
    </s-page>
  );
}
