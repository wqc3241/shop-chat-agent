import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getConversationWithMessages } from "../db.server";

export const loader = async ({ request, params }) => {
  await authenticate.admin(request);
  const conversation = await getConversationWithMessages(params.id);

  if (!conversation) {
    throw new Response("Conversation not found", { status: 404 });
  }

  return { conversation };
};

function formatDate(dateString) {
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseMessageContent(content) {
  try {
    const parsed = JSON.parse(content);
    // If parsed is an array of content blocks, extract text
    if (Array.isArray(parsed)) {
      return parsed
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    }
    if (typeof parsed === "string") return parsed;
    return content;
  } catch {
    return content;
  }
}

export default function ConversationDetail() {
  const { conversation } = useLoaderData();
  const messages = conversation.messages || [];

  return (
    <s-page
      heading={`Conversation ${conversation.id.slice(0, 12)}…`}
      backAction={{ content: "Back", url: "/app" }}
      primaryAction={{
        content: "Live Chat",
        url: `/app/live-chat?conversation=${conversation.id}`,
      }}
    >
      {/* Messages */}
      <s-section>
        <s-card>
          <s-box padding="base">
            {messages.length === 0 ? (
              <s-text tone="subdued">No messages in this conversation.</s-text>
            ) : (
              <s-stack gap="base">
                {messages.map((msg) => (
                  <s-box
                    key={msg.id}
                    padding="base"
                    background={
                      msg.role === "user"
                        ? "var(--p-color-bg-surface-secondary)"
                        : undefined
                    }
                    borderRadius="large"
                    style={{
                      backgroundColor:
                        msg.role === "user" ? "#f6f6f7" : "#eef4ff",
                      borderRadius: "8px",
                      padding: "12px 16px",
                      marginBottom: "4px",
                    }}
                  >
                    <s-stack gap="tight">
                      <s-text
                        variant="bodySm"
                        fontWeight="semibold"
                        tone={msg.role === "user" ? undefined : "info"}
                      >
                        {msg.role === "user" ? "Customer" : "AI Assistant"}
                      </s-text>
                      <s-text variant="bodyMd">
                        {parseMessageContent(msg.content)}
                      </s-text>
                      <s-text variant="bodySm" tone="subdued">
                        {formatDate(msg.createdAt)}
                      </s-text>
                    </s-stack>
                  </s-box>
                ))}
              </s-stack>
            )}
          </s-box>
        </s-card>
      </s-section>

      {/* Sidebar: Details */}
      <s-section heading="Details" slot="aside">
        <s-stack gap="base">
          <div>
            <s-text variant="bodySm" tone="subdued">Started</s-text>
            <s-text variant="bodyMd">{formatDate(conversation.createdAt)}</s-text>
          </div>
          <div>
            <s-text variant="bodySm" tone="subdued">Last activity</s-text>
            <s-text variant="bodyMd">{formatDate(conversation.updatedAt)}</s-text>
          </div>
          <div>
            <s-text variant="bodySm" tone="subdued">Messages</s-text>
            <s-text variant="bodyMd">{messages.length}</s-text>
          </div>
          <div>
            <s-text variant="bodySm" tone="subdued">Page</s-text>
            <s-text variant="bodyMd">{conversation.pageUrl || "—"}</s-text>
          </div>
          <div>
            <s-text variant="bodySm" tone="subdued">Orders</s-text>
            <s-text variant="bodyMd">
              {conversation.orderNumbers || "None"}
            </s-text>
          </div>
          <div>
            <s-text variant="bodySm" tone="subdued">Customer</s-text>
            <s-text variant="bodyMd">
              {conversation.customerEmail || "Not authenticated"}
            </s-text>
          </div>
        </s-stack>
      </s-section>
    </s-page>
  );
}
