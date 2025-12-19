/**
 * Web Search Service
 * Provides web search functionality for the chatbot
 */
import "../env.server.js";

/**
 * Performs a web search using DuckDuckGo (free, no API key required)
 * @param {string} query - The search query
 * @returns {Promise<Object>} Search results
 */
async function searchWeb(query) {
  try {
    // Use DuckDuckGo instant answer API first (simpler, more reliable)
    const instantAnswerUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const instantResponse = await fetch(instantAnswerUrl);
    const instantData = await instantResponse.json();
    
    const results = [];
    
    // Add instant answer if available
    if (instantData.AbstractText || instantData.Answer) {
      results.push({
        title: instantData.Heading || 'Instant Answer',
        snippet: instantData.AbstractText || instantData.Answer,
        url: instantData.AbstractURL || ''
      });
    }
    
    // Try to get related topics
    if (instantData.RelatedTopics && instantData.RelatedTopics.length > 0) {
      instantData.RelatedTopics.slice(0, 4).forEach(topic => {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || 'Related Topic',
            snippet: topic.Text,
            url: topic.FirstURL
          });
        }
      });
    }
    
    // If we have results, return them
    if (results.length > 0) {
      return {
        query,
        results: results.slice(0, 5),
        totalResults: results.length
      };
    }
    
    // Fallback: Use DuckDuckGo HTML search
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const htmlResponse = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (htmlResponse.ok) {
      const html = await htmlResponse.text();
      const parsedResults = parseDuckDuckGoResults(html);
      
      if (parsedResults.length > 0) {
        return {
          query,
          results: parsedResults.slice(0, 5),
          totalResults: parsedResults.length
        };
      }
    }
    
    // If all else fails, return a helpful message
    return {
      query,
      results: [{
        title: 'Search Information',
        snippet: `I searched for "${query}" but couldn't find specific results. You may want to check the manufacturer's website or contact them directly for fitment information.`,
        url: ''
      }],
      totalResults: 1
    };
  } catch (error) {
    console.error('Web search error:', error);
    return {
      query,
      results: [{
        title: 'Search Unavailable',
        snippet: 'Web search is currently unavailable. Please try again later or check the manufacturer\'s website directly.',
        url: ''
      }],
      totalResults: 1,
      error: error.message
    };
  }
}

/**
 * Parses DuckDuckGo HTML search results
 * @param {string} html - HTML content from DuckDuckGo
 * @returns {Array} Array of search results
 */
function parseDuckDuckGoResults(html) {
  const results = [];
  
  // DuckDuckGo HTML structure - extract result links
  const linkRegex = /<a class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  const snippetRegex = /<a class="result__snippet"[^>]*>([^<]+)<\/a>/g;
  
  let match;
  const links = [];
  while ((match = linkRegex.exec(html)) !== null) {
    links.push({
      url: match[1],
      title: match[2]
    });
  }
  
  const snippets = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(match[1]);
  }
  
  // Combine links and snippets
  for (let i = 0; i < Math.min(links.length, snippets.length); i++) {
    results.push({
      title: links[i].title,
      snippet: snippets[i],
      url: links[i].url
    });
  }
  
  return results;
}

/**
 * Creates a web search tool definition for OpenAI function calling
 * @returns {Object} Tool definition
 */
export function getWebSearchTool() {
  return {
    name: "web_search",
    description: "Search the internet for current information, product specifications, vehicle fitment data, compatibility information, and other publicly available information. Use this tool when you need to find information that is not in the product catalog, especially for vehicle fitment questions, product compatibility, specifications, or reviews.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query. For fitment questions, include product name, SKU, part number, vehicle make/model/year, and 'fitment' or 'compatibility'. Example: 'Air Lift 11-23 Dodge Charger fitment 2025 Audi A5'"
        }
      },
      required: ["query"]
    }
  };
}

/**
 * Executes a web search
 * @param {Object} args - Search arguments
 * @param {string} args.query - The search query
 * @returns {Promise<Object>} Search results in MCP tool response format
 */
export async function executeWebSearch(args) {
  const { query } = args;
  
  if (!query || query.trim() === '') {
    return {
      error: {
        code: -32602,
        message: "Invalid params",
        data: "Query parameter is required"
      }
    };
  }

  try {
    const searchResults = await searchWeb(query);
    
    if (searchResults.error) {
      return {
        error: {
          code: -32603,
          message: "Internal error",
          data: searchResults.error
        }
      };
    }

    // Format results for AI consumption
    const formattedResults = searchResults.results.map((result, index) => {
      return `${index + 1}. **${result.title}**\n   ${result.snippet}\n   Source: ${result.url}`;
    }).join('\n\n');

    return {
      content: [{
        type: "text",
        text: `Web search results for "${query}":\n\n${formattedResults}\n\nTotal results found: ${searchResults.totalResults}`
      }]
    };
  } catch (error) {
    console.error('Web search execution error:', error);
    return {
      error: {
        code: -32603,
        message: "Internal error",
        data: `Web search failed: ${error.message}`
      }
    };
  }
}

export default {
  getWebSearchTool,
  executeWebSearch,
  searchWeb
};

