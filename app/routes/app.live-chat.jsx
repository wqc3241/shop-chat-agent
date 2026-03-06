import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  if (seconds < 3600) return `about ${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `about ${Math.floor(seconds / 3600)} hours ago`;
  return `about ${Math.floor(seconds / 86400)} days ago`;
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function parsePreview(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      const text = parsed.find((block) => block.type === "text");
      return text?.text?.replace(/\s+/g, " ").trim() || "";
    }
    if (typeof parsed === "string") return parsed.replace(/\s+/g, " ").trim();
  } catch {
    // Ignore non-JSON payloads.
  }
  return (content || "").replace(/\s+/g, " ").trim();
}

function parseContent(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    }
    if (typeof parsed === "string") return parsed;
  } catch {
    // Ignore non-JSON payloads.
  }
  return content || "";
}

function getDisplayName(conversation) {
  if (conversation.customerEmail) {
    const localPart = conversation.customerEmail.split("@")[0] || "Customer";
    return localPart
      .split(/[._-]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return `Guest ${conversation.id.slice(0, 6)}`;
}

function getInitials(conversation) {
  const name = getDisplayName(conversation);
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "GU";
}

function getStatusMeta(mode) {
  if (mode === "merchant") {
    return {
      label: "Merchant",
      detail: "Team is handling",
      dot: "#9333ea",
      pillBg: "#f3e8ff",
      pillColor: "#7e22ce",
      bannerTone: "info",
      bannerText: "You are handling this conversation.",
    };
  }
  if (mode === "pending_merchant") {
    return {
      label: "Unread",
      detail: "Needs takeover",
      dot: "#f59e0b",
      pillBg: "#fff7db",
      pillColor: "#b45309",
      bannerTone: "warning",
      bannerText: "Customer requested a human. Send a message below to take over.",
    };
  }
  return {
    label: "AI Active",
    detail: "Assistant is handling",
    dot: "#2563eb",
    pillBg: "#eef4ff",
    pillColor: "#2563eb",
    bannerTone: "warning",
    bannerText: "AI is currently handling this conversation. Type a message below to take over and switch to merchant mode.",
  };
}

function getMessageMeta(role) {
  if (role === "user") {
    return { label: "Customer", icon: "user", bubble: { background: "#f3f4f6", color: "#111827" } };
  }
  if (role === "merchant") {
    return { label: "Merchant", icon: "merchant", bubble: { background: "#eef4ff", color: "#1d4ed8" } };
  }
  if (role === "system") {
    return { label: "System", icon: "system", bubble: { background: "#fff7db", color: "#92400e" } };
  }
  return { label: "AI Assistant", icon: "ai", bubble: { background: "#eef4ff", color: "#1d4ed8" } };
}

function renderIconBubble(children, tone = "#8b5cf6") {
  return (
    <div
      style={{
        width: "32px",
        height: "32px",
        borderRadius: "999px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `linear-gradient(135deg, ${tone}, #a78bfa)`,
        color: "#ffffff",
        fontWeight: 700,
        fontSize: "13px",
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

export default function LiveChat() {
  const { conversations: initialConversations } = useLoaderData();
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState(searchParams.get("conversation") || initialConversations[0]?.id || null);
  const [messages, setMessages] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState("all");
  const messagesEndRef = useRef(null);
  const pollTimerRef = useRef(null);
  const listTimerRef = useRef(null);
  const latestMessageAtRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    latestMessageAtRef.current = messages[messages.length - 1]?.createdAt || null;
  }, [messages]);

  useEffect(() => {
    const fetchList = async () => {
      try {
        const res = await fetch("/app/api/live-chats");
        if (!res.ok) return;
        const data = await res.json();
        setConversations(data.conversations || []);
      } catch {
        // Ignore polling failures.
      }
    };

    listTimerRef.current = setInterval(fetchList, 5000);
    return () => clearInterval(listTimerRef.current);
  }, []);

  const fetchMessages = useCallback(async (conversationId, since) => {
    try {
      const url = since
        ? `/app/api/conversations/${conversationId}/messages?since=${encodeURIComponent(since)}`
        : `/app/api/conversations/${conversationId}/messages`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!selectedId && conversations[0]?.id) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedConv(null);
      return;
    }
    setSelectedConv(conversations.find((conv) => conv.id === selectedId) || null);
  }, [conversations, selectedId]);

  useEffect(() => {
    if (!selectedId) return;

    let cancelled = false;

    const loadFull = async () => {
      const data = await fetchMessages(selectedId);
      if (cancelled || !data) return;
      setMessages(data.messages || []);
      if (data.mode) {
        setSelectedConv((prev) => (prev ? { ...prev, mode: data.mode } : prev));
      }
    };

    loadFull();

    clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      if (cancelled) return;
      const since = latestMessageAtRef.current || new Date(0).toISOString();
      const data = await fetchMessages(selectedId, since);
      if (cancelled || !data) return;
      if (data.messages?.length) {
        setMessages((prev) => {
          const ids = new Set(prev.map((message) => message.id));
          const nextMessages = data.messages.filter((message) => !ids.has(message.id));
          return nextMessages.length ? [...prev, ...nextMessages] : prev;
        });
      }
      if (data.mode) {
        setSelectedConv((prev) => (prev ? { ...prev, mode: data.mode } : prev));
      }
      if (data.autoReleased) {
        setSelectedConv((prev) => (prev ? { ...prev, mode: "ai", assignedTo: null } : prev));
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(pollTimerRef.current);
    };
  }, [fetchMessages, selectedId]);

  const handleTakeOver = useCallback(async () => {
    if (!selectedId) return false;

    try {
      const res = await fetch(`/app/api/conversations/${selectedId}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "take_over" }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || "Failed to take over conversation");
        return false;
      }
      setSelectedConv((prev) => (prev ? { ...prev, mode: "merchant" } : prev));
      const messageData = await fetchMessages(selectedId);
      if (messageData) setMessages(messageData.messages || []);
      return true;
    } catch (error) {
      alert(`Error: ${error.message}`);
      return false;
    }
  }, [fetchMessages, selectedId]);

  const handleRelease = async () => {
    if (!selectedId) return;

    try {
      const res = await fetch(`/app/api/conversations/${selectedId}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || "Failed to release conversation");
        return;
      }
      setSelectedConv((prev) => (prev ? { ...prev, mode: "ai", assignedTo: null } : prev));
      const messageData = await fetchMessages(selectedId);
      if (messageData) setMessages(messageData.messages || []);
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  const handleSend = async () => {
    const content = inputValue.trim();
    if (!content || sending || !selectedId) return;
    setSending(true);

    try {
      const currentMode = selectedConv?.mode || "ai";
      if (currentMode !== "merchant") {
        const takenOver = await handleTakeOver();
        if (!takenOver) {
          setSending(false);
          return;
        }
      }

      const res = await fetch(`/app/api/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        setSending(false);
        return;
      }

      const data = await res.json();
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
      }
      setSelectedConv((prev) => (prev ? { ...prev, mode: "merchant" } : prev));
      setInputValue("");
    } catch {
      // Ignore send failures for now.
    }

    setSending(false);
  };

  const filteredConversations = useMemo(() => {
    return conversations.filter((conv) => {
      if (tab === "unread" && conv.mode !== "pending_merchant") return false;
      if (tab === "active" && conv.mode === "pending_merchant") return false;
      return true;
    });
  }, [conversations, tab]);

  useEffect(() => {
    if (!filteredConversations.some((conv) => conv.id === selectedId)) {
      setSelectedId(filteredConversations[0]?.id || null);
    }
  }, [filteredConversations, selectedId]);

  const selectedStatus = selectedConv ? getStatusMeta(selectedConv.mode) : getStatusMeta("ai");
  const orderList = selectedConv?.orderNumbers
    ? selectedConv.orderNumbers.split(",").map((item) => item.trim()).filter(Boolean)
    : [];

  return (
    <s-page>
      <div
        style={{
          width: "calc(100vw - 32px)",
          marginLeft: "calc(50% - 50vw + 16px)",
          boxSizing: "border-box",
          display: "grid",
          gridTemplateColumns: "332px minmax(0, 1fr) 260px",
          height: "calc(100vh - 96px)",
          maxHeight: "calc(100vh - 96px)",
          border: "1px solid #e5e7eb",
          borderRadius: "18px",
          overflow: "hidden",
          backgroundColor: "#ffffff",
        }}
      >
        <aside style={{ borderRight: "1px solid #e5e7eb", backgroundColor: "#ffffff", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "18px 18px 14px", borderBottom: "1px solid #e5e7eb" }}>
            <h1 style={{ margin: 0, fontSize: "18px", lineHeight: 1.2, color: "#0f172a" }}>AI Chat Support</h1>
            <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: "14px" }}>Manage customer conversations</p>
          </div>

          <div style={{ display: "flex", gap: "8px", padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>
            {[
              ["all", "All"],
              ["unread", "Unread"],
              ["active", "Active"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                style={{
                  border: "none",
                  borderRadius: "10px",
                  padding: "8px 14px",
                  fontSize: "14px",
                  cursor: "pointer",
                  backgroundColor: tab === value ? "#e8eefc" : "transparent",
                  color: tab === value ? "#2563eb" : "#475569",
                  fontWeight: tab === value ? 600 : 500,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {filteredConversations.length === 0 ? (
              <div style={{ padding: "24px 18px", color: "#64748b", fontSize: "14px" }}>
                No conversations in this view.
              </div>
            ) : (
              filteredConversations.map((conversation) => {
                const isSelected = conversation.id === selectedId;
                const preview = parsePreview(conversation.messages?.[0]?.content || "") || "No messages yet";
                const status = getStatusMeta(conversation.mode);

                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => setSelectedId(conversation.id)}
                    style={{
                      width: "100%",
                      border: "none",
                      background: isSelected ? "#f8fafc" : "#ffffff",
                      borderBottom: "1px solid #e5e7eb",
                      padding: "16px 14px",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "12px", alignItems: "start" }}>
                      {renderIconBubble(getInitials(conversation))}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "16px", fontWeight: 600, color: "#0f172a" }}>{getDisplayName(conversation)}</span>
                          <span style={{ width: "7px", height: "7px", borderRadius: "999px", backgroundColor: status.dot, flexShrink: 0 }} />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", color: "#64748b", fontSize: "13px" }}>
                          <span style={{ color: status.dot }}>o</span>
                          <span>{status.label}</span>
                        </div>
                        <div style={{ marginTop: "8px", color: "#475569", fontSize: "14px", lineHeight: 1.35 }}>
                          {preview.length > 54 ? `${preview.slice(0, 54)}...` : preview}
                        </div>
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: "13px", whiteSpace: "nowrap", paddingTop: "4px" }}>
                        {timeAgo(conversation.updatedAt)}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main style={{ display: "flex", flexDirection: "column", backgroundColor: "#f8fafc", minWidth: 0, minHeight: 0 }}>
          {selectedConv ? (
            <>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb", backgroundColor: "#ffffff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    {renderIconBubble(getInitials(selectedConv))}
                    <div>
                      <div style={{ fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>{getDisplayName(selectedConv)}</div>
                      <div style={{ marginTop: "3px", color: "#64748b", fontSize: "14px" }}>
                        {selectedConv.customerEmail || selectedConv.id}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      borderRadius: "999px",
                      padding: "10px 14px",
                      backgroundColor: selectedStatus.pillBg,
                      color: selectedStatus.pillColor,
                      fontSize: "14px",
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span>o</span>
                    <span>{selectedStatus.label}</span>
                  </div>
                </div>
              </div>

              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 16px 18px" }}>
                {messages.map((message) => {
                  const meta = getMessageMeta(message.role);
                  return (
                    <div key={message.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "12px", marginBottom: "14px", alignItems: "start" }}>
                      {renderIconBubble(
                        message.role === "assistant" ? "AI" : message.role === "merchant" ? "ME" : getInitials(selectedConv),
                        message.role === "assistant" ? "#3b82f6" : "#8b5cf6"
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "15px", fontWeight: 600, color: "#1e293b" }}>{meta.label === "Customer" ? getDisplayName(selectedConv) : meta.label}</span>
                          <span style={{ color: "#94a3b8", fontSize: "13px" }}>{timeAgo(message.createdAt)}</span>
                        </div>
                        <div
                          style={{
                            marginTop: "6px",
                            maxWidth: "76%",
                            backgroundColor: meta.bubble.background,
                            color: "#0f172a",
                            borderRadius: "12px",
                            padding: "12px 14px",
                            fontSize: "14px",
                            lineHeight: 1.45,
                          }}
                        >
                          {parseContent(message.content)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div style={{ borderTop: "1px solid #e5e7eb", backgroundColor: "#ffffff", padding: "10px 14px 14px" }}>
                {selectedConv.mode !== "merchant" && (
                  <div
                    style={{
                      backgroundColor: "#fff8e8",
                      border: "1px solid #f2d28b",
                      color: "#b45309",
                      borderRadius: "12px",
                      padding: "12px 14px",
                      fontSize: "14px",
                      marginBottom: "12px",
                    }}
                  >
                    <strong>{selectedStatus.bannerText.split(".")[0]}.</strong>{selectedStatus.bannerText.includes(".") ? ` ${selectedStatus.bannerText.split(".").slice(1).join(".").trim()}` : ""}
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", alignItems: "end" }}>
                  <textarea
                    value={inputValue}
                    placeholder={selectedConv.mode === "merchant" ? "Type your message..." : "Type your message to take over the conversation..."}
                    onChange={(event) => setInputValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        handleSend();
                      }
                    }}
                    rows={2}
                    style={{
                      width: "100%",
                      resize: "none",
                      borderRadius: "12px",
                      border: "1px solid #d1d5db",
                      padding: "14px",
                      fontSize: "14px",
                      fontFamily: "inherit",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || !inputValue.trim()}
                    style={{
                      border: "none",
                      borderRadius: "999px",
                      backgroundColor: sending || !inputValue.trim() ? "#cbd5e1" : "#2563eb",
                      color: "#ffffff",
                      padding: "12px 20px",
                      fontSize: "15px",
                      fontWeight: 600,
                      cursor: sending || !inputValue.trim() ? "not-allowed" : "pointer",
                      minWidth: "96px",
                    }}
                  >
                    {sending ? "Sending" : "Send"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", backgroundColor: "#f8fafc" }}>
              Select a conversation
            </div>
          )}
        </main>

        <aside style={{ borderLeft: "1px solid #e5e7eb", backgroundColor: "#ffffff", padding: "14px 14px 16px", overflow: "hidden" }}>
          {selectedConv ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px", height: "100%", overflow: "hidden" }}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>Customer Details</div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "16px" }}>
                  {renderIconBubble(getInitials(selectedConv))}
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a" }}>{getDisplayName(selectedConv)}</div>
                    <div style={{ fontSize: "14px", color: "#64748b" }}>{selectedStatus.label}</div>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ color: "#475569", fontSize: "14px" }}>Email: {selectedConv.customerEmail || "No customer email captured"}</div>
                <div style={{ color: "#475569", fontSize: "14px" }}>Messages: {messages.length}</div>
                <div style={{ color: "#475569", fontSize: "14px" }}>Linked orders: {orderList.length}</div>
              </div>

              <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "14px" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a", marginBottom: "14px" }}>Order Context</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px", fontSize: "14px", color: "#475569" }}>
                  <span>Order Number</span>
                  <strong style={{ color: "#0f172a" }}>{orderList[0] || "None"}</strong>
                  <span>Source page</span>
                  <strong style={{ color: "#0f172a", maxWidth: "110px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {selectedConv.pageUrl || "Unknown"}
                  </strong>
                </div>
                <button
                  type="button"
                  disabled={!selectedConv.orderNumbers}
                  style={{
                    width: "100%",
                    marginTop: "14px",
                    borderRadius: "10px",
                    border: "1px solid #d1d5db",
                    backgroundColor: "#ffffff",
                    color: selectedConv.orderNumbers ? "#334155" : "#94a3b8",
                    padding: "10px 12px",
                    fontSize: "14px",
                  }}
                >
                  View Full Order
                </button>
              </div>

              <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "14px" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a", marginBottom: "14px" }}>Quick Actions</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={selectedConv.mode === "merchant" ? handleRelease : handleTakeOver}
                    style={{
                      width: "100%",
                      border: "none",
                      borderRadius: "10px",
                      backgroundColor: "#2563eb",
                      color: "#ffffff",
                      padding: "10px 12px",
                      fontSize: "14px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {selectedConv.mode === "merchant" ? "Release to AI" : "Take Over"}
                  </button>
                  <button
                    type="button"
                    disabled
                    style={{ width: "100%", borderRadius: "10px", border: "1px solid #d1d5db", backgroundColor: "#ffffff", color: "#475569", padding: "10px 12px", fontSize: "14px" }}
                  >
                    Create Discount Code
                  </button>
                  <button
                    type="button"
                    disabled
                    style={{ width: "100%", borderRadius: "10px", border: "1px solid #d1d5db", backgroundColor: "#ffffff", color: "#475569", padding: "10px 12px", fontSize: "14px" }}
                  >
                    Mark as Resolved
                  </button>
                </div>
              </div>

              <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "14px", color: "#64748b", fontSize: "14px", marginTop: "auto" }}>
                Conversation started {timeAgo(selectedConv.createdAt)}
                <div style={{ marginTop: "6px", fontSize: "13px" }}>{formatDate(selectedConv.createdAt)}</div>
              </div>
            </div>
          ) : (
            <div style={{ color: "#64748b", fontSize: "14px" }}>Select a conversation to view details.</div>
          )}
        </aside>
      </div>
    </s-page>
  );
}

