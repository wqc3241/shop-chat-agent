import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { getConversationsForShop, getDashboardMetrics } from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [metrics, { conversations }] = await Promise.all([
    getDashboardMetrics(shop),
    getConversationsForShop(shop, 25, 0),
  ]);

  return { shop, metrics, conversations };
};

function timeAgo(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncate(str, len = 40) {
  if (!str) return "—";
  return str.length > len ? str.slice(0, len) + "…" : str;
}

export default function Dashboard() {
  const { metrics, conversations } = useLoaderData();
  const navigate = useNavigate();

  return (
    <s-page heading="Chat Agent">
      <s-box slot="header-actions">
        <s-button href="/app/settings" variant="secondary">
          Settings
        </s-button>
      </s-box>

      {/* Metrics cards */}
      <s-section>
        <s-grid columns="3" gap="base">
          <s-card>
            <s-box padding="base">
              <s-text variant="bodyMd" tone="subdued">Total Conversations</s-text>
              <s-heading element="h2">{metrics.total}</s-heading>
            </s-box>
          </s-card>
          <s-card>
            <s-box padding="base">
              <s-text variant="bodyMd" tone="subdued">Today</s-text>
              <s-heading element="h2">{metrics.today}</s-heading>
            </s-box>
          </s-card>
          <s-card>
            <s-box padding="base">
              <s-text variant="bodyMd" tone="subdued">With Orders</s-text>
              <s-heading element="h2">{metrics.withOrders}</s-heading>
            </s-box>
          </s-card>
        </s-grid>
      </s-section>

      {/* Conversations list */}
      <s-section heading="Recent Conversations">
        {conversations.length === 0 ? (
          <s-card>
            <s-box padding="extraLarge">
              <s-stack gap="base" align="center">
                <s-text tone="subdued">
                  No conversations yet. Chat activity will appear here once
                  customers start using the chat widget.
                </s-text>
              </s-stack>
            </s-box>
          </s-card>
        ) : (
          <s-card>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--p-color-border-secondary)" }}>
                  <th style={thStyle}>Conversation</th>
                  <th style={thStyle}>Started</th>
                  <th style={thStyle}>Messages</th>
                  <th style={thStyle}>Orders</th>
                  <th style={thStyle}>Page</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((conv) => (
                  <tr
                    key={conv.id}
                    onClick={() => navigate(`/app/conversations/${conv.id}`)}
                    onKeyDown={(e) => { if (e.key === "Enter") navigate(`/app/conversations/${conv.id}`); }}
                    tabIndex={0}
                    role="link"
                    style={{
                      borderBottom: "1px solid var(--p-color-border-secondary)",
                      cursor: "pointer",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "var(--p-color-bg-surface-hover)")}
                    onFocus={(e) => (e.currentTarget.style.backgroundColor = "var(--p-color-bg-surface-hover)")}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "")}
                    onBlur={(e) => (e.currentTarget.style.backgroundColor = "")}
                  >
                    <td style={tdStyle}>
                      <s-text variant="bodyMd" fontWeight="semibold">
                        {conv.id.slice(0, 8)}…
                      </s-text>
                    </td>
                    <td style={tdStyle}>
                      <s-text variant="bodyMd">{timeAgo(conv.createdAt)}</s-text>
                    </td>
                    <td style={tdStyle}>
                      <s-text variant="bodyMd">{conv._count.messages}</s-text>
                    </td>
                    <td style={tdStyle}>
                      {conv.orderNumbers ? (
                        <s-badge>{conv.orderNumbers}</s-badge>
                      ) : (
                        <s-text tone="subdued">—</s-text>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <s-text variant="bodyMd" tone="subdued">
                        {truncate(conv.pageUrl)}
                      </s-text>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </s-card>
        )}
      </s-section>

      {/* Sidebar */}
      <s-section heading="Knowledge Base" slot="aside">
        <s-stack gap="base">
          <s-text>
            Configure your store policies and FAQs in the Shopify Knowledge Base
            app. The chat agent automatically uses this data to answer customer
            questions.
          </s-text>
          <s-button
            href="https://admin.shopify.com/store/knowledge-base"
            target="_blank"
            variant="secondary"
          >
            Open Knowledge Base
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Quick Setup" slot="aside">
        <s-stack gap="base">
          <s-text>
            1. Enable the chat widget in your theme editor
          </s-text>
          <s-text>
            2. Configure settings (welcome message, AI behavior)
          </s-text>
          <s-text>
            3. Add custom instructions for your store
          </s-text>
          <s-button href="/app/settings" variant="tertiary">
            Go to Settings
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

const thStyle = {
  textAlign: "left",
  padding: "12px 16px",
  fontWeight: 600,
  fontSize: "13px",
  color: "var(--p-color-text-secondary)",
};

const tdStyle = {
  padding: "12px 16px",
  fontSize: "14px",
};
