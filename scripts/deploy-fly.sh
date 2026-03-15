#!/bin/bash
# Deploy Shop Chat Agent to Fly.io
# Usage: bash scripts/deploy-fly.sh
#
# Prerequisites:
#   - flyctl installed (https://fly.io/docs/hands-on/install-flyctl/)
#   - Authenticated: fly auth login
#
# First-time setup (run once):
#   fly apps create shop-chat-agent
#   fly postgres create --name shop-chat-agent-db --region iad
#   fly postgres attach shop-chat-agent-db
#   fly secrets set SHOPIFY_API_KEY=<your-key> SHOPIFY_API_SECRET=<your-secret> OPENAI_API_KEY=<your-key>
#
# After deploy, update shopify.app.shop-chat-agent.toml with your Fly domain:
#   application_url = "https://shop-chat-agent.fly.dev"
#   [auth] redirect_urls = ["https://shop-chat-agent.fly.dev/api/auth"]
#   [app_proxy] url = "https://shop-chat-agent.fly.dev"
#   [customer_authentication] redirect_uris = ["https://shop-chat-agent.fly.dev/callback"]
# Then: shopify app deploy

set -euo pipefail

echo "==> Deploying to Fly.io..."
fly deploy

echo ""
echo "==> Checking deployment status..."
fly status

echo ""
echo "==> Health check..."
APP_URL=$(fly info --json 2>/dev/null | grep -o '"Hostname":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$APP_URL" ]; then
  echo "Testing: https://$APP_URL/health"
  curl -sf "https://$APP_URL/health" && echo " OK" || echo " FAILED"
else
  echo "Could not determine app URL. Check: fly open /health"
fi

echo ""
echo "Deploy complete!"
