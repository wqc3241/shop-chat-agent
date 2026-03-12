/**
 * Product Handle Resolver
 * Resolves Shopify product GIDs to handles via the Admin GraphQL API.
 * Uses in-memory caching to avoid repeated lookups.
 */
import { unauthenticated } from "../shopify.server";

/** @type {Map<string, string>} GID → handle */
const handleCache = new Map();

/**
 * Resolves product GIDs to handles using the Shopify Admin GraphQL API.
 * Results are cached in memory so repeated calls for the same products are instant.
 *
 * @param {string[]} productGids - Array of Shopify product GIDs (e.g., "gid://shopify/Product/123")
 * @param {string} shopDomain - Shop hostname (e.g., "dev-nlp-brochure.myshopify.com")
 * @returns {Promise<Map<string, string>>} Map of GID → handle
 */
export async function resolveProductHandles(productGids, shopDomain) {
  if (!productGids?.length || !shopDomain) return handleCache;

  // Filter to GIDs not already cached
  const uncached = productGids.filter(gid => !handleCache.has(gid));
  if (uncached.length === 0) return handleCache;

  try {
    const { admin } = await unauthenticated.admin(shopDomain);

    const response = await admin.graphql(
      `query resolveHandles($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            handle
            onlineStoreUrl
          }
        }
      }`,
      { variables: { ids: uncached } }
    );

    const data = await response.json();

    for (const node of data?.data?.nodes || []) {
      if (node?.id && node?.handle) {
        handleCache.set(node.id, node.handle);
      }
    }

    console.log(`Resolved ${uncached.length} product handles (${handleCache.size} cached total)`);
  } catch (e) {
    // Graceful fallback — handles just won't be available for URL building
    console.warn('Failed to resolve product handles:', e.message);
  }

  return handleCache;
}
