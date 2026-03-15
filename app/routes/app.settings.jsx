import { useState } from "react";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server";
import { getChatSettings, saveChatSettings } from "../db.server";
import { parseSupportSchedule } from "../services/schedule-parser.server";

async function fetchStorePolicies(admin) {
  try {
    const response = await admin.graphql(`
      query {
        shop {
          shopPolicies {
            type
            title
            body
            updatedAt
          }
        }
      }
    `);
    const data = await response.json();
    const policies = data?.data?.shop?.shopPolicies || [];
    // Filter out empty policies and strip HTML tags for preview
    return policies
      .filter(p => p.body && p.body.trim().length > 0)
      .map(p => ({
        type: p.type,
        title: p.title,
        body: p.body.replace(/<[^>]*>/g, '').trim(),
        updatedAt: p.updatedAt,
      }));
  } catch (e) {
    console.error('Error fetching policies:', e);
    return [];
  }
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const settings = await getChatSettings(session.shop);
  const policies = await fetchStorePolicies(admin);
  return { settings, policies, syncedAt: new Date().toISOString() };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  // Handle re-sync action
  if (formData.get("_action") === "resync") {
    const policies = await fetchStorePolicies(admin);
    return { resync: true, policies, syncedAt: new Date().toISOString() };
  }

  const supportHoursText = formData.get("supportHoursText") || "";

  // Parse support hours via OpenAI if provided
  let supportSchedule = "";
  if (supportHoursText.trim()) {
    try {
      const parsed = await parseSupportSchedule(supportHoursText);
      supportSchedule = parsed ? JSON.stringify(parsed) : "";
    } catch (error) {
      console.error("Failed to parse support hours:", error);
      return { success: false, error: `Could not understand support hours: "${supportHoursText}". Try something like "Mon-Fri 9am-5pm ET".` };
    }
  }

  const data = {
    welcomeMessage: formData.get("welcomeMessage") || "",
    promptType: formData.get("promptType") || "standardAssistant",
    customInstructions: formData.get("customInstructions") || "",
    bubbleColor: formData.get("bubbleColor") || "#5046e4",
    supportHoursText,
    supportSchedule,
  };

  try {
    await saveChatSettings(session.shop, data);
    return { success: true, parsedSchedule: supportSchedule ? JSON.parse(supportSchedule) : null };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export default function Settings() {
  const { settings, policies: initialPolicies, syncedAt: initialSyncedAt } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Track policies and sync time (update from action response)
  const [policies] = useState(() => actionData?.policies || initialPolicies);
  const [syncedAt] = useState(() => actionData?.syncedAt || initialSyncedAt);

  const displayPolicies = actionData?.policies || policies;
  const displaySyncedAt = actionData?.syncedAt || syncedAt;

  const formatSyncTime = (iso) => {
    if (!iso) return "Never";
    const d = new Date(iso);
    return d.toLocaleString();
  };

  return (
    <s-page
      heading="Settings"
      backAction={{ content: "Back", url: "/app" }}
    >
      <Form method="post">
        {/* Status banner */}
        {actionData?.success && (
          <s-section>
            <s-banner tone="success" onDismiss>
              Settings saved successfully.
            </s-banner>
          </s-section>
        )}
        {actionData?.error && (
          <s-section>
            <s-banner tone="critical">
              Failed to save settings: {actionData.error}
            </s-banner>
          </s-section>
        )}
        {actionData?.resync && (
          <s-section>
            <s-banner tone="success" onDismiss>
              Policies re-synced successfully.
            </s-banner>
          </s-section>
        )}

        {/* Chat Appearance */}
        <s-section>
          <s-card>
            <s-box padding="base">
              <s-stack gap="base">
                <s-heading element="h2">Chat Appearance</s-heading>

                <s-text-field
                  label="Welcome Message"
                  name="welcomeMessage"
                  defaultValue={settings?.welcomeMessage || ""}
                  helpText="The first message customers see when they open the chat."
                  autoComplete="off"
                />

                <s-text-field
                  label="Bubble Color"
                  name="bubbleColor"
                  defaultValue={settings?.bubbleColor || "#5046e4"}
                  helpText="Hex color code for the chat bubble (e.g., #5046e4)."
                  autoComplete="off"
                />
              </s-stack>
            </s-box>
          </s-card>
        </s-section>

        {/* AI Behavior */}
        <s-section>
          <s-card>
            <s-box padding="base">
              <s-stack gap="base">
                <s-heading element="h2">AI Behavior</s-heading>

                <s-select
                  label="Prompt Style"
                  name="promptType"
                  defaultValue={settings?.promptType || "standardAssistant"}
                >
                  <option value="standardAssistant">Standard Assistant</option>
                  <option value="enthusiasticAssistant">Enthusiastic Assistant</option>
                </s-select>
              </s-stack>
            </s-box>
          </s-card>
        </s-section>

        {/* Store Knowledge */}
        <s-section>
          <s-card>
            <s-box padding="base">
              <s-stack gap="base">
                <s-heading element="h2">Store Knowledge</s-heading>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", backgroundColor: "#f0f9ff", borderRadius: "8px", border: "1px solid #bae6fd" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "#0369a1" }}>Policy Sync Status</div>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                      Last synced: {formatSyncTime(displaySyncedAt)}
                    </div>
                  </div>
                  <button
                    type="submit"
                    name="_action"
                    value="resync"
                    style={{
                      border: "1px solid #0ea5e9",
                      borderRadius: "6px",
                      backgroundColor: "#ffffff",
                      color: "#0369a1",
                      padding: "6px 14px",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                    }}
                    disabled={isSubmitting}
                  >
                    {isSubmitting && navigation.formData?.get("_action") === "resync" ? "Syncing..." : "Re-sync"}
                  </button>
                </div>

                {displayPolicies && displayPolicies.length > 0 && (
                  <div style={{ backgroundColor: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", padding: "12px", maxHeight: "250px", overflowY: "auto" }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Synced Policies ({displayPolicies.length})
                    </div>
                    {displayPolicies.map((policy, i) => (
                      <div key={i} style={{ marginBottom: i < displayPolicies.length - 1 ? "10px" : 0, paddingBottom: i < displayPolicies.length - 1 ? "10px" : 0, borderBottom: i < displayPolicies.length - 1 ? "1px solid #e2e8f0" : "none" }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a", marginBottom: "4px" }}>{policy.title}</div>
                        <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.4 }}>
                          {policy.body.slice(0, 200)}{policy.body.length > 200 ? "..." : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {(!displayPolicies || displayPolicies.length === 0) && (
                  <s-banner tone="warning">
                    No policies found. Set up your store policies in Shopify admin → Settings → Policies, then click Re-sync.
                  </s-banner>
                )}

                <s-text-area
                  label="Custom Instructions"
                  name="customInstructions"
                  defaultValue={settings?.customInstructions || ""}
                  rows="4"
                  helpText="Brand voice, promotions, warranty, or anything else the AI should know beyond your store policies."
                />
              </s-stack>
            </s-box>
          </s-card>
        </s-section>

        {/* Support Hours */}
        <s-section>
          <s-card>
            <s-box padding="base">
              <s-stack gap="base">
                <s-heading element="h2">Support Hours</s-heading>
                <s-text variant="bodyMd" tone="subdued">
                  Describe when human support is available in plain language. Outside these hours, only AI chat is offered.
                  Leave empty to allow human handoff anytime.
                </s-text>

                <s-text-area
                  label="Support Hours"
                  name="supportHoursText"
                  defaultValue={settings?.supportHoursText || ""}
                  rows="3"
                  helpText='Examples: "Mon-Fri 9am-5pm ET", "24/7", "Weekdays 8:30am-6pm PST, Saturday 10am-2pm", "Closed on Christmas Day and New Year&#39;s Day, early close at 1pm on Christmas Eve"'
                />

                {(actionData?.parsedSchedule || (settings?.supportSchedule && !actionData?.success)) && (
                  <div style={{ backgroundColor: "#f0fdf4", borderRadius: "8px", border: "1px solid #bbf7d0", padding: "12px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#15803d", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Parsed Schedule
                    </div>
                    <div style={{ fontSize: "14px", color: "#166534" }}>
                      {actionData?.parsedSchedule?.displayText || (() => {
                        try { return JSON.parse(settings.supportSchedule)?.displayText; } catch { return ""; }
                      })()}
                    </div>
                  </div>
                )}
              </s-stack>
            </s-box>
          </s-card>
        </s-section>

        {/* Save button */}
        <s-section>
          <s-button variant="primary" submit disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </s-button>
        </s-section>
      </Form>
    </s-page>
  );
}
