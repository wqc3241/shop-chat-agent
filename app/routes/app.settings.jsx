import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server";
import { getChatSettings, saveChatSettings } from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getChatSettings(session.shop);
  return { settings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const data = {
    welcomeMessage: formData.get("welcomeMessage") || "",
    promptType: formData.get("promptType") || "standardAssistant",
    customInstructions: formData.get("customInstructions") || "",
    bubbleColor: formData.get("bubbleColor") || "#5046e4",
  };

  try {
    await saveChatSettings(session.shop, data);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export default function Settings() {
  const { settings } = useLoaderData();
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

                <s-text-area
                  label="Custom Instructions"
                  name="customInstructions"
                  defaultValue={settings?.customInstructions || ""}
                  rows="6"
                  helpText="Extra context for the AI beyond what's in the Shopify Knowledge Base. E.g., brand voice, promotions, warranty details."
                />

                <s-banner tone="info">
                  For store policies and FAQs, use the{" "}
                  <s-link
                    href="https://admin.shopify.com/store/knowledge-base"
                    target="_blank"
                  >
                    Shopify Knowledge Base
                  </s-link>{" "}
                  app — the chat agent reads that data automatically.
                </s-banner>
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
