import { useState, useEffect, useRef, useCallback } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { getActiveConversations } from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const conversations = await getActiveConversations(session.shop);
  return { conversations, shop: session.shop };
};

function timeAgo(dateString) {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function parsePreview(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      const text = parsed.find(b => b.type === "text");
      return text?.text?.slice(0, 80) || "";
    }
    if (typeof parsed === "string") return parsed.slice(0, 80);
  } catch { /* ignore */ }
  return (content || "").slice(0, 80);
}

function parseContent(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.filter(b => b.type === "text").map(b => b.text).join("\n");
    }
    if (typeof parsed === "string") return parsed;
  } catch { /* ignore */ }
  return content || "";
}

function modeBadge(mode) {
  if (mode === "merchant") return <s-badge tone="info">You</s-badge>;
  if (mode === "pending_merchant") return <s-badge tone="warning">Waiting</s-badge>;
  return <s-badge tone="success">AI</s-badge>;
}

export default function LiveChat() {
  const { conversations: initialConversations } = useLoaderData();
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState(searchParams.get("conversation") || null);
  const [messages, setMessages] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const pollTimerRef = useRef(null);
  const listTimerRef = useRef(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Poll conversation list every 5s
  useEffect(() => {
    const fetchList = async () => {
      try {
        const res = await fetch("/app/api/live-chats");
        if (res.ok) {
          const data = await res.json();
          setConversations(data.conversations || []);
        }
      } catch { /* ignore */ }
    };

    listTimerRef.current = setInterval(fetchList, 5000);
    return () => clearInterval(listTimerRef.current);
  }, []);

  // Fetch messages when selecting a conversation
  const fetchMessages = useCallback(async (convId, since) => {
    try {
      const url = since
        ? `/app/api/conversations/${convId}/messages?since=${encodeURIComponent(since)}`
        : `/app/api/conversations/${convId}/messages`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  // Select conversation and load messages
  useEffect(() => {
    if (!selectedId) return;

    let cancelled = false;

    const loadFull = async () => {
      const data = await fetchMessages(selectedId);
      if (cancelled || !data) return;
      setMessages(data.messages || []);
      setSelectedConv(conversations.find(c => c.id === selectedId) || null);
    };

    loadFull();

    // Poll for new messages every 2s
    clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      if (cancelled) return;
      const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
      const since = lastMsg?.createdAt || new Date(0).toISOString();
      const data = await fetchMessages(selectedId, since);
      if (cancelled || !data) return;
      if (data.messages && data.messages.length > 0) {
        setMessages(prev => {
          const ids = new Set(prev.map(m => m.id));
          const newMsgs = data.messages.filter(m => !ids.has(m.id));
          return newMsgs.length > 0 ? [...prev, ...newMsgs] : prev;
        });
      }
      // Update mode if changed
      if (data.mode && selectedConv && data.mode !== selectedConv.mode) {
        setSelectedConv(prev => prev ? { ...prev, mode: data.mode } : prev);
      }
      if (data.autoReleased) {
        setSelectedConv(prev => prev ? { ...prev, mode: 'ai', assignedTo: null } : prev);
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(pollTimerRef.current);
    };
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTakeOver = async () => {
    try {
      const res = await fetch(`/app/api/conversations/${selectedId}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "take_over" }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedConv(prev => prev ? { ...prev, mode: "merchant" } : prev);
        // Refresh messages to show system message
        const msgData = await fetchMessages(selectedId);
        if (msgData) setMessages(msgData.messages || []);
      } else {
        alert(data.error || "Failed to take over");
      }
    } catch (e) {
      alert("Error: " + e.message);
    }
  };

  const handleRelease = async () => {
    try {
      const res = await fetch(`/app/api/conversations/${selectedId}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedConv(prev => prev ? { ...prev, mode: "ai", assignedTo: null } : prev);
        const msgData = await fetchMessages(selectedId);
        if (msgData) setMessages(msgData.messages || []);
      }
    } catch (e) {
      alert("Error: " + e.message);
    }
  };

  const handleSend = async () => {
    const content = inputValue.trim();
    if (!content || sending) return;
    setSending(true);

    try {
      const res = await fetch(`/app/api/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          setMessages(prev => [...prev, data.message]);
        }
        setInputValue("");
      }
    } catch { /* ignore */ }
    setSending(false);
  };

  const currentMode = selectedConv?.mode || "ai";

  return (
    <s-page heading="Live Chat">
      <div style={{ display: "flex", gap: "16px", minHeight: "600px" }}>
        {/* Left panel: Conversation list */}
        <div style={{ width: "320px", flexShrink: 0 }}>
          <s-card>
            <s-box padding="base">
              <s-text variant="headingSm">Active Conversations</s-text>
            </s-box>
            <div style={{ maxHeight: "540px", overflowY: "auto" }}>
              {conversations.length === 0 ? (
                <s-box padding="base">
                  <s-text tone="subdued">No active conversations in the last 24 hours.</s-text>
                </s-box>
              ) : (
                conversations.map(conv => {
                  const lastMsg = conv.messages?.[0];
                  const preview = lastMsg ? parsePreview(lastMsg.content) : "No messages";
                  const isSelected = conv.id === selectedId;

                  return (
                    <div
                      key={conv.id}
                      onClick={() => setSelectedId(conv.id)}
                      style={{
                        padding: "12px 16px",
                        cursor: "pointer",
                        borderBottom: "1px solid #e1e3e5",
                        backgroundColor: isSelected ? "#f6f6f7" : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <s-text variant="bodySm" fontWeight="semibold">
                          {conv.id.slice(0, 10)}...
                        </s-text>
                        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                          {modeBadge(conv.mode)}
                          <s-text variant="bodySm" tone="subdued">{timeAgo(conv.updatedAt)}</s-text>
                        </div>
                      </div>
                      <s-text variant="bodySm" tone="subdued">
                        {lastMsg?.role === "user" ? "Customer: " : lastMsg?.role === "merchant" ? "You: " : "AI: "}
                        {preview}
                      </s-text>
                      <s-text variant="bodySm" tone="subdued">
                        {conv._count?.messages || 0} messages
                      </s-text>
                    </div>
                  );
                })
              )}
            </div>
          </s-card>
        </div>

        {/* Right panel: Chat */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {selectedId ? (
            <s-card>
              {/* Header with controls */}
              <s-box padding="base">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <s-text variant="headingSm">
                      Conversation {selectedId.slice(0, 12)}...
                    </s-text>
                    <div style={{ marginTop: "4px" }}>
                      {modeBadge(currentMode)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {currentMode !== "merchant" && (
                      <s-button variant="primary" onClick={handleTakeOver}>Take Over</s-button>
                    )}
                    {currentMode === "merchant" && (
                      <s-button onClick={handleRelease}>Release to AI</s-button>
                    )}
                  </div>
                </div>
              </s-box>

              {/* Messages */}
              <div style={{ maxHeight: "420px", overflowY: "auto", padding: "16px", borderTop: "1px solid #e1e3e5" }}>
                {messages.map(msg => (
                  <div
                    key={msg.id}
                    style={{
                      padding: "8px 12px",
                      marginBottom: "8px",
                      borderRadius: "8px",
                      backgroundColor:
                        msg.role === "user" ? "#f6f6f7" :
                        msg.role === "merchant" ? "#e3f1ff" :
                        "#eef4ff",
                    }}
                  >
                    <div>
                      <s-text variant="bodySm" fontWeight="semibold" tone={msg.role === "merchant" ? "info" : undefined}>
                        {msg.role === "user" ? "Customer" : msg.role === "merchant" ? "You" : "AI Assistant"}
                      </s-text>
                    </div>
                    <div style={{ margin: "4px 0" }}>
                      <s-text variant="bodyMd">{parseContent(msg.content)}</s-text>
                    </div>
                    <div>
                      <s-text variant="bodySm" tone="subdued">{timeAgo(msg.createdAt)}</s-text>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input (only shown in merchant mode) */}
              {currentMode === "merchant" && (
                <div style={{ padding: "12px 16px", borderTop: "1px solid #e1e3e5", display: "flex", gap: "8px" }}>
                  <div style={{ flex: 1 }}>
                    <s-text-field
                      label=""
                      value={inputValue}
                      placeholder="Type a message..."
                      onInput={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                    />
                  </div>
                  <s-button variant="primary" onClick={handleSend} disabled={sending || !inputValue.trim()}>
                    Send
                  </s-button>
                </div>
              )}
            </s-card>
          ) : (
            <s-card>
              <s-box padding="large-400">
                <s-text tone="subdued">Select a conversation from the list to view and respond.</s-text>
              </s-box>
            </s-card>
          )}
        </div>
      </div>
    </s-page>
  );
}
