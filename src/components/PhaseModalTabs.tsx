"use client";

import { useState, useRef, useEffect } from "react";
import { upload } from "@vercel/blob/client";

interface Message {
  id: string;
  content: string;
  createdAt: string;
  author: { name: string };
}

interface Doc {
  id: string;
  name: string;
  fileUrl: string;
  fileType: string;
  fileSize: number | null;
  uploadedBy: { name: string };
  createdAt: string;
}

interface PhaseModalTabsProps {
  phaseId: string;
  jobId: string;
}

export function PhaseModalTabs({ phaseId, jobId }: PhaseModalTabsProps) {
  const [tab, setTab] = useState<"notes" | "files">("notes");

  // Messages
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);

  // Files
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchMessages = async () => {
    if (messages !== null) return;
    const res = await fetch(`/api/messages?jobId=${jobId}&phaseId=${phaseId}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages ?? data);
    }
  };

  const fetchDocs = async () => {
    if (docs !== null) return;
    const res = await fetch(`/api/documents?jobId=${jobId}&phaseId=${phaseId}`);
    if (res.ok) {
      const data = await res.json();
      setDocs(Array.isArray(data) ? data : (data.documents ?? []));
    }
  };

  const switchTab = (t: "notes" | "files") => {
    setTab(t);
    if (t === "notes") fetchMessages();
    if (t === "files") fetchDocs();
  };

  // Load notes on first render
  useEffect(() => { fetchMessages(); }, []);

  const sendMessage = async () => {
    const content = msgInput.trim();
    if (!content) return;
    setSending(true);
    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, jobId, phaseId }),
    });
    setMsgInput("");
    // Refresh
    const res = await fetch(`/api/messages?jobId=${jobId}&phaseId=${phaseId}`);
    if (res.ok) { const data = await res.json(); setMessages(data.messages ?? data); }
    setSending(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const blob = await upload(`uploads/${timestamp}_${safeName}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
      });
      await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, fileUrl: blob.url, fileType: file.type || "application/octet-stream", fileSize: file.size, jobId, phaseId }),
      });
      // Refresh docs
      const res2 = await fetch(`/api/documents?jobId=${jobId}&phaseId=${phaseId}`);
      if (res2.ok) { const data2 = await res2.json(); setDocs(Array.isArray(data2) ? data2 : (data2.documents ?? [])); }
    } catch (err) {
      alert("Upload failed: " + String(err));
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const isImage = (type: string) => type.startsWith("image/");

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        {(["notes", "files"] as const).map((t) => (
          <button key={t} onClick={() => switchTab(t)}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${tab === t ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            {t === "notes" ? "💬 Notes" : "📎 Files"}
          </button>
        ))}
      </div>

      {/* Notes tab */}
      {tab === "notes" && (
        <div>
          <div className="max-h-36 overflow-y-auto space-y-2 mb-2">
            {messages === null ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : messages.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No notes yet</p>
            ) : messages.map((msg) => (
              <div key={msg.id} className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-semibold shrink-0">
                  {msg.author.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-700">{msg.author.name}</span>
                  <span className="text-xs text-gray-400 ml-1">{new Date(msg.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  <p className="text-xs text-gray-600 mt-0.5">{msg.content}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input type="text" value={msgInput} onChange={(e) => setMsgInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}
              placeholder="Add a note…"
              className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <button onClick={sendMessage} disabled={sending || !msgInput.trim()}
              className="text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40">
              {sending ? "…" : "Send"}
            </button>
          </div>
        </div>
      )}

      {/* Files tab */}
      {tab === "files" && (
        <div>
          <div className="max-h-36 overflow-y-auto space-y-2 mb-2">
            {docs === null ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : docs.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No files yet</p>
            ) : docs.map((doc) => (
              <div key={doc.id} className="flex items-center gap-2">
                {isImage(doc.fileType) ? (
                  <img src={doc.fileUrl} alt={doc.name} className="w-8 h-8 object-cover rounded border border-gray-200 shrink-0" />
                ) : (
                  <div className="w-8 h-8 bg-red-50 border border-red-200 rounded flex items-center justify-center shrink-0 text-xs font-bold text-red-600">PDF</div>
                )}
                <div className="flex-1 min-w-0">
                  <a href={doc.fileUrl} target="_blank" rel="noreferrer"
                    className="text-xs text-blue-600 hover:underline truncate block font-medium">{doc.name}</a>
                  <p className="text-xs text-gray-400">{doc.uploadedBy.name} · {new Date(doc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="w-full text-xs border-2 border-dashed border-gray-300 rounded-lg py-2 text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors disabled:opacity-40">
            {uploading ? "Uploading…" : "📎 Tap to attach photo or file"}
          </button>
          <input ref={fileRef} type="file" accept="image/*,.pdf,video/*" className="hidden" onChange={handleFileChange} />
        </div>
      )}
    </div>
  );
}
