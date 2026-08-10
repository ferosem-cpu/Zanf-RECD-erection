"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";

interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoredMessage {
  role: "user" | "assistant" | "tool";
  content?: string;
  toolCallId?: string;
}

export default function AgentChatBubble() {
  const { user, loading: authLoading } = useAuth();

  const [visible, setVisible] = useState(false);
  const [checkedVisibility, setCheckedVisibility] = useState(false);
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Visibility: current user's role must be in the Super-Admin-configured allowlist.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setVisible(false);
      setCheckedVisibility(true);
      return;
    }
    api<{ agentVisibleRoleKeys?: string[] }>("/settings")
      .then((data) => {
        const roleKeys = data.agentVisibleRoleKeys ?? [];
        setVisible(roleKeys.includes(user.role.key));
      })
      .catch(() => setVisible(false))
      .finally(() => setCheckedVisibility(true));
  }, [authLoading, user]);

  const loadConversations = useCallback(async () => {
    const data = await api<{ conversations: ConversationSummary[] }>("/agent/conversations");
    setConversations(data.conversations);
    return data.conversations;
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const data = await api<{ id: string; messages: StoredMessage[] }>(`/agent/conversations/${id}`);
    setActiveId(data.id);
    setMessages(data.messages ?? []);
  }, []);

  async function ensureConversation(): Promise<string> {
    if (activeId) return activeId;
    const list = conversations.length > 0 ? conversations : await loadConversations();
    if (list.length > 0) {
      await loadConversation(list[0].id);
      return list[0].id;
    }
    const created = await api<{ id: string }>("/agent/conversations", { method: "POST", body: JSON.stringify({}) });
    setActiveId(created.id);
    setMessages([]);
    setConversations([{ id: created.id, title: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]);
    return created.id;
  }

  async function startNewConversation() {
    const created = await api<{ id: string }>("/agent/conversations", { method: "POST", body: JSON.stringify({}) });
    setActiveId(created.id);
    setMessages([]);
    setShowHistory(false);
    loadConversations();
  }

  async function openPanel() {
    setOpen(true);
    if (!activeId) {
      try {
        await ensureConversation();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setSending(true);
    try {
      const id = await ensureConversation();
      const result = await api<{ reply: string; messages: StoredMessage[] }>(`/agent/conversations/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });
      setMessages(result.messages ?? []);
      loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  if (!checkedVisibility || !visible) return null;

  // Only render user turns and assistant turns that actually said something - tool-call-only
  // turns and raw tool-result turns are implementation detail, not a human-readable transcript.
  const visibleMessages = messages.filter((m) => (m.role === "user" || m.role === "assistant") && m.content);

  return (
    <>
      {!open && (
        <button
          onClick={openPanel}
          className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white text-xl"
          style={{ backgroundColor: "var(--theme-primary, #F58220)" }}
          aria-label="Open assistant"
        >
          💬
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-[360px] max-w-[calc(100vw-2.5rem)] h-[520px] max-h-[calc(100vh-3rem)] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-100">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="font-semibold text-sm">Assistant</span>
            <div className="flex items-center gap-3 text-gray-400">
              <button onClick={() => setShowHistory((v) => !v)} className="text-xs hover:text-gray-700" title="History">
                History
              </button>
              <button onClick={startNewConversation} className="text-xs hover:text-gray-700" title="New chat">
                + New
              </button>
              <button onClick={() => setOpen(false)} className="hover:text-gray-700" aria-label="Close">
                ✕
              </button>
            </div>
          </div>

          {showHistory && (
            <div className="border-b border-gray-100 max-h-40 overflow-y-auto">
              {conversations.length === 0 ? (
                <p className="text-xs text-gray-400 px-4 py-2">No past conversations.</p>
              ) : (
                conversations.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      loadConversation(c.id);
                      setShowHistory(false);
                    }}
                    className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-50 ${c.id === activeId ? "bg-gray-50 font-medium" : ""}`}
                  >
                    {c.title || "New conversation"}
                  </button>
                ))
              )}
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {visibleMessages.length === 0 && !sending && (
              <p className="text-xs text-gray-400">Ask me anything - I can search shared documents for you.</p>
            )}
            {visibleMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-400 rounded-2xl px-3 py-2 text-sm">Thinking…</div>
              </div>
            )}
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          <div className="border-t border-gray-100 p-3 flex gap-2">
            <input
              className="field flex-1 text-sm"
              placeholder="Type a message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={sending}
            />
            <button className="btn-primary px-3 py-2 text-sm" onClick={send} disabled={sending || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
