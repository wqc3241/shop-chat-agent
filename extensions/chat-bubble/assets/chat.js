/**
 * Shop AI Chat - Client-side implementation
 *
 * This module handles the chat interface for the Shopify AI Chat application.
 * It manages the UI interactions, API communication, and message rendering.
 */
(function() {
  'use strict';

  /**
   * Application namespace to prevent global scope pollution
   */
  const ShopAIChat = {
    /**
     * UI-related elements and functionality
     */
    UI: {
      elements: {},
      isMobile: false,

      /**
       * Initialize UI elements and event listeners
       * @param {HTMLElement} container - The main container element
       */
      init: function(container) {
        if (!container) return;

        // Cache DOM elements
        this.elements = {
          container: container,
          chatBubble: container.querySelector('.shop-ai-chat-bubble'),
          chatWindow: container.querySelector('.shop-ai-chat-window'),
          closeButton: container.querySelector('.shop-ai-chat-close'),
          chatInput: container.querySelector('.shop-ai-chat-input input'),
          sendButton: container.querySelector('.shop-ai-chat-send'),
          messagesContainer: container.querySelector('.shop-ai-chat-messages')
        };

        // Initialize optional voice input support
        ShopAIChat.Voice.init(this.elements);

        // Detect mobile device
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        // Set up event listeners
        this.setupEventListeners();

        // Fix for iOS Safari viewport height issues
        if (this.isMobile) {
          this.setupMobileViewport();
        }
      },

      /**
       * Set up all event listeners for UI interactions
       */
      setupEventListeners: function() {
        const { chatBubble, closeButton, chatInput, sendButton, messagesContainer } = this.elements;

        // Toggle chat window visibility
        chatBubble.addEventListener('click', () => this.toggleChatWindow());

        // Close chat window
        closeButton.addEventListener('click', () => this.closeChatWindow());

        // Send message when pressing Enter in input
        chatInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && chatInput.value.trim() !== '') {
            ShopAIChat.Voice.stopListening();
            ShopAIChat.Message.send(chatInput, messagesContainer);

            // On mobile, handle keyboard
            if (this.isMobile) {
              chatInput.blur();
              setTimeout(() => chatInput.focus(), 300);
            }
          }
        });

        // Send message when clicking send button
        sendButton.addEventListener('click', () => {
          if (chatInput.value.trim() !== '') {
            ShopAIChat.Voice.stopListening();
            ShopAIChat.Message.send(chatInput, messagesContainer);

            // On mobile, focus input after sending
            if (this.isMobile) {
              setTimeout(() => chatInput.focus(), 300);
            }
          }
        });

        // Handle window resize to adjust scrolling
        window.addEventListener('resize', () => this.scrollToBottom());

        // Add global click handler for auth links
        document.addEventListener('click', function(event) {
          if (event.target && event.target.classList.contains('shop-auth-trigger')) {
            event.preventDefault();
            if (window.shopAuthUrl) {
              ShopAIChat.Auth.openAuthPopup(window.shopAuthUrl);
            }
          }
        });
      },

      /**
       * Setup mobile-specific viewport adjustments
       */
      setupMobileViewport: function() {
        const setViewportHeight = () => {
          document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
        };
        window.addEventListener('resize', setViewportHeight);
        setViewportHeight();
      },

      /**
       * Toggle chat window visibility
       */
      toggleChatWindow: function() {
        const { chatWindow, chatInput } = this.elements;

        chatWindow.classList.toggle('active');

        if (chatWindow.classList.contains('active')) {
          // On mobile, prevent body scrolling and delay focus
          if (this.isMobile) {
            document.body.classList.add('shop-ai-chat-open');
            setTimeout(() => chatInput.focus(), 500);
          } else {
            chatInput.focus();
          }
          // Always scroll messages to bottom when opening
          this.scrollToBottom();
        } else {
          // Remove body class when closing
          document.body.classList.remove('shop-ai-chat-open');
        }
      },

      /**
       * Close chat window
       */
      closeChatWindow: function() {
        const { chatWindow, chatInput } = this.elements;

        chatWindow.classList.remove('active');
        ShopAIChat.Voice.stopListening();

        // On mobile, blur input to hide keyboard and enable body scrolling
        if (this.isMobile) {
          chatInput.blur();
          document.body.classList.remove('shop-ai-chat-open');
        }
      },

      /**
       * Scroll messages container to bottom
       */
      scrollToBottom: function() {
        const { messagesContainer } = this.elements;
        setTimeout(() => {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
      },

      /**
       * Show typing indicator in the chat
       */
      showTypingIndicator: function() {
        const { messagesContainer } = this.elements;

        const typingIndicator = document.createElement('div');
        typingIndicator.classList.add('shop-ai-typing-indicator');
        typingIndicator.innerHTML = '<span></span><span></span><span></span>';
        messagesContainer.appendChild(typingIndicator);
        this.scrollToBottom();
      },

      /**
       * Remove typing indicator from the chat
       */
      removeTypingIndicator: function() {
        const { messagesContainer } = this.elements;

        const typingIndicator = messagesContainer.querySelector('.shop-ai-typing-indicator');
        if (typingIndicator) {
          typingIndicator.remove();
        }
      },

      /**
       * Display product results in the chat
       * @param {Array} products - Array of product data objects
       */
      displayProductResults: function(products) {
        const { messagesContainer } = this.elements;

        // Create a wrapper for the product section
        const productSection = document.createElement('div');
        productSection.classList.add('shop-ai-product-section');
        messagesContainer.appendChild(productSection);

        // Add a header for the product results
        const header = document.createElement('div');
        header.classList.add('shop-ai-product-header');
        header.innerHTML = '<h4>Top Matching Products</h4>';
        productSection.appendChild(header);

        // Create the product grid container
        const productsContainer = document.createElement('div');
        productsContainer.classList.add('shop-ai-product-grid');
        productSection.appendChild(productsContainer);

        if (!products || !Array.isArray(products) || products.length === 0) {
          const noProductsMessage = document.createElement('p');
          noProductsMessage.textContent = "No products found";
          noProductsMessage.style.padding = "10px";
          productsContainer.appendChild(noProductsMessage);
        } else {
          products.forEach(product => {
            const productCard = ShopAIChat.Product.createCard(product);
            productsContainer.appendChild(productCard);
          });
        }

        this.scrollToBottom();
      }
    },

    /**
     * Voice input (speech-to-text) functionality
     */
    Voice: {
      recognition: null,
      isSupported: false,
      isListening: false,
      button: null,

      init: function(uiElements) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition || !uiElements || !uiElements.chatInput || !uiElements.sendButton) {
          return;
        }

        this.isSupported = true;
        this.createVoiceButton(uiElements);

        this.recognition = new SpeechRecognition();
        this.recognition.lang = navigator.language || 'en-US';
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
          this.isListening = true;
          this.updateButtonState();
        };

        this.recognition.onend = () => {
          this.isListening = false;
          this.updateButtonState();
        };

        this.recognition.onerror = (event) => {
          console.warn('Voice input error:', event.error);
          this.isListening = false;
          this.updateButtonState();
        };

        this.recognition.onresult = (event) => {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          uiElements.chatInput.value = transcript.trim();
        };
      },

      createVoiceButton: function(uiElements) {
        const voiceButton = document.createElement('button');
        voiceButton.type = 'button';
        voiceButton.className = 'shop-ai-chat-voice';
        voiceButton.setAttribute('aria-label', 'Use voice input');
        voiceButton.title = 'Use voice input';
        voiceButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';

        voiceButton.addEventListener('click', () => {
          if (this.isListening) {
            this.stopListening();
          } else {
            this.startListening();
          }
        });

        const inputWrapper = uiElements.sendButton.parentElement;
        inputWrapper.insertBefore(voiceButton, uiElements.sendButton);
        this.button = voiceButton;
      },

      startListening: function() {
        if (!this.isSupported || !this.recognition || this.isListening) return;
        try {
          this.recognition.start();
        } catch (error) {
          console.warn('Unable to start voice input:', error);
        }
      },

      stopListening: function() {
        if (!this.isSupported || !this.recognition || !this.isListening) return;
        try {
          this.recognition.stop();
        } catch (error) {
          console.warn('Unable to stop voice input:', error);
        }
      },

      updateButtonState: function() {
        if (!this.button) return;
        this.button.classList.toggle('listening', this.isListening);
        this.button.title = this.isListening ? 'Stop voice input' : 'Use voice input';
        this.button.setAttribute('aria-label', this.isListening ? 'Stop voice input' : 'Use voice input');
      }
    },

    /**
     * Message handling and display functionality
     */
    Message: {
      /**
       * Send a message to the API
       * @param {HTMLInputElement} chatInput - The input element
       * @param {HTMLElement} messagesContainer - The messages container
       */
      send: async function(chatInput, messagesContainer) {
        const userMessage = chatInput.value.trim();
        const conversationId = sessionStorage.getItem('shopAiConversationId');

        // Add user message to chat
        this.add(userMessage, 'user', messagesContainer);

        // Clear input
        chatInput.value = '';

        // Show typing indicator
        ShopAIChat.UI.showTypingIndicator();

        try {
          await ShopAIChat.API.streamResponse(userMessage, conversationId, messagesContainer);
        } catch (error) {
          console.error('Error communicating with OpenAI API:', error);
          ShopAIChat.UI.removeTypingIndicator();
          this.add("Sorry, I couldn't process your request at the moment. Please try again later.", 'assistant', messagesContainer);
        }
      },

      /**
       * Add a message to the chat
       * @param {string} text - Message content
       * @param {string} sender - Message sender ('user' or 'assistant')
       * @param {HTMLElement} messagesContainer - The messages container
       * @returns {HTMLElement} The created message element
       */
      add: function(text, sender, messagesContainer) {
        const messageElement = document.createElement('div');
        const cssClass = sender === 'merchant' ? 'merchant' : sender;
        messageElement.classList.add('shop-ai-message', cssClass);

        if (sender === 'merchant') {
          // Add "Support Agent" label
          const label = document.createElement('div');
          label.className = 'shop-ai-message-label';
          label.textContent = 'Support Agent';
          messageElement.appendChild(label);
          const contentEl = document.createElement('div');
          contentEl.textContent = text;
          messageElement.appendChild(contentEl);
        } else if (sender === 'assistant') {
          messageElement.dataset.rawText = text;
          ShopAIChat.Formatting.formatMessageContent(messageElement);
        } else {
          messageElement.textContent = text;
        }

        messagesContainer.appendChild(messageElement);
        ShopAIChat.UI.scrollToBottom();

        return messageElement;
      },

      /**
       * Add a tool use message to the chat with expandable arguments
       * @param {string} toolMessage - Tool use message content
       * @param {HTMLElement} messagesContainer - The messages container
       */
      addToolUse: function(toolMessage, messagesContainer) {
        // Parse the tool message to extract tool name and arguments
        const match = toolMessage.match(/Calling tool: (\w+) with arguments: (.+)/);
        if (!match) {
          // Fallback for unexpected format
          const toolUseElement = document.createElement('div');
          toolUseElement.classList.add('shop-ai-message', 'tool-use');
          toolUseElement.textContent = toolMessage;
          messagesContainer.appendChild(toolUseElement);
          ShopAIChat.UI.scrollToBottom();
          return;
        }

        const toolName = match[1];
        const argsString = match[2];

        // Create the main tool use element
        const toolUseElement = document.createElement('div');
        toolUseElement.classList.add('shop-ai-message', 'tool-use');

        // Create the header (always visible)
        const headerElement = document.createElement('div');
        headerElement.classList.add('shop-ai-tool-header');

        const toolText = document.createElement('span');
        toolText.classList.add('shop-ai-tool-text');
        toolText.textContent = `Calling tool: ${toolName}`;

        const toggleElement = document.createElement('span');
        toggleElement.classList.add('shop-ai-tool-toggle');
        toggleElement.textContent = '[+]';

        headerElement.appendChild(toolText);
        headerElement.appendChild(toggleElement);

        // Create the arguments section (initially hidden)
        const argsElement = document.createElement('div');
        argsElement.classList.add('shop-ai-tool-args');

        try {
          // Try to format JSON arguments nicely
          const parsedArgs = JSON.parse(argsString);
          argsElement.textContent = JSON.stringify(parsedArgs, null, 2);
        } catch (e) {
          // If not valid JSON, just show as-is
          argsElement.textContent = argsString;
        }

        // Add click handler to toggle arguments visibility
        headerElement.addEventListener('click', function() {
          const isExpanded = argsElement.classList.contains('expanded');
          if (isExpanded) {
            argsElement.classList.remove('expanded');
            toggleElement.textContent = '[+]';
          } else {
            argsElement.classList.add('expanded');
            toggleElement.textContent = '[-]';
          }
        });

        // Assemble the complete element
        toolUseElement.appendChild(headerElement);
        toolUseElement.appendChild(argsElement);

        messagesContainer.appendChild(toolUseElement);
        ShopAIChat.UI.scrollToBottom();
      }
    },

    /**
     * Text formatting and markdown handling
     */
    Formatting: {
      /**
       * Format message content with markdown and links
       * @param {HTMLElement} element - The element to format
       */
      formatMessageContent: function(element) {
        if (!element || !element.dataset.rawText) return;

        const rawText = element.dataset.rawText;

        // Process the text with various Markdown features
        let processedText = rawText;

        // Process Markdown links
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        processedText = processedText.replace(markdownLinkRegex, (match, text, url) => {
          // Check if it's an auth URL
          if (url.includes('shopify.com/authentication') &&
             (url.includes('oauth/authorize') || url.includes('authentication'))) {
            // Store the auth URL in a global variable for later use - this avoids issues with onclick handlers
            window.shopAuthUrl = url;
            // Just return normal link that will be handled by the document click handler
            return '<a href="#auth" class="shop-auth-trigger">' + text + '</a>';
          }
          // If it's a checkout link, replace the text
          else if (url.includes('/cart') || url.includes('checkout')) {
            return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">click here to proceed to checkout</a>';
          } else {
            // For normal links, preserve the original text
            return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
          }
        });

        // Convert text to HTML with proper list handling
        processedText = this.convertMarkdownToHtml(processedText);

        // Apply the formatted HTML
        element.innerHTML = processedText;
      },

      /**
       * Convert Markdown text to HTML with list support
       * @param {string} text - Markdown text to convert
       * @returns {string} HTML content
       */
      convertMarkdownToHtml: function(text) {
        text = text.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');
        const lines = text.split('\n');
        let currentList = null;
        let listItems = [];
        let htmlContent = '';
        let startNumber = 1;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const unorderedMatch = line.match(/^\s*([-*])\s+(.*)/);
          const orderedMatch = line.match(/^\s*(\d+)[\.)]\s+(.*)/);

          if (unorderedMatch) {
            if (currentList !== 'ul') {
              if (currentList === 'ol') {
                htmlContent += `<ol start="${startNumber}">` + listItems.join('') + '</ol>';
                listItems = [];
              }
              currentList = 'ul';
            }
            listItems.push('<li>' + unorderedMatch[2] + '</li>');
          } else if (orderedMatch) {
            if (currentList !== 'ol') {
              if (currentList === 'ul') {
                htmlContent += '<ul>' + listItems.join('') + '</ul>';
                listItems = [];
              }
              currentList = 'ol';
              startNumber = parseInt(orderedMatch[1], 10);
            }
            listItems.push('<li>' + orderedMatch[2] + '</li>');
          } else {
            if (currentList) {
              htmlContent += currentList === 'ul'
                ? '<ul>' + listItems.join('') + '</ul>'
                : `<ol start="${startNumber}">` + listItems.join('') + '</ol>';
              listItems = [];
              currentList = null;
            }

            if (line.trim() === '') {
              htmlContent += '<br>';
            } else {
              htmlContent += '<p>' + line + '</p>';
            }
          }
        }

        if (currentList) {
          htmlContent += currentList === 'ul'
            ? '<ul>' + listItems.join('') + '</ul>'
            : `<ol start="${startNumber}">` + listItems.join('') + '</ol>';
        }

        htmlContent = htmlContent.replace(/<\/p><p>/g, '</p>\n<p>');
        return htmlContent;
      }
    },

    /**
     * API communication and data handling
     */
    API: {
      /**
       * Stream a response from the API
       * @param {string} userMessage - User's message text
       * @param {string} conversationId - Conversation ID for context
       * @param {HTMLElement} messagesContainer - The messages container
       */
      streamResponse: async function(userMessage, conversationId, messagesContainer) {
        let currentMessageElement = null;

        try {
          const promptType = window.shopChatConfig?.promptType || "standardAssistant";
          const currentMode = sessionStorage.getItem('shopAiChatMode') || 'ai';
          const requestBody = JSON.stringify({
            message: userMessage,
            conversation_id: conversationId,
            prompt_type: promptType,
            current_page_url: window.location.href,
            expected_mode: currentMode,
          });

          const streamUrl = '/apps/chat-agent/chat';
          const shopId = window.shopId;

          const response = await fetch(streamUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream',
              'X-Shopify-Shop-Id': shopId
            },
            body: requestBody
          });

          // Handle non-OK responses (e.g. app proxy errors)
          if (!response.ok) {
            console.error('Chat API error:', response.status, response.statusText);
            ShopAIChat.UI.removeTypingIndicator();
            ShopAIChat.Message.add("Sorry, I couldn't connect right now. Please try again in a moment.",
              'assistant', messagesContainer);
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          // Don't create initial message element yet - wait for first chunk or new_message event
          let currentMessageElement = null;
          let receivedAnyEvent = false;
          const streamState = {
            sawAssistantText: false,
            sawToolUse: false,
          };

          // Process the stream
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  receivedAnyEvent = true;
                  this.handleStreamEvent(data, currentMessageElement, messagesContainer, userMessage, streamState,
                    (newElement) => { currentMessageElement = newElement; });
                } catch (e) {
                  console.error('Error parsing event data:', e, line);
                }
              }
            }
          }

          // Ensure typing indicator is removed when stream ends
          ShopAIChat.UI.removeTypingIndicator();

          // If no SSE events were received, show an error
          if (!receivedAnyEvent) {
            ShopAIChat.Message.add("Sorry, I couldn't get a response. Please try again.",
              'assistant', messagesContainer);
          }
        } catch (error) {
          console.error('Error in streaming:', error);
          ShopAIChat.UI.removeTypingIndicator();
          ShopAIChat.Message.add("Sorry, I couldn't process your request. Please try again later.",
            'assistant', messagesContainer);
        }
      },

      /**
       * Handle stream events from the API
       * @param {Object} data - Event data
       * @param {HTMLElement} currentMessageElement - Current message element being updated
       * @param {HTMLElement} messagesContainer - The messages container
       * @param {string} userMessage - The original user message
       * @param {Function} updateCurrentElement - Callback to update the current element reference
       */
      handleStreamEvent: function(data, currentMessageElement, messagesContainer, userMessage, streamState, updateCurrentElement) {
        switch (data.type) {
          case 'id':
            if (data.conversation_id) {
              sessionStorage.setItem('shopAiConversationId', data.conversation_id);
            }
            break;

          case 'chunk':
            streamState.sawAssistantText = true;
            ShopAIChat.UI.removeTypingIndicator();
            // Create message element on first chunk if it doesn't exist
            if (!currentMessageElement) {
              currentMessageElement = document.createElement('div');
              currentMessageElement.classList.add('shop-ai-message', 'assistant');
              currentMessageElement.textContent = '';
              currentMessageElement.dataset.rawText = '';
              messagesContainer.appendChild(currentMessageElement);
              updateCurrentElement(currentMessageElement);
            }
            currentMessageElement.dataset.rawText += data.chunk;
            currentMessageElement.textContent = currentMessageElement.dataset.rawText;
            ShopAIChat.UI.scrollToBottom();
            break;

          case 'message_complete':
            ShopAIChat.UI.removeTypingIndicator();
            if (currentMessageElement && currentMessageElement.dataset.rawText && currentMessageElement.dataset.rawText.trim() !== '') {
              ShopAIChat.Formatting.formatMessageContent(currentMessageElement);
              ShopAIChat.UI.scrollToBottom();
            }
            break;

          case 'end_turn':
            ShopAIChat.UI.removeTypingIndicator();
            if (currentMessageElement && (!currentMessageElement.dataset.rawText || currentMessageElement.dataset.rawText.trim() === '')) {
              currentMessageElement.remove();
              updateCurrentElement(null);
            }
            if (streamState.sawToolUse && !streamState.sawAssistantText) {
              const isFitmentQuestion = /fit|fits|compatible|compatibility|will this work|does this fit|will it fit|vehicle|car|truck|suv/i.test(userMessage || '');
              if (isFitmentQuestion) {
                ShopAIChat.Message.add(
                  "I can't confirm fitment from the catalog data alone. Ask me to verify further, or share the exact part you want checked.",
                  'assistant',
                  messagesContainer
                );
              }
            }
            break;

          case 'error':
            console.error('Stream error:', data.error);
            ShopAIChat.UI.removeTypingIndicator();
            if (currentMessageElement) {
              currentMessageElement.textContent = "Sorry, I couldn't process your request. Please try again later.";
            } else {
              ShopAIChat.Message.add("Sorry, I couldn't process your request. Please try again later.", 'assistant', messagesContainer);
            }
            break;

          case 'rate_limit_exceeded':
            console.error('Rate limit exceeded:', data.error);
            ShopAIChat.UI.removeTypingIndicator();
            if (currentMessageElement) {
              currentMessageElement.textContent = "Sorry, our servers are currently busy. Please try again later.";
            } else {
              ShopAIChat.Message.add("Sorry, our servers are currently busy. Please try again later.", 'assistant', messagesContainer);
            }
            break;

          case 'auth_required':
            // Save the last user message for resuming after authentication
            sessionStorage.setItem('shopAiLastMessage', userMessage || '');
            break;

          case 'mode':
            sessionStorage.setItem('shopAiChatMode', data.mode);
            ShopAIChat.ModeIndicator.update(data.mode);
            if (data.mode === 'merchant') {
              const convId = sessionStorage.getItem('shopAiConversationId');
              if (convId) {
                ShopAIChat.Polling.start(convId, messagesContainer);
              }
            } else if (data.mode === 'ai') {
              ShopAIChat.Polling.stop();
            }
            break;

          case 'product_results':
            ShopAIChat.UI.displayProductResults(data.products);
            break;

          case 'tool_use':
            // Internal tool activity should not be shown to storefront customers.
            streamState.sawToolUse = true;
            break;

          case 'new_message':
            // Only format and create new element if current element has content
            if (currentMessageElement && currentMessageElement.dataset.rawText && currentMessageElement.dataset.rawText.trim() !== '') {
              ShopAIChat.Formatting.formatMessageContent(currentMessageElement);
              ShopAIChat.UI.showTypingIndicator();
              updateCurrentElement(null);
            } else {
              ShopAIChat.UI.showTypingIndicator();
            }
            break;

          case 'content_block_complete':
            ShopAIChat.UI.showTypingIndicator();
            break;
        }
      },

      /**
       * Fetch chat history from the server
       * @param {string} conversationId - Conversation ID
       * @param {HTMLElement} messagesContainer - The messages container
       */
      fetchChatHistory: async function(conversationId, messagesContainer) {
        try {
          // Show a loading message
          const loadingMessage = document.createElement('div');
          loadingMessage.classList.add('shop-ai-message', 'assistant');
          loadingMessage.textContent = "Loading conversation history...";
          messagesContainer.appendChild(loadingMessage);

          // Fetch history from the server
          const historyUrl = `/apps/chat-agent/chat?history=true&conversation_id=${encodeURIComponent(conversationId)}`;
          console.log('Fetching history from:', historyUrl);

          const response = await fetch(historyUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            mode: 'cors'
          });

          if (!response.ok) {
            console.error('History fetch failed:', response.status, response.statusText);
            throw new Error('Failed to fetch chat history: ' + response.status);
          }

          const data = await response.json();

          // Remove loading message
          messagesContainer.removeChild(loadingMessage);

          // No messages, show welcome message
          if (!data.messages || data.messages.length === 0) {
            const welcomeMessage = window.shopChatConfig?.welcomeMessage || "👋 Hi there! How can I help you today?";
            ShopAIChat.Message.add(welcomeMessage, 'assistant', messagesContainer);
            return;
          }

          // Update mode from history response
          if (data.mode) {
            sessionStorage.setItem('shopAiChatMode', data.mode);
            ShopAIChat.ModeIndicator.update(data.mode);
            if (data.mode === 'merchant') {
              ShopAIChat.Polling.start(conversationId, messagesContainer);
            }
          }

          // Add messages to the UI - filter out tool results
          data.messages.forEach(message => {
            const role = message.role;
            try {
              const messageContents = JSON.parse(message.content);
              for (const contentBlock of messageContents) {
                if (contentBlock.type === 'text' && typeof contentBlock.text === 'string' && contentBlock.text.trim() !== '') {
                  ShopAIChat.Message.add(contentBlock.text, role, messagesContainer);
                }
              }
            } catch (e) {
              ShopAIChat.Message.add(message.content, role, messagesContainer);
            }
          });

          // Scroll to bottom
          ShopAIChat.UI.scrollToBottom();

        } catch (error) {
          console.error('Error fetching chat history:', error);

          // Remove loading message if it exists
          const loadingMessage = messagesContainer.querySelector('.shop-ai-message.assistant');
          if (loadingMessage && loadingMessage.textContent === "Loading conversation history...") {
            messagesContainer.removeChild(loadingMessage);
          }

          // Show error and welcome message
          const welcomeMessage = window.shopChatConfig?.welcomeMessage || "👋 Hi there! How can I help you today?";
          ShopAIChat.Message.add(welcomeMessage, 'assistant', messagesContainer);

          // Do NOT clear the conversation ID here. The ID is still valid in the database;
          // the fetch may have failed due to a transient network error or proxy issue.
          // Clearing it would permanently lose the conversation for the user on any blip.
        }
      }
    },

    /**
     * Polling for merchant messages when in merchant mode
     */
    Polling: {
      timer: null,
      lastTimestamp: null,

      /**
       * Start polling for new merchant messages
       * @param {string} conversationId - The conversation ID
       * @param {HTMLElement} messagesContainer - The messages container
       */
      start: function(conversationId, messagesContainer) {
        this.stop(); // Clear any existing poll
        this.lastTimestamp = new Date().toISOString();

        this.timer = setInterval(async () => {
          try {
            const pollUrl = `/apps/chat-agent/chat?poll=true&conversation_id=${encodeURIComponent(conversationId)}&since=${encodeURIComponent(this.lastTimestamp)}`;
            const response = await fetch(pollUrl);
            if (!response.ok) return;

            const data = await response.json();

            // Render new merchant messages
            if (data.messages && data.messages.length > 0) {
              data.messages.forEach(msg => {
                try {
                  const messageContents = JSON.parse(msg.content);
                  let renderedTextBlock = false;

                  for (const contentBlock of messageContents) {
                    if (contentBlock.type === 'text' && typeof contentBlock.text === 'string' && contentBlock.text.trim() !== '') {
                      ShopAIChat.Message.add(contentBlock.text, msg.role, messagesContainer);
                      renderedTextBlock = true;
                    }
                  }

                  if (!renderedTextBlock && typeof msg.content === 'string' && msg.content.trim() !== '') {
                    // Ignore structured non-text payloads like tool_use/tool_result during polling.
                  }
                } catch (e) {
                  ShopAIChat.Message.add(msg.content, msg.role, messagesContainer);
                }
                this.lastTimestamp = msg.createdAt;
              });
            }

            // Update mode if changed
            const currentMode = sessionStorage.getItem('shopAiChatMode');
            if (data.mode && data.mode !== currentMode) {
              sessionStorage.setItem('shopAiChatMode', data.mode);
              ShopAIChat.ModeIndicator.update(data.mode);
            }

            // If mode changed back to AI, stop polling
            if (data.mode === 'ai') {
              this.stop();
            }
          } catch (e) {
            console.warn('Polling error:', e);
          }
        }, 3000);
      },

      /**
       * Stop polling
       */
      stop: function() {
        if (this.timer) {
          clearInterval(this.timer);
          this.timer = null;
        }
      },
    },

    /**
     * Mode indicator bar shown in chat header
     */
    ModeIndicator: {
      element: null,

      /**
       * Create or update mode indicator
       * @param {string} mode - 'ai', 'merchant', or 'pending_merchant'
       */
      update: function(mode) {
        const header = document.querySelector('.shop-ai-chat-header');
        if (!header) return;

        // Remove existing indicator
        const existing = header.querySelector('.shop-ai-chat-status');
        if (existing) existing.remove();

        if (mode === 'ai') return; // No indicator for AI mode

        const indicator = document.createElement('div');
        indicator.className = 'shop-ai-chat-status';

        if (mode === 'merchant') {
          indicator.textContent = 'Chatting with Support';
          indicator.classList.add('merchant-active');
        } else if (mode === 'pending_merchant') {
          indicator.textContent = 'Waiting for agent...';
          indicator.classList.add('pending');
        }

        header.appendChild(indicator);
        this.element = indicator;
      },
    },

    /**
     * Authentication-related functionality
     */
    Auth: {
      /**
       * Opens an authentication popup window
       * @param {string|HTMLElement} authUrlOrElement - The auth URL or link element that was clicked
       */
      openAuthPopup: function(authUrlOrElement) {
        let authUrl;
        if (typeof authUrlOrElement === 'string') {
          // If a string URL was passed directly
          authUrl = authUrlOrElement;
        } else {
          // If an element was passed
          authUrl = authUrlOrElement.getAttribute('data-auth-url');
          if (!authUrl) {
            console.error('No auth URL found in element');
            return;
          }
        }

        // Open the popup window centered in the screen
        const width = 600;
        const height = 700;
        const left = (window.innerWidth - width) / 2 + window.screenX;
        const top = (window.innerHeight - height) / 2 + window.screenY;

        const popup = window.open(
          authUrl,
          'ShopifyAuth',
          `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );

        // Focus the popup window
        if (popup) {
          popup.focus();
        } else {
          // If popup was blocked, show a message
          alert('Please allow popups for this site to authenticate with Shopify.');
        }

        // Start polling for token availability
        const conversationId = sessionStorage.getItem('shopAiConversationId');
        if (conversationId) {
          const messagesContainer = document.querySelector('.shop-ai-chat-messages');

          // Add a message to indicate authentication is in progress
          ShopAIChat.Message.add("Authentication in progress. Please complete the process in the popup window.",
            'assistant', messagesContainer);

          this.startTokenPolling(conversationId, messagesContainer);
        }
      },

      /**
       * Start polling for token availability
       * @param {string} conversationId - Conversation ID
       * @param {HTMLElement} messagesContainer - The messages container
       */
      startTokenPolling: function(conversationId, messagesContainer) {
        if (!conversationId) return;

        console.log('Starting token polling for conversation:', conversationId);
        const pollingId = 'polling_' + Date.now();
        sessionStorage.setItem('shopAiTokenPollingId', pollingId);

        let attemptCount = 0;
        const maxAttempts = 30;

        const poll = async () => {
          if (sessionStorage.getItem('shopAiTokenPollingId') !== pollingId) {
            console.log('Another polling session has started, stopping this one');
            return;
          }

          if (attemptCount >= maxAttempts) {
            console.log('Max polling attempts reached, stopping');
            return;
          }

          attemptCount++;

          try {
            const tokenUrl = '/apps/chat-agent/auth/token-status?conversation_id=' +
              encodeURIComponent(conversationId);
            const response = await fetch(tokenUrl);

            if (!response.ok) {
              throw new Error('Token status check failed: ' + response.status);
            }

            const data = await response.json();

            if (data.status === 'authorized') {
              console.log('Token available, resuming conversation');
              const message = sessionStorage.getItem('shopAiLastMessage');

              if (message) {
                sessionStorage.removeItem('shopAiLastMessage');
                setTimeout(() => {
                  ShopAIChat.Message.add("Authorization successful! I'm now continuing with your request.",
                    'assistant', messagesContainer);
                  ShopAIChat.API.streamResponse(message, conversationId, messagesContainer);
                  ShopAIChat.UI.showTypingIndicator();
                }, 500);
              }

              sessionStorage.removeItem('shopAiTokenPollingId');
              return;
            }

            console.log('Token not available yet, polling again in 10s');
            setTimeout(poll, 10000);
          } catch (error) {
            console.error('Error polling for token status:', error);
            setTimeout(poll, 10000);
          }
        };

        setTimeout(poll, 2000);
      }
    },

    /**
     * Product-related functionality
     */
    Product: {
      getProductUrl: function(product) {
        if (!product) return '';

        const directUrl = product.url || product.onlineStoreUrl || product.productUrl || product.product_url;
        if (typeof directUrl === 'string' && directUrl.trim() !== '') {
          return directUrl;
        }

        const handle = product.handle || product.product_handle || product.slug;
        if (typeof handle === 'string' && handle.trim() !== '') {
          return `/products/${handle.trim()}`;
        }

        if (typeof product.title === 'string' && product.title.trim() !== '') {
          const inferredHandle = this.slugifyToHandle(product.title);
          if (inferredHandle) {
            return `/products/${inferredHandle}`;
          }
        }

        return '';
      },

      slugifyToHandle: function(value) {
        if (!value || typeof value !== 'string') return '';
        return value
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[^\w\s-]/g, '')
          .trim()
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '');
      },

      /**
       * Create a product card element
       * @param {Object} product - Product data
       * @returns {HTMLElement} Product card element
       */
      createCard: function(product) {
        const card = document.createElement('div');
        card.classList.add('shop-ai-product-card');
        const productUrl = this.getProductUrl(product);

        // Create image container
        const imageContainer = document.createElement('div');
        imageContainer.classList.add('shop-ai-product-image');

        // Add product image or placeholder
        const image = document.createElement('img');
        image.src = product.image_url || 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png';
        image.alt = product.title;
        image.onerror = function() {
          // If image fails to load, use a fallback placeholder
          this.src = 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png';
        };
        imageContainer.appendChild(image);
        card.appendChild(imageContainer);

        // Add product info
        const info = document.createElement('div');
        info.classList.add('shop-ai-product-info');

        // Add product title
        const title = document.createElement('h3');
        title.classList.add('shop-ai-product-title');
        title.textContent = product.title;

        // If product has a URL, make the title a link
        if (productUrl) {
          const titleLink = document.createElement('a');
          titleLink.href = productUrl;
          titleLink.textContent = product.title;
          title.textContent = '';
          title.appendChild(titleLink);
        }

        info.appendChild(title);

        // Add product price
        const price = document.createElement('p');
        price.classList.add('shop-ai-product-price');
        price.textContent = product.price;
        info.appendChild(price);

        // Add add-to-cart button
        const button = document.createElement('button');
        button.classList.add('shop-ai-add-to-cart');
        button.textContent = 'Add to Cart';
        button.dataset.productId = product.id;

        // Add click handler for the button
        button.addEventListener('click', function(e) {
          // Stop event propagation to prevent triggering card click
          e.stopPropagation();
          
          // Send message to add this product to cart
          const input = document.querySelector('.shop-ai-chat-input input');
          if (input) {
            input.value = `Add ${product.title} to my cart`;
            // Trigger a click on the send button
            const sendButton = document.querySelector('.shop-ai-chat-send');
            if (sendButton) {
              sendButton.click();
            }
          }
        });

        info.appendChild(button);
        card.appendChild(info);

        // Make the entire card clickable to view product details
        if (productUrl) {
          card.classList.add('shop-ai-product-card-clickable');
          card.addEventListener('click', function(e) {
            // Don't navigate if clicking on the button or a link
            if (e.target.closest('.shop-ai-add-to-cart') || e.target.closest('a')) {
              return;
            }
            // Navigate to product URL
            window.location.href = productUrl;
          });
        }

        return card;
      }
    },

    /**
     * Initialize the chat application
     */
    init: function() {
      // Initialize UI
      const container = document.querySelector('.shop-ai-chat-container');
      if (!container) return;

      this.UI.init(container);

      // Add "Talk to a person" link in the chat header
      this.addHumanRequestLink(container);

      // Check for existing conversation
      const conversationId = sessionStorage.getItem('shopAiConversationId');

      if (conversationId) {
        // Fetch conversation history and restore mode
        this.API.fetchChatHistory(conversationId, this.UI.elements.messagesContainer);

        // Restore mode from sessionStorage and resume polling if needed
        const savedMode = sessionStorage.getItem('shopAiChatMode');
        if (savedMode && savedMode !== 'ai') {
          this.ModeIndicator.update(savedMode);
          if (savedMode === 'merchant' || savedMode === 'pending_merchant') {
            this.Polling.start(conversationId, this.UI.elements.messagesContainer);
          }
        }
      } else {
        // No previous conversation, show welcome message
        const welcomeMessage = window.shopChatConfig?.welcomeMessage || "👋 Hi there! How can I help you today?";
        this.Message.add(welcomeMessage, 'assistant', this.UI.elements.messagesContainer);
      }
    },

    /**
     * Add a "Talk to a person" link below the chat header
     * @param {HTMLElement} container - The chat container
     */
    addHumanRequestLink: function(container) {
      const header = container.querySelector('.shop-ai-chat-header');
      if (!header) return;

      const link = document.createElement('a');
      link.href = '#';
      link.className = 'shop-ai-request-human';
      link.textContent = 'Talk to a person';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.requestHuman();
      });

      header.appendChild(link);
    },

    /**
     * Request a human agent
     */
    requestHuman: function() {
      const conversationId = sessionStorage.getItem('shopAiConversationId');
      const messagesContainer = this.UI.elements.messagesContainer;

      sessionStorage.setItem('shopAiChatMode', 'pending_merchant');
      this.ModeIndicator.update('pending_merchant');

      // Start polling so customer sees merchant messages once agent joins
      if (conversationId && messagesContainer) {
        this.Polling.start(conversationId, messagesContainer);
      }

      // Send request_human flag to backend
      const requestBody = JSON.stringify({
        message: "I'd like to talk to a person, please.",
        conversation_id: conversationId,
        request_human: true,
        current_page_url: window.location.href,
        prompt_type: window.shopChatConfig?.promptType || "standardAssistant",
      });

      this.Message.add("I'd like to talk to a person, please.", 'user', messagesContainer);
      this.UI.showTypingIndicator();

      fetch('/apps/chat-agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'X-Shopify-Shop-Id': window.shopId,
        },
        body: requestBody,
      }).then(response => {
        if (!response.ok) {
          this.UI.removeTypingIndicator();
          return;
        }
        // Process SSE stream as usual
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEl = null;
        const streamState = {
          sawAssistantText: false,
          sawToolUse: false,
        };

        const pump = async () => {
          const { value, done } = await reader.read();
          if (done) {
            this.UI.removeTypingIndicator();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                this.API.handleStreamEvent(data, currentEl, messagesContainer, "I'd like to talk to a person, please.", streamState,
                  (newEl) => { currentEl = newEl; });
              } catch { /* ignore */ }
            }
          }
          return pump();
        };
        return pump();
      }).catch(() => {
        this.UI.removeTypingIndicator();
      });
    }
  };

  // Initialize the application when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    ShopAIChat.init();
  });
})();
