/**
 * Tool Service
 * Manages tool execution and processing
 */
import { saveMessage } from "../db.server";
import AppConfig from "./config.server";

/**
 * Creates a tool service instance
 * @returns {Object} Tool service with methods for managing tools
 */
export function createToolService(storeDomain = '') {
  /**
   * Handles a tool error response
   * @param {Object} toolUseResponse - The error response from the tool
   * @param {string} toolName - The name of the tool
   * @param {string} toolUseId - The ID of the tool use request
   * @param {Array} conversationHistory - The conversation history
   * @param {Function} sendMessage - Function to send messages to the client
   * @param {string} conversationId - The conversation ID
   */
  const handleToolError = async (toolUseResponse, toolName, toolUseId, conversationHistory, sendMessage, conversationId) => {
    if (toolUseResponse.error.type === "auth_required") {
      console.log("Auth required for tool:", toolName);
      await addToolResultToHistory(conversationHistory, toolUseId, toolUseResponse.error.data, conversationId);
      sendMessage({ type: 'auth_required' });
    } else {
      console.log("Tool use error", toolUseResponse.error);
      await addToolResultToHistory(conversationHistory, toolUseId, toolUseResponse.error.data, conversationId);
    }
  };

  /**
   * Handles a successful tool response
   * @param {Object} toolUseResponse - The response from the tool
   * @param {string} toolName - The name of the tool
   * @param {string} toolUseId - The ID of the tool use request
   * @param {Array} conversationHistory - The conversation history
   * @param {Array} productsToDisplay - Array to add product results to
   * @param {string} conversationId - The conversation ID
   * @param {Object} toolArgs - The arguments passed to the tool call
   * @param {string|null} currentProductHandle - Handle of the product the user is currently viewing
   */
  const handleToolSuccess = async (toolUseResponse, toolName, toolUseId, conversationHistory, productsToDisplay, conversationId, toolArgs = {}, currentProductHandle = null) => {
    // Check if this is a product search result
    if (toolName === AppConfig.tools.productSearchName) {
      // Detect fitment search mode from context
      const isFitmentSearch = typeof toolArgs?.context === 'string'
        && toolArgs.context.includes('fitment_search:true');

      const maxProducts = isFitmentSearch
        ? AppConfig.tools.maxFitmentSearchProducts
        : undefined;

      let processedProducts = processProductSearchResult(toolUseResponse, maxProducts);

      // Exclude current product when searching for fitment alternatives
      if (currentProductHandle && isFitmentSearch) {
        processedProducts = processedProducts.filter(p =>
          p.handle !== currentProductHandle &&
          !(p.url && p.url.includes(`/products/${currentProductHandle}`))
        );
      }

      // For fitment searches, don't push to productsToDisplay (cards) —
      // the AI filters by reading descriptions and only mentions confirmed matches.
      // For normal searches, show product cards as usual.
      if (!isFitmentSearch) {
        productsToDisplay.push(...processedProducts);
      }
      
      // Enhance tool response content with formatted product information for AI reference
      // This ensures the AI has access to all product details in a structured format
      if (toolUseResponse.content && processedProducts.length > 0) {
        // Create enhanced content that includes both original response and formatted products
        const originalContent = Array.isArray(toolUseResponse.content) 
          ? toolUseResponse.content[0]?.text || toolUseResponse.content
          : toolUseResponse.content;
        
        // Parse original content if it's a string
        let parsedContent = originalContent;
        if (typeof originalContent === 'string') {
          try {
            parsedContent = JSON.parse(originalContent);
          } catch (e) {
            // If parsing fails, keep as string
            parsedContent = originalContent;
          }
        }
        
        // Add formatted products to the content for AI reference
        const enhancedContent = {
          ...parsedContent,
          formattedProducts: processedProducts.map(product => ({
            id: product.id,
            title: product.title,
            price: product.price,
            description: product.description,
            url: product.url,
            variants: product.variants,
            specifications: product.specifications,
            images: product.images,
            available: product.available,
            tags: product.tags,
            vendor: product.vendor,
            productType: product.productType
          }))
        };
        
        // Add enhanced content to conversation history
        await addToolResultToHistory(conversationHistory, toolUseId, enhancedContent, conversationId);
        return;
      }
    }

    // For non-product tools or if product processing didn't enhance content
    await addToolResultToHistory(conversationHistory, toolUseId, toolUseResponse.content, conversationId);
  };

  /**
   * Processes product search results and extracts complete product information
   * @param {Object} toolUseResponse - The response from the tool
   * @returns {Array} Processed product data with all available details
   */
  const processProductSearchResult = (toolUseResponse, maxProductsOverride) => {
    try {
      console.log("Processing product search result with comprehensive data extraction");
      let products = [];

      if (toolUseResponse.content && toolUseResponse.content.length > 0) {
        const content = toolUseResponse.content[0].text;

        try {
          let responseData;
          if (typeof content === 'object') {
            responseData = content;
          } else if (typeof content === 'string') {
            responseData = JSON.parse(content);
          }

          if (responseData?.products && Array.isArray(responseData.products)) {
            // Process all products with complete data extraction
            const allProducts = responseData.products.map(formatProductData);
            
            // Limit for display purposes but preserve all data
            const maxProducts = Number.isInteger(maxProductsOverride) && maxProductsOverride > 0
              ? maxProductsOverride
              : AppConfig.tools.maxProductsToDisplay;
            products = allProducts.slice(0, maxProducts);

            console.log(`Found ${responseData.products.length} total products, displaying ${products.length} with comprehensive details`);
            console.log(`Product details include: variants, specifications, images, inventory, and metadata`);
          }
        } catch (e) {
          console.error("Error parsing product data:", e);
        }
      }

      return products;
    } catch (error) {
      console.error("Error processing product search results:", error);
      return [];
    }
  };

  /**
   * Formats a product data object with ALL available product details
   * @param {Object} product - Raw product data
   * @returns {Object} Formatted product data with comprehensive information
   */
  const formatProductData = (product) => {
    // Extract price information
    const price = product.price_range
      ? `${product.price_range.currency} ${product.price_range.min}${product.price_range.max && product.price_range.max !== product.price_range.min ? ` - ${product.price_range.max}` : ''}`
      : (product.variants && product.variants.length > 0
        ? `${product.variants[0].currency} ${product.variants[0].price}`
        : 'Price not available');

    // Extract all variant details
    const variants = product.variants ? product.variants.map(variant => ({
      id: variant.id,
      title: variant.title,
      price: variant.price,
      currency: variant.currency,
      sku: variant.sku,
      available: variant.available,
      availableForSale: variant.availableForSale,
      weight: variant.weight,
      weightUnit: variant.weightUnit,
      compareAtPrice: variant.compareAtPrice,
      selectedOptions: variant.selectedOptions || []
    })) : [];

    // Extract all images
    const images = product.images ? product.images.map(img => ({
      url: img.url || img.src,
      alt: img.alt || product.title
    })) : (product.image_url ? [{ url: product.image_url, alt: product.title }] : []);

    // Extract specifications and metadata
    const specifications = {
      dimensions: product.dimensions || null,
      weight: product.weight || null,
      weightUnit: product.weightUnit || null,
      materials: product.materials || null,
      features: product.features || null,
      vendor: product.vendor || null,
      productType: product.productType || product.type || null,
      tags: product.tags || [],
      collections: product.collections || []
    };

    const productUrl = buildProductUrl(product);

    // Build comprehensive product object
    const formattedProduct = {
      // Basic information
      id: product.product_id || product.id || `product-${Math.random().toString(36).substring(7)}`,
      title: product.title || 'Product',
      price: price,
      description: product.description || product.body_html || '',
      url: productUrl,
      
      // Images - include all available images
      image_url: images.length > 0 ? images[0].url : '',
      images: images,
      
      // Variants - all variant details
      variants: variants,
      variantCount: variants.length,
      
      // Specifications and metadata
      specifications: specifications,
      vendor: specifications.vendor,
      productType: specifications.productType,
      tags: specifications.tags,
      collections: specifications.collections,
      
      // Inventory information
      available: product.available !== undefined ? product.available : null,
      availableForSale: product.availableForSale !== undefined ? product.availableForSale : null,
      
      // Additional metadata
      handle: product.handle || product?._raw?.handle || null,
      createdAt: product.createdAt || null,
      updatedAt: product.updatedAt || null
    };

    // Include full raw product data for reference (useful for detailed queries)
    formattedProduct._raw = product;

    return formattedProduct;
  };

  // Derive the store base URL (e.g. "https://dev-nlp-brochure.myshopify.com")
  // from the Origin header passed via createToolService(storeDomain).
  let storeBaseUrl = '';
  if (storeDomain) {
    try {
      const parsed = new URL(storeDomain);
      storeBaseUrl = parsed.origin; // "https://example.myshopify.com"
    } catch {
      // If it's just a hostname like "dev-nlp-brochure.myshopify.com"
      storeBaseUrl = `https://${storeDomain.replace(/^https?:\/\//, '')}`;
    }
  }

  const buildProductUrl = (product) => {
    const directUrl =
      product.url ||
      product.onlineStoreUrl ||
      product.productUrl ||
      product.product_url ||
      "";

    if (typeof directUrl === "string" && directUrl.trim() !== "") {
      // If it's already absolute, return as-is
      if (directUrl.startsWith('http')) return directUrl;
      // If relative, prepend store domain
      return storeBaseUrl ? `${storeBaseUrl}${directUrl.startsWith('/') ? '' : '/'}${directUrl}` : directUrl;
    }

    const handle =
      product.handle ||
      product.product_handle ||
      product?._raw?.handle ||
      product?._raw?.product_handle ||
      product.slug ||
      "";

    if (typeof handle === "string" && handle.trim() !== "") {
      const path = `/products/${handle.trim()}`;
      return storeBaseUrl ? `${storeBaseUrl}${path}` : path;
    }

    const title = typeof product.title === "string" ? product.title.trim() : "";
    if (title) {
      const inferredHandle = slugifyToHandle(title);
      if (inferredHandle) {
        const path = `/products/${inferredHandle}`;
        return storeBaseUrl ? `${storeBaseUrl}${path}` : path;
      }
    }

    return "";
  };

  const slugifyToHandle = (value) => {
    if (!value || typeof value !== "string") return "";
    return value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  /**
   * Adds a tool result to the conversation history
   * @param {Array} conversationHistory - The conversation history
   * @param {string} toolUseId - The ID of the tool use request
   * @param {string} content - The content of the tool result
   * @param {string} conversationId - The conversation ID
   */
  const addToolResultToHistory = async (conversationHistory, toolUseId, content, conversationId) => {
    const toolResultMessage = {
      role: 'user',
      content: [{
        type: "tool_result",
        tool_use_id: toolUseId,
        content: content
      }]
    };

    // Add to in-memory history
    conversationHistory.push(toolResultMessage);

    // Save to database with special format to indicate tool result
    if (conversationId) {
      try {
        await saveMessage(conversationId, 'user', JSON.stringify(toolResultMessage.content));
      } catch (error) {
        console.error('Error saving tool result to database:', error);
      }
    }
  };

  return {
    handleToolError,
    handleToolSuccess,
    processProductSearchResult,
    addToolResultToHistory
  };
}

export default {
  createToolService
};
