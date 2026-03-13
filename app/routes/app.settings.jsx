import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server";
import { getChatSettings, saveChatSettings } from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getChatSettings(session.shop);
  return { settings, shop: session.shop };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const data = {
    welcomeMessage: formData.get("welcomeMessage") || "",
    promptType: formData.get("promptType") || "standardAssistant",
    customInstructions: formData.get("customInstructions") || "",
    returnPolicy: formData.get("returnPolicy") || "",
    contactInfo: formData.get("contactInfo") || "",
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
  const { settings, shop } = useLoaderData();
  const storeHandle = shop.replace(".myshopify.com", "");
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

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

                <s-text-area
                  label="Return Policy"
                  name="returnPolicy"
                  defaultValue={settings?.returnPolicy || ""}
                  rows="4"
                  helpText="Your return, exchange, and refund policy details."
                />

                <s-text-area
                  label="Contact Information"
                  name="contactInfo"
                  defaultValue={settings?.contactInfo || ""}
                  rows="3"
                  helpText="Phone, email, hours, address — anything customers ask about."
                />

                <s-text-area
                  label="Other Knowledge"
                  name="customInstructions"
                  defaultValue={settings?.customInstructions || ""}
                  rows="4"
                  helpText="Brand voice, promotions, warranty, anything else the AI should know."
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
