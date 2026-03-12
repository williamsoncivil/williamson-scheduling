"use client";

import { useEffect, useState, useRef } from "react";
import Layout from "@/components/Layout";
import { format, parseISO } from "date-fns";

interface MentionedUser { id: string; name: string; }
interface Message {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; role: string };
  job: { id: string; name: string; color: string };
  phase: { id: string; name: string } | null;
  mentions: { user: MentionedUser }[];
}

interface Job { id: string; name: string; color: string; }
interface Phase { id: string; name: string; }
interface User { id: string; name: string; }

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [filterJobId, setFilterJobId] = useState("");
  const [filterPhaseId, setFilterPhaseId] = useState("");
  const [newJobId, setNewJobId] = useState("");
  const [newPhaseId, setNewPhaseId] = useState("");
  const [newPhases, setNewPhases] = useState<Phase[]>([]);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  // @mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/jobs").then((r) => r.json()).then(setJobs);
    fetch("/api/people").then((r) => r.json()).then(setAllUsers);
  }, []);

  useEffect(() => {
    if (!filterJobId) { setPhases([]); setFilterPhaseId(""); return; }
    fetch(`/api/jobs/${filterJobId}/phases`).then((r) => r.json()).then((d) => { setPhases(d); setFilterPhaseId(""); });
  }, [filterJobId]);

  useEffect(() => {
    if (!newJobId) { setNewPhases([]); setNewPhaseId(""); return; }
    fetch(`/api/jobs/${newJobId}/phases`).then((r) => r.json()).then((d) => { setNewPhases(d); setNewPhaseId(""); });
  }, [newJobId]);

  useEffect(() => {
    fetch("/api/messages/read", { method: "POST" });
    window.dispatchEvent(new Event("messages-read"));
  }, []);

  const fetchMessages = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterJobId) params.set("jobId", filterJobId);
    if (filterPhaseId) params.set("phaseId", filterPhaseId);
    fetch(`/api/messages?${params}`)
      .then((r) => r.json())
      .then((d) => { setMessages(d.reverse()); setLoading(false); });
  };

  useEffect(() => { fetchMessages(); }, [filterJobId, filterPhaseId]); // eslint-disable-line

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Detect @mention as user types
  const handleContentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setContent(val);
    const cursor = e.target.selectionStart ?? val.length;
    // Find last @ before cursor
    const before = val.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");
    if (atIdx >= 0) {
      const after = before.slice(atIdx + 1);
      // Only show if no space in the query (still typing a name)
      if (!after.includes(" ") || after.split(" ").length <= 2) {
        setMentionQuery(after.toLowerCase());
        setMentionStart(atIdx);
        return;
      }
    }
    setMentionQuery(null);
  };

  const filteredUsers = mentionQuery !== null
    ? allUsers.filter((u) => u.name.toLowerCase().startsWith(mentionQuery) && mentionQuery.length > 0)
    : [];

  const insertMention = (user: User) => {
    const before = content.slice(0, mentionStart);
    const after = content.slice(mentionStart + 1 + (mentionQuery?.length ?? 0));
    setContent(`${before}@${user.name}${after} `);
    setMentionQuery(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !newJobId) return;
    setSending(true);
    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, jobId: newJobId, phaseId: newPhaseId || null }),
    });
    setContent("");
    setSending(false);
    fetchMessages();
  };

  // Render message content with @mentions highlighted
  const renderContent = (text: string, mentions: { user: MentionedUser }[]) => {
    if (mentions.length === 0) return <span>{text}</span>;
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;
    for (const { user } of mentions) {
      const tag = `@${user.name}`;
      const idx = remaining.indexOf(tag);
      if (idx >= 0) {
        if (idx > 0) parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
        parts.push(
          <span key={key++} className="bg-blue-100 text-blue-700 font-semibold rounded px-1">
            {tag}
          </span>
        );
        remaining = remaining.slice(idx + tag.length);
      }
    }
    if (remaining) parts.push(<span key={key++}>{remaining}</span>);
    return <>{parts}</>;
  };

  const grouped = messages.reduce<Record<string, Message[]>>((acc, m) => {
    const day = format(parseISO(m.createdAt), "MMMM d, yyyy");
    if (!acc[day]) acc[day] = [];
    acc[day].push(m);
    return acc;
  }, {});

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto flex flex-col" style={{ height: "calc(100vh - 32px)" }}>
        {/* Header */}
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Use <span className="font-mono bg-gray-100 px-1 rounded text-gray-700">@Name</span> to notify someone
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <select value={filterJobId} onChange={(e) => setFilterJobId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">All Jobs</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
            {filterJobId && (
              <select value={filterPhaseId} onChange={(e) => setFilterPhaseId(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">All Phases</option>
                {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto bg-white rounded-xl shadow-sm p-4 mb-4 min-h-0">
          {loading ? (
            <div className="text-gray-400 text-center py-12">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="text-gray-400 text-center py-12">
              No messages yet{filterJobId ? " for this filter" : ""} — send one below
            </div>
          ) : (
            Object.entries(grouped).map(([day, msgs]) => (
              <div key={day}>
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-xs text-gray-400 font-medium">{day}</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
                {msgs.map((msg) => (
                  <div key={msg.id} className="flex gap-3 py-2 hover:bg-gray-50 rounded-lg px-2 transition-colors">
                    <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: msg.job.color }}>
                      {msg.author.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">{msg.author.name}</span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: msg.job.color }}>
                          {msg.job.name}
                        </span>
                        {msg.phase && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                            {msg.phase.name}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">{format(parseISO(msg.createdAt), "h:mm a")}</span>
                      </div>
                      <p className="text-sm text-gray-700 mt-0.5">
                        {renderContent(msg.content, msg.mentions)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Compose */}
        <div className="bg-white rounded-xl shadow-sm p-4 relative">
          {/* @mention autocomplete dropdown */}
          {filteredUsers.length > 0 && (
            <div className="absolute bottom-full mb-1 left-4 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-20 w-56">
              <p className="text-xs text-gray-400 px-3 py-2 border-b border-gray-100">Mention someone</p>
              {filteredUsers.map((u) => (
                <button key={u.id} type="button" onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                    {u.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                  {u.name}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={sendMessage} className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <select value={newJobId} onChange={(e) => setNewJobId(e.target.value)} required
                className="flex-1 min-w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">Select job…</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
              {newJobId && (
                <select value={newPhaseId} onChange={(e) => setNewPhaseId(e.target.value)}
                  className="flex-1 min-w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="">No specific phase</option>
                  {newPhases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>
            <div className="flex gap-2">
              <input ref={inputRef} type="text" value={content} onChange={handleContentChange}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setMentionQuery(null);
                  if (e.key === "Enter" && !e.shiftKey && filteredUsers.length === 0) { sendMessage(e as unknown as React.FormEvent); }
                }}
                placeholder="Type a message… use @Name to notify someone"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button type="submit" disabled={sending || !content.trim() || !newJobId}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 shrink-0">
                {sending ? "…" : "Send"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
