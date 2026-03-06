/**
 * Web Search Service
 * Uses OpenAI's built-in web search tool behind the app's existing tool interface.
 */
import "../env.server.js";
import OpenAI from "openai";

const webSearchClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Creates a web search tool definition for the model tool loop.
 * This remains a custom app tool name so the existing chat pipeline does not need
 * to switch from Chat Completions to the Responses API.
 * @returns {Object} Tool definition
 */
export function getWebSearchTool() {
  return {
    name: "web_search",
    description: "Search the internet for current information, product specifications, vehicle fitment data, compatibility information, and other publicly available information. Use this tool when information is not available in store or catalog data.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query. For fitment questions, include the product name, part number if known, vehicle year/make/model, and keywords like fitment or compatibility.",
        },
      },
      required: ["query"],
    },
  };
}

async function searchWebWithOpenAI(query) {
  const response = await webSearchClient.responses.create({
    model: "gpt-4o-mini",
    input: `Search the web for this query and summarize the most relevant results with source links: ${query}`,
    tools: [{ type: "web_search" }],
  });

  const text = response.output_text?.trim();
  if (!text) {
    return {
      query,
      text: `I searched the web for "${query}" but did not get usable results back.`,
    };
  }

  return { query, text };
}

/**
 * Executes a web search and formats the result as a tool response.
 * @param {Object} args - Search arguments
 * @param {string} args.query - The search query
 * @returns {Promise<Object>} Tool response
 */
export async function executeWebSearch(args) {
  const { query } = args || {};

  if (!query || query.trim() === "") {
    return {
      error: {
        code: -32602,
        message: "Invalid params",
        data: "Query parameter is required",
      },
    };
  }

  try {
    const result = await searchWebWithOpenAI(query.trim());
    return {
      content: [{
        type: "text",
        text: `Web search results for "${result.query}":\n\n${result.text}`,
      }],
    };
  } catch (error) {
    console.error("Web search execution error:", error);
    return {
      error: {
        code: -32603,
        message: "Internal error",
        data: `Web search failed: ${error.message}`,
      },
    };
  }
}

export default {
  getWebSearchTool,
  executeWebSearch,
};
