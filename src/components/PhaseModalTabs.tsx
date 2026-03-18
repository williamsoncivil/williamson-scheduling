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

interface ScheduleItem {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  user: { id: string; name: string };
}

interface PhaseModalTabsProps {
  phaseId: string;
  jobId: string;
}

export function PhaseModalTabs({ phaseId, jobId }: PhaseModalTabsProps) {
  const [tab, setTab] = useState<"team" | "notes" | "files">("team");

  // Team / schedule items
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[] | null>(null);

  // Messages
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);

  // Files
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Lightbox
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);

  const fetchTeam = async () => {
    if (scheduleItems !== null) return;
    const res = await fetch(`/api/schedule?jobId=${jobId}&phaseId=${phaseId}`);
    if (res.ok) {
      const data = await res.json();
      const entries: ScheduleItem[] = data.entries ?? (Array.isArray(data) ? data : []);
      setScheduleItems(entries);
    }
  };

  const fetchMessages = async () => {
    if (messages !== null) return;
    const res = await fetch(`/api/messages?jobId=${jobId}&phaseId=${phaseId}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages ?? (Array.isArray(data) ? data : []));
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

  const switchTab = (t: "team" | "notes" | "files") => {
    setTab(t);
    if (t === "team") fetchTeam();
    if (t === "notes") fetchMessages();
    if (t === "files") fetchDocs();
  };

  // Load team on first render
  useEffect(() => { fetchTeam(); }, []);

  const deleteDoc = async (docId: string) => {
    if (!confirm("Delete this file?")) return;
    await fetch(`/api/documents/${docId}`, { method: "DELETE" });
    setDocs(null);
    const res = await fetch(`/api/documents?jobId=${jobId}&phaseId=${phaseId}`);
    if (res.ok) { const data = await res.json(); setDocs(Array.isArray(data) ? data : (data.documents ?? [])); }
  };

  // Lightbox keyboard navigation
  useEffect(() => {
    if (lightboxIndex === null) return;
    const images = (docs ?? []).filter(d => d.fileType.startsWith("image/"));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setLightboxIndex((i) => i !== null ? (i - 1 + images.length) % images.length : null);
      else if (e.key === "ArrowRight") setLightboxIndex((i) => i !== null ? (i + 1) % images.length : null);
      else if (e.key === "Escape") setLightboxIndex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, docs]);

  // Native touch events for lightbox swipe (iOS PWA fix)
  useEffect(() => {
    const el = lightboxRef.current;
    if (!el || lightboxIndex === null) return;
    const images = (docs ?? []).filter(d => d.fileType.startsWith("image/"));
    let startX = 0;
    const onStart = (e: TouchEvent) => { startX = e.touches[0].clientX; e.preventDefault(); };
    const onEnd = (e: TouchEvent) => {
      const diff = startX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 40) {
        setLightboxIndex(diff > 0
          ? (lightboxIndex + 1) % images.length
          : (lightboxIndex - 1 + images.length) % images.length
        );
      }
    };
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, [lightboxIndex, docs]);

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
    const res = await fetch(`/api/messages?jobId=${jobId}&phaseId=${phaseId}`);
    if (res.ok) { const data = await res.json(); setMessages(data.messages ?? (Array.isArray(data) ? data : [])); }
    setSending(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      await Promise.all(files.map(async (file) => {
        const timestamp = Date.now() + Math.random();
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
      }));
      // Force refresh
      setDocs(null);
      const res = await fetch(`/api/documents?jobId=${jobId}&phaseId=${phaseId}`);
      if (res.ok) { const data = await res.json(); setDocs(Array.isArray(data) ? data : (data.documents ?? [])); }
    } catch (err) {
      alert("Upload failed: " + String(err));
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const isImage = (type: string) => type.startsWith("image/");

  const formatDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        {(["team", "notes", "files"] as const).map((t) => (
          <button key={t} onClick={() => switchTab(t)}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${tab === t ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            {t === "team" ? "👷 Team" : t === "notes" ? "💬 Notes" : "📎 Files"}
          </button>
        ))}
      </div>

      {/* Team tab */}
      {tab === "team" && (
        <div className="max-h-40 overflow-y-auto space-y-1">
          {scheduleItems === null ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : scheduleItems.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No one assigned yet</p>
          ) : scheduleItems.map((item) => (
            <div key={item.id} className="flex items-center gap-2 py-1 border-b border-gray-50 last:border-0">
              <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs flex items-center justify-center font-semibold shrink-0">
                {item.user.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-gray-700">{item.user.name}</span>
              </div>
              <div className="text-xs text-gray-400 shrink-0">
                {formatDate(item.date)} · {item.startTime}–{item.endTime}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Notes tab */}
      {tab === "notes" && (
        <div>
          <div className="max-h-40 overflow-y-auto space-y-2 mb-2">
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
                  <span className="text-xs text-gray-400 ml-1">{formatDate(msg.createdAt)}</span>
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

      {/* Files tab — list scrolls, upload button pinned at bottom */}
      {tab === "files" && (() => {
        const images = (docs ?? []).filter(d => isImage(d.fileType));
        return (
          <div className="flex flex-col gap-2">
            {/* Scrollable file list */}
            <div className="max-h-40 overflow-y-auto space-y-2">
              {docs === null ? (
                <p className="text-xs text-gray-400">Loading…</p>
              ) : docs.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No files yet</p>
              ) : docs.map((doc) => {
                const imgIdx = images.findIndex(i => i.id === doc.id);
                return (
                  <div key={doc.id} className="flex items-center gap-2">
                    {isImage(doc.fileType) ? (
                      <div className="relative shrink-0 group">
                        <img
                          src={doc.fileUrl} alt={doc.name}
                          onClick={() => setLightboxIndex(imgIdx)}
                          className="w-10 h-10 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                        />
                        <button
                          onClick={() => deleteDoc(doc.id)}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/60 text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                          title="Delete"
                        >✕</button>
                      </div>
                    ) : (
                      <div className="w-10 h-10 bg-red-50 border border-red-200 rounded flex items-center justify-center shrink-0 text-[10px] font-bold text-red-600">PDF</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <a href={doc.fileUrl} target="_blank" rel="noreferrer"
                        className="text-xs text-blue-600 hover:underline truncate block font-medium">{doc.name}</a>
                      <p className="text-xs text-gray-400">{doc.uploadedBy.name} · {formatDate(doc.createdAt)}</p>
                    </div>
                    {!isImage(doc.fileType) && (
                      <button
                        onClick={() => deleteDoc(doc.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors shrink-0 text-sm"
                        title="Delete"
                      >🗑</button>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Upload button always visible at bottom */}
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="w-full text-xs border-2 border-dashed border-gray-300 rounded-lg py-2.5 text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors disabled:opacity-40 shrink-0">
              {uploading ? "Uploading…" : "📷 Take Photo or Upload File"}
            </button>
            <input ref={fileRef} type="file" accept="image/*,.pdf,video/*" multiple className="hidden" onChange={handleFileChange} />

            {/* Lightbox */}
            {lightboxIndex !== null && images.length > 0 && (
              <div
                ref={lightboxRef}
                className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
                onClick={() => setLightboxIndex(null)}
              >
                {/* Close */}
                <button
                  onClick={() => setLightboxIndex(null)}
                  className="absolute top-4 right-4 text-white text-2xl font-bold w-10 h-10 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60"
                >✕</button>

                {/* Counter */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white text-sm font-medium bg-black/40 px-3 py-1 rounded-full">
                  {lightboxIndex + 1} / {images.length}
                </div>

                {/* Prev */}
                {images.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex - 1 + images.length) % images.length); }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-3xl w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60"
                  >‹</button>
                )}

                {/* Image */}
                <img
                  src={images[lightboxIndex].fileUrl}
                  alt={images[lightboxIndex].name}
                  onClick={(e) => e.stopPropagation()}
                  className="max-w-[90vw] max-h-[85vh] object-contain rounded shadow-2xl"
                />

                {/* Next */}
                {images.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex + 1) % images.length); }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-3xl w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60"
                  >›</button>
                )}

                {/* Caption */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm bg-black/40 px-4 py-1.5 rounded-full max-w-xs truncate">
                  {images[lightboxIndex].name}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
