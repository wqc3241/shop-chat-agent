/**
 * OpenAI Service
 * Manages interactions with the OpenAI API
 */
import "../env.server.js"; // Ensure environment variables are loaded
import OpenAI from "openai";
import AppConfig from "./config.server";
import systemPrompts from "../prompts/prompts.json";

/**
 * Creates an OpenAI service instance
 * @param {string} apiKey - OpenAI API key
 * @returns {Object} OpenAI service with methods for interacting with OpenAI API
 */
export function createOpenAIService(apiKey = process.env.OPENAI_API_KEY) {
  // Validate API key before creating client
  if (!apiKey) {
    throw new Error("OpenAI API key is not set. Please set OPENAI_API_KEY in your .env file.");
  }

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: apiKey
  });

  /**
   * Converts MCP tools format to OpenAI function calling format
   * @param {Array} tools - MCP tools array
   * @returns {Array} OpenAI functions array
   */
  const convertToolsToOpenAIFormat = (tools) => {
    if (!tools || tools.length === 0) return undefined;

    return tools.map(tool => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || "",
        parameters: tool.inputSchema || {}
      }
    }));
  };

  /**
   * Converts messages from stored format to OpenAI format
   * @param {Array} messages - Messages in stored format
   * @returns {Array} Messages in OpenAI format
   */
  const convertMessagesToOpenAIFormat = (messages) => {
    const openaiMessages = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      let content = msg.content;

      // Handle tool_result messages (these come after assistant messages with tool_calls)
      if (Array.isArray(content) && content.some(block => block.type === "tool_result")) {
        // Tool results need to be added as separate "tool" role messages
        for (const block of content) {
          if (block.type === "tool_result") {
            openaiMessages.push({
              role: "tool",
              tool_call_id: block.tool_use_id,
              content: typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content)
            });
          }
        }
        continue;
      }

      // Handle tool_use messages (convert to assistant message with function call format)
      if (Array.isArray(content) && content.some(block => block.type === "tool_use")) {
        const toolUses = content.filter(block => block.type === "tool_use");
        const textBlocks = content.filter(block => block.type === "text");
        const textContent = textBlocks.map(block => block.text).join("");

        openaiMessages.push({
          role: "assistant",
          content: textContent || null,
          tool_calls: toolUses.map(toolUse => ({
            id: toolUse.id,
            type: "function",
            function: {
              name: toolUse.name,
              arguments: JSON.stringify(toolUse.input)
            }
          }))
        });
        continue;
      }

      // Handle regular text content
      // If content is an array, convert to string
      if (Array.isArray(content)) {
        content = content.map(block => {
          if (block.type === "text") {
            return block.text;
          }
          return "";
        }).join("");
      }

      // Convert to OpenAI message format
      openaiMessages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: typeof content === "string" ? content : JSON.stringify(content)
      });
    }

    return openaiMessages;
  };

  /**
   * Streams a conversation with OpenAI
   * @param {Object} params - Stream parameters
   * @param {Array} params.messages - Conversation history
   * @param {string} params.promptType - The type of system prompt to use
   * @param {Array} params.tools - Available tools for OpenAI
   * @param {Object} streamHandlers - Stream event handlers
   * @param {Function} streamHandlers.onText - Handles text chunks
   * @param {Function} streamHandlers.onMessage - Handles complete messages
   * @param {Function} streamHandlers.onToolUse - Handles tool use requests
   * @returns {Promise<Object>} The final message
   */
  const streamConversation = async ({
    messages,
    promptType = AppConfig.api.defaultPromptType,
    tools
  }, streamHandlers) => {
    try {
      // Get system prompt from configuration or use default
      const systemInstruction = [
        getSystemPrompt(promptType),
        "Use the web_search tool when a question needs current events, external facts, or information not in store/catalog data.",
        "Be concise. For fitment compatibility questions, provide clear details about which products fit and why. For simple questions, keep responses brief."
      ].join("\n\n");

      // Convert messages to OpenAI format
      const openaiMessages = convertMessagesToOpenAIFormat(messages);

      // Add system message
      const messagesWithSystem = [
        { role: "system", content: systemInstruction },
        ...openaiMessages
      ];

      // Convert tools to OpenAI format
      const openaiTools = convertToolsToOpenAIFormat(tools);

      // Validate API key
      if (!apiKey) {
        throw new Error("OpenAI API key is not set. Please set OPENAI_API_KEY in your environment variables.");
      }

      // Create stream
      const stream = await openai.beta.chat.completions.stream({
        model: AppConfig.api.defaultModel,
        max_completion_tokens: AppConfig.api.maxTokens,
        messages: messagesWithSystem,
        tools: openaiTools,
        stream: true
      });

    let accumulatedContent = "";
    let toolCalls = [];

    // Process stream chunks
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (!delta) continue;

      // Handle text content
      if (delta.content) {
        accumulatedContent += delta.content;
        if (streamHandlers.onText) {
          streamHandlers.onText(delta.content);
        }
      }

      // Handle tool calls
      if (delta.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          const index = toolCall.index || 0;
          if (!toolCalls[index]) {
            toolCalls[index] = {
              id: toolCall.id || "",
              type: "function",
              function: {
                name: "",
                arguments: ""
              }
            };
          }

          if (toolCall.function) {
            if (toolCall.function.name) {
              toolCalls[index].function.name = toolCall.function.name;
            }
            if (toolCall.function.arguments) {
              toolCalls[index].function.arguments += toolCall.function.arguments;
            }
          }
        }
      }
    }

    // Get final message
    const finalMessage = await stream.finalChatCompletion();

    // Process complete message
    const assistantMessage = {
      role: "assistant",
      content: accumulatedContent || null,
      tool_calls: finalMessage.choices[0]?.message?.tool_calls || toolCalls
    };

    if (streamHandlers.onMessage) {
      // Format message content to match expected format (array of content blocks)
      const messageContent = assistantMessage.content
        ? [{ type: "text", text: assistantMessage.content }]
        : [];

      // If there are tool calls, add them to content
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          messageContent.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments || "{}")
          });
        }
      }

      streamHandlers.onMessage({
        role: "assistant",
        content: messageContent
      });
    }

    // Process tool use requests
    if (streamHandlers.onToolUse && assistantMessage.tool_calls) {
      for (const toolCall of assistantMessage.tool_calls) {
        const toolUseContent = {
          id: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments || "{}"),
          type: "tool_use"
        };
        await streamHandlers.onToolUse(toolUseContent);
      }
    }

    // Return in a format compatible with the existing code
    const finishReason = finalMessage.choices[0]?.finish_reason;
    return {
      role: "assistant",
      content: assistantMessage.content ? [{ type: "text", text: assistantMessage.content }] : [],
      stop_reason: finishReason === "tool_calls" ? "tool_use" : "end_turn"
    };
    } catch (error) {
      console.error("Error in streamConversation:", error);

      // Provide more detailed error information
      if (error.status === 401) {
        throw new Error("Authentication failed with OpenAI API. Please check your API key.");
      } else if (error.status === 404) {
        throw new Error(`Model "${AppConfig.api.defaultModel}" not found. Please check the model name.`);
      } else if (error.message) {
        throw new Error(`OpenAI API error: ${error.message}`);
      } else {
        throw new Error("Failed to get response from OpenAI API. Please check your configuration and API key.");
      }
    }
  };

  /**
   * Gets the system prompt content for a given prompt type
   * @param {string} promptType - The prompt type to retrieve
   * @returns {string} The system prompt content
   */
  const getSystemPrompt = (promptType) => {
    return systemPrompts.systemPrompts[promptType]?.content ||
      systemPrompts.systemPrompts[AppConfig.api.defaultPromptType].content;
  };

  return {
    streamConversation,
    getSystemPrompt
  };
}

export default {
  createOpenAIService
};
