import { useState } from "react";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server";
import { getChatSettings, saveChatSettings } from "../db.server";

async function fetchStorePolicies(shop) {
  try {
    const mcpUrl = `https://${shop}/api/mcp`;
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 1,
        params: {
          name: "search_shop_policies_and_faqs",
          arguments: { query: "return policy shipping policy contact information terms of service", context: "merchant checking synced policies" },
        },
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = data?.result?.content?.[0]?.text;
    return text || null;
  } catch {
    return null;
  }
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getChatSettings(session.shop);
  const policies = await fetchStorePolicies(session.shop);
  return { settings, policies, syncedAt: new Date().toISOString() };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  // Handle re-sync action
  if (formData.get("_action") === "resync") {
    const policies = await fetchStorePolicies(session.shop);
    return { resync: true, policies, syncedAt: new Date().toISOString() };
  }

  const data = {
    welcomeMessage: formData.get("welcomeMessage") || "",
    promptType: formData.get("promptType") || "standardAssistant",
    customInstructions: formData.get("customInstructions") || "",
    bubbleColor: formData.get("bubbleColor") || "#5046e4",
    supportHoursStart: formData.get("supportHoursStart") || "",
    supportHoursEnd: formData.get("supportHoursEnd") || "",
    supportTimezone: formData.get("supportTimezone") || "America/New_York",
    supportDays: formData.getAll("supportDays").join(",") || "",
  };

  try {
    await saveChatSettings(session.shop, data);
    return { success: true };
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

                {displayPolicies && (
                  <div style={{ backgroundColor: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", padding: "12px", maxHeight: "200px", overflowY: "auto" }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Synced Policies Preview</div>
                    <div style={{ fontSize: "13px", color: "#334155", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                      {typeof displayPolicies === 'string' ? displayPolicies.slice(0, 1000) : JSON.stringify(displayPolicies).slice(0, 1000)}
                      {(typeof displayPolicies === 'string' ? displayPolicies.length : JSON.stringify(displayPolicies).length) > 1000 && "..."}
                    </div>
                  </div>
                )}

                {!displayPolicies && (
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
                  Set when human support is available. Outside these hours, only AI chat is offered.
                  Leave start/end empty to disable human handoff entirely.
                </s-text>

                <s-inline gap="base">
                  <s-text-field
                    label="Start Time"
                    name="supportHoursStart"
                    type="time"
                    defaultValue={settings?.supportHoursStart || ""}
                    helpText="e.g. 09:00"
                    autoComplete="off"
                  />
                  <s-text-field
                    label="End Time"
                    name="supportHoursEnd"
                    type="time"
                    defaultValue={settings?.supportHoursEnd || ""}
                    helpText="e.g. 17:00"
                    autoComplete="off"
                  />
                </s-inline>

                <s-select
                  label="Timezone"
                  name="supportTimezone"
                  defaultValue={settings?.supportTimezone || "America/New_York"}
                >
                  <option value="America/New_York">Eastern (ET)</option>
                  <option value="America/Chicago">Central (CT)</option>
                  <option value="America/Denver">Mountain (MT)</option>
                  <option value="America/Los_Angeles">Pacific (PT)</option>
                  <option value="America/Anchorage">Alaska (AKT)</option>
                  <option value="Pacific/Honolulu">Hawaii (HT)</option>
                  <option value="Europe/London">London (GMT/BST)</option>
                  <option value="Europe/Paris">Central Europe (CET)</option>
                  <option value="Asia/Tokyo">Japan (JST)</option>
                  <option value="Asia/Shanghai">China (CST)</option>
                  <option value="Australia/Sydney">Sydney (AEST)</option>
                </s-select>

                <s-choice-list
                  title="Available Days"
                  name="supportDays"
                  allowMultiple
                  defaultValue={settings?.supportDays ? settings.supportDays.split(",") : ["Mon","Tue","Wed","Thu","Fri"]}
                >
                  <option value="Mon">Monday</option>
                  <option value="Tue">Tuesday</option>
                  <option value="Wed">Wednesday</option>
                  <option value="Thu">Thursday</option>
                  <option value="Fri">Friday</option>
                  <option value="Sat">Saturday</option>
                  <option value="Sun">Sunday</option>
                </s-choice-list>
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
