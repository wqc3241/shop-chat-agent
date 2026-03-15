/**
 * Privacy Policy Page
 * Public page (no auth required) accessible at /privacy.
 */

export default function PrivacyPolicy() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Privacy Policy - Shop Chat Agent</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                line-height: 1.7;
                color: #1a1a2e;
                background-color: #fafafa;
              }
              .container {
                max-width: 740px;
                margin: 0 auto;
                padding: 48px 24px 80px;
              }
              h1 {
                font-size: 2rem;
                font-weight: 700;
                margin-bottom: 8px;
                color: #0d0d0d;
              }
              .last-updated {
                font-size: 0.875rem;
                color: #6b7280;
                margin-bottom: 40px;
              }
              h2 {
                font-size: 1.25rem;
                font-weight: 600;
                margin-top: 36px;
                margin-bottom: 12px;
                color: #0d0d0d;
              }
              p { margin-bottom: 16px; }
              ul {
                margin-bottom: 16px;
                padding-left: 24px;
              }
              li { margin-bottom: 8px; }
              a { color: #2563eb; text-decoration: none; }
              a:hover { text-decoration: underline; }
              .divider {
                border: none;
                border-top: 1px solid #e5e7eb;
                margin: 40px 0;
              }
            `,
          }}
        />
      </head>
      <body>
        <div className="container">
          <h1>Privacy Policy</h1>
          <p className="last-updated">Last updated: March 14, 2026</p>

          <p>
            This Privacy Policy describes how <strong>Shop Chat Agent</strong>{" "}
            ("we", "our", or "the App") collects, uses, and shares information
            when you interact with the chat widget installed on a Shopify
            storefront. By using the chat feature, you agree to the practices
            described in this policy.
          </p>

          <h2>1. Information We Collect</h2>
          <p>
            When you use the Shop Chat Agent chat widget, we may collect the
            following information:
          </p>
          <ul>
            <li>
              <strong>Chat messages</strong> — the text content of conversations
              you have with the AI assistant.
            </li>
            <li>
              <strong>Email address</strong> — if you voluntarily provide it
              during a conversation.
            </li>
            <li>
              <strong>Order numbers</strong> — when referenced or extracted from
              your conversations (for example, when checking order status).
            </li>
            <li>
              <strong>Page context</strong> — the URL and title of the page
              where your conversation starts.
            </li>
            <li>
              <strong>Browsing activity</strong> — while the chat widget is
              open, we collect the page you are currently viewing, the product
              being viewed (if any), and the contents of your shopping cart. This
              information helps the assistant provide relevant answers.
            </li>
            <li>
              <strong>Authentication tokens</strong> — if you authenticate via
              your customer account, OAuth tokens are stored to enable
              account-related features such as order tracking.
            </li>
          </ul>

          <h2>2. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>
              Provide AI-powered chat responses to your questions about
              products, orders, store policies, and more.
            </li>
            <li>
              Maintain conversation context so that follow-up messages are
              relevant and coherent.
            </li>
            <li>
              Enable order tracking and other authenticated account features
              when you choose to sign in.
            </li>
            <li>
              Allow store merchants to review conversations and provide human
              support when requested.
            </li>
          </ul>

          <h2>3. Third-Party Services</h2>
          <p>
            To generate AI-powered responses, your chat messages are sent to{" "}
            <strong>OpenAI</strong> via their API. OpenAI processes message
            content to produce a response and is subject to{" "}
            <a
              href="https://openai.com/policies/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenAI's Privacy Policy
            </a>
            . We do not sell your data to any third party.
          </p>

          <h2>4. Data Retention</h2>
          <ul>
            <li>
              <strong>Conversation data</strong> (messages, email addresses,
              order numbers, and browsing activity) is automatically deleted
              after <strong>90 days</strong>.
            </li>
            <li>
              <strong>Authentication tokens</strong> that have expired are
              cleaned up automatically on a regular basis.
            </li>
          </ul>

          <h2>5. Data Sharing</h2>
          <p>
            Your information is shared only with the following parties and only
            as described:
          </p>
          <ul>
            <li>
              <strong>The store merchant</strong> — merchants who install the
              App can view chat conversations and customer activity to provide
              support.
            </li>
            <li>
              <strong>OpenAI</strong> — message content is sent to OpenAI for
              AI response generation, as described in Section 3.
            </li>
            <li>
              <strong>Shopify</strong> — the App operates within the Shopify
              platform and is subject to{" "}
              <a
                href="https://www.shopify.com/legal/privacy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Shopify's Privacy Policy
              </a>
              .
            </li>
          </ul>

          <h2>6. Your Rights (GDPR and Global Privacy)</h2>
          <p>
            We support your right to access, correct, and delete your personal
            data:
          </p>
          <ul>
            <li>
              <strong>Access and portability</strong> — you can request a copy
              of the data we hold about you by contacting the store where you
              used the chat widget, or through your Shopify customer account.
            </li>
            <li>
              <strong>Deletion</strong> — you can request deletion of your data
              by contacting the store. When a store processes a customer data
              deletion request, we delete all associated conversation data and
              personal information (handled via the Shopify{" "}
              <code>customers/redact</code> webhook).
            </li>
            <li>
              <strong>App uninstall</strong> — when a merchant uninstalls the
              App, all shop data including conversations, messages, and customer
              information is permanently deleted (handled via the Shopify{" "}
              <code>shop/redact</code> webhook).
            </li>
          </ul>

          <h2>7. Data Security</h2>
          <p>
            We take reasonable measures to protect your information, including
            encrypted data transmission (HTTPS), secure token storage, and
            automatic cleanup of expired credentials. However, no method of
            electronic transmission or storage is completely secure.
          </p>

          <h2>8. Children's Privacy</h2>
          <p>
            The App is not directed at children under 13 (or under 16 in the
            European Economic Area). We do not knowingly collect personal
            information from children. If you believe a child has provided us
            with personal information, please contact the store merchant so we
            can delete it.
          </p>

          <h2>9. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Changes will be
            reflected on this page with an updated "Last updated" date. Your
            continued use of the chat widget after any changes constitutes
            acceptance of the updated policy.
          </p>

          <h2>10. Contact</h2>
          <p>
            If you have questions about this Privacy Policy or your data, please
            contact the store where you used the Shop Chat Agent chat widget.
            The store merchant is the data controller for information collected
            through the App.
          </p>

          <hr className="divider" />

          <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            Shop Chat Agent is a Shopify app. This policy applies to the chat
            widget functionality provided by the App and does not cover the
            store's own privacy practices.
          </p>
        </div>
      </body>
    </html>
  );
}
