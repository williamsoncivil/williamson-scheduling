"use client";

import { useEffect, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { format, parseISO } from "date-fns";
import { upload } from "@vercel/blob/client";
import { useSession } from "next-auth/react";

interface Document {
  id: string;
  name: string;
  fileUrl: string;
  fileType: string;
  fileCategory: string;
  phaseId: string | null;
  phase: { id: string; name: string } | null;
  createdAt: string;
  uploadedBy: { id: string; name: string };
  job: { id: string; name: string };
}

interface Job {
  id: string;
  name: string;
}

interface Phase {
  id: string;
  name: string;
}

type CategoryFilter = "all" | "photo" | "document";
type GroupBy = "none" | "phase";

export default function FilesPage() {
  const { data: session } = useSession();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [filterJob, setFilterJob] = useState("");
  const [filterPhase, setFilterPhase] = useState("");
  const [filterCategory, setFilterCategory] = useState<CategoryFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);

  // Upload state
  const [uploadJobId, setUploadJobId] = useState("");
  const [uploadPhaseId, setUploadPhaseId] = useState("");
  const [uploadPhases, setUploadPhases] = useState<Phase[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((d) => setJobs(d));
  }, []);

  // Load phases when filter job changes
  useEffect(() => {
    setFilterPhase("");
    setPhases([]);
    if (!filterJob) return;
    fetch(`/api/jobs/${filterJob}/phases`)
      .then((r) => r.json())
      .then((d) => setPhases(Array.isArray(d) ? d : []));
  }, [filterJob]);

  // Load phases for upload job picker
  useEffect(() => {
    setUploadPhaseId("");
    setUploadPhases([]);
    if (!uploadJobId) return;
    fetch(`/api/jobs/${uploadJobId}/phases`)
      .then((r) => r.json())
      .then((d) => setUploadPhases(Array.isArray(d) ? d : []));
  }, [uploadJobId]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterJob) params.set("jobId", filterJob);
    if (filterPhase) params.set("phaseId", filterPhase);
    if (filterCategory !== "all") params.set("fileCategory", filterCategory);
    fetch(`/api/documents?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setDocuments(d);
        setLoading(false);
      });
  }, [filterJob, filterPhase, filterCategory]);

  const refreshDocs = () => {
    const params = new URLSearchParams();
    if (filterJob) params.set("jobId", filterJob);
    if (filterPhase) params.set("phaseId", filterPhase);
    if (filterCategory !== "all") params.set("fileCategory", filterCategory);
    fetch(`/api/documents?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setDocuments(d));
  };

  const deleteDoc = async (docId: string) => {
    if (!window.confirm("Delete this file? This cannot be undone.")) return;
    const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
    if (res.ok) {
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } else {
      alert("Failed to delete file.");
    }
  };

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!uploadJobId) { alert("Please select a job first."); return; }
    if (!session?.user?.id) { alert("Not logged in — please refresh."); return; }
    setUploading(true);
    try {
      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const blob = await upload(`uploads/${timestamp}_${safeName}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
      });
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          fileUrl: blob.url,
          fileType: file.type || "application/octet-stream",
          jobId: uploadJobId,
          phaseId: uploadPhaseId || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to save: ${err.error ?? res.statusText}`);
      } else {
        refreshDocs();
      }
    } catch (err) {
      alert(`Upload error: ${String(err)}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const photos = documents.filter((d) => d.fileCategory === "photo");
  const docs = documents.filter((d) => d.fileCategory === "document");

  const displayedPhotos = filterCategory === "document" ? [] : photos;
  const displayedDocs = filterCategory === "photo" ? [] : docs;

  // Lightbox keyboard navigation
  useEffect(() => {
    if (lightboxIndex === null) return;
    const n = displayedPhotos.length;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setLightboxIndex((i) => i !== null ? (i - 1 + n) % n : null);
      else if (e.key === "ArrowRight") setLightboxIndex((i) => i !== null ? (i + 1) % n : null);
      else if (e.key === "Escape") setLightboxIndex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, displayedPhotos.length]);

  // Lightbox touch swipe
  useEffect(() => {
    const el = lightboxRef.current;
    if (!el || lightboxIndex === null) return;
    const n = displayedPhotos.length;
    let startX = 0;
    const onStart = (e: TouchEvent) => { startX = e.touches[0].clientX; e.preventDefault(); };
    const onEnd = (e: TouchEvent) => {
      const diff = startX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 40) {
        setLightboxIndex((i) => i !== null ? (diff > 0 ? (i + 1) % n : (i - 1 + n) % n) : null);
      }
    };
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, [lightboxIndex, displayedPhotos.length]);

  // Group docs by phase
  const groupedDocs = (() => {
    if (groupBy === "none") return [{ phaseLabel: null, items: displayedDocs }];
    const map = new Map<string, Document[]>();
    displayedDocs.forEach((doc) => {
      const key = doc.phase?.name ?? "No Phase";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(doc);
    });
    // Sort: phases first (alphabetically), then "No Phase" at the end
    const entries = Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "No Phase") return 1;
      if (b === "No Phase") return -1;
      return a.localeCompare(b);
    });
    return entries.map(([phaseLabel, items]) => ({ phaseLabel, items }));
  })();

  const extIcon = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return "📕";
    if (["doc", "docx"].includes(ext ?? "")) return "📝";
    if (["xls", "xlsx"].includes(ext ?? "")) return "📊";
    return "📄";
  };

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Files</h1>
            <p className="text-gray-500 text-sm mt-0.5">All uploaded documents and photos</p>
          </div>
          <button
            onClick={() => setShowUpload((v) => !v)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <span className="text-base">+</span> Upload File
          </button>
        </div>

        {/* Upload panel */}
        {showUpload && (
          <div className="bg-white border border-blue-100 rounded-xl shadow-sm p-5 mb-6">
            <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-end">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Job <span className="text-red-400">*</span></label>
                <select
                  value={uploadJobId}
                  onChange={(e) => setUploadJobId(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-44"
                >
                  <option value="">— Select job —</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>{j.name}</option>
                  ))}
                </select>
              </div>
              {uploadJobId && uploadPhases.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phase <span className="text-gray-400">(optional)</span></label>
                  <select
                    value={uploadPhaseId}
                    onChange={(e) => setUploadPhaseId(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-44"
                  >
                    <option value="">— No phase —</option>
                    {uploadPhases.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <label className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
                uploadJobId
                  ? "bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100"
                  : "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed"
              }`}>
                <span>{uploading ? "Uploading…" : "📎 Choose File"}</span>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf,video/*,.heic,.heif"
                  disabled={!uploadJobId || uploading}
                  onChange={uploadFile}
                />
              </label>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6 flex-wrap">
          {/* Category tabs */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            {(["all", "photo", "document"] as CategoryFilter[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                  filterCategory === cat
                    ? "bg-white shadow-sm text-gray-900"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {cat === "all" ? "All" : cat === "photo" ? "📷 Photos" : "📄 Documents"}
              </button>
            ))}
          </div>

          {/* Job filter */}
          <select
            value={filterJob}
            onChange={(e) => setFilterJob(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">All Jobs</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.name}</option>
            ))}
          </select>

          {/* Phase filter — only shown when a job is selected */}
          {filterJob && phases.length > 0 && (
            <select
              value={filterPhase}
              onChange={(e) => setFilterPhase(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All Phases</option>
              {phases.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          {/* Group by phase toggle */}
          {filterCategory !== "photo" && (
            <button
              onClick={() => setGroupBy(groupBy === "none" ? "phase" : "none")}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                groupBy === "phase"
                  ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {groupBy === "phase" ? "✓ Grouped by Phase" : "Group by Phase"}
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-12">Loading...</div>
        ) : documents.length === 0 ? (
          <div className="text-gray-400 text-center py-12">No files found</div>
        ) : (
          <div className="space-y-8">
            {/* Photos Section */}
            {displayedPhotos.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  📷 Photos
                  <span className="text-sm font-normal text-gray-500">({displayedPhotos.length})</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {displayedPhotos.map((doc, idx) => (
                    <div
                      key={doc.id}
                      className="group relative aspect-square rounded-xl overflow-hidden bg-gray-100"
                    >
                      <button
                        onClick={() => setLightboxIndex(idx)}
                        className="absolute inset-0 w-full h-full hover:opacity-90 transition-opacity"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={doc.fileUrl} alt={doc.name} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                          <p className="text-white text-xs truncate">{doc.name}</p>
                          <p className="text-white/70 text-xs">{doc.job.name}</p>
                          {doc.phase && (
                            <span className="inline-block mt-0.5 text-[10px] bg-white/20 text-white px-1.5 py-0.5 rounded-full">{doc.phase.name}</span>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteDoc(doc.id); }}
                        className="absolute top-1.5 right-1.5 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-black/50 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                        title="Delete photo"
                      >✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Documents Section */}
            {displayedDocs.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  📄 Documents
                  <span className="text-sm font-normal text-gray-500">({displayedDocs.length})</span>
                </h2>

                <div className="space-y-4">
                  {groupedDocs.map(({ phaseLabel, items }) => (
                    <div key={phaseLabel ?? "__all"}>
                      {/* Phase group header */}
                      {groupBy === "phase" && (
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-full">
                            {phaseLabel ?? "No Phase"}
                          </span>
                          <span className="text-xs text-gray-400">{items.length} file{items.length !== 1 ? "s" : ""}</span>
                        </div>
                      )}

                      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
                        {items.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center gap-2 hover:bg-gray-50 transition-colors"
                          >
                            <a
                              href={doc.fileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-4 p-4 flex-1 min-w-0"
                            >
                              <div className="w-10 h-10 flex items-center justify-center bg-blue-50 rounded-lg text-xl shrink-0">
                                {extIcon(doc.name)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-medium text-sm text-gray-900 truncate">{doc.name}</p>
                                  {doc.phase && groupBy === "none" && (
                                    <span className="inline-block text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                                      {doc.phase.name}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {doc.job.name}
                                  {" · "}
                                  {doc.uploadedBy.name}
                                  {" · "}
                                  {format(parseISO(doc.createdAt), "MMM d, yyyy")}
                                </p>
                              </div>
                              <span className="text-xs text-blue-600 shrink-0">Open ↗</span>
                            </a>
                            <button
                              onClick={() => deleteDoc(doc.id)}
                              className="shrink-0 mr-4 text-gray-300 hover:text-red-500 transition-colors p-1 rounded"
                              title="Delete file"
                            >✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Photo lightbox */}
      {lightboxIndex !== null && (
        <div
          ref={lightboxRef}
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Close */}
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 text-white text-2xl font-bold w-10 h-10 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 z-10"
          >✕</button>

          {/* Counter */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white text-sm font-medium bg-black/40 px-3 py-1 rounded-full z-10">
            {lightboxIndex + 1} / {displayedPhotos.length}
          </div>

          {/* Prev */}
          {displayedPhotos.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => i !== null ? (i - 1 + displayedPhotos.length) % displayedPhotos.length : null); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-3xl w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 z-10"
            >‹</button>
          )}

          {/* Image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayedPhotos[lightboxIndex].fileUrl}
            alt={displayedPhotos[lightboxIndex].name}
            onClick={(e) => e.stopPropagation()}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded shadow-2xl"
          />

          {/* Next */}
          {displayedPhotos.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => i !== null ? (i + 1) % displayedPhotos.length : null); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-3xl w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 z-10"
            >›</button>
          )}

          {/* Caption */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm bg-black/40 px-4 py-1.5 rounded-full max-w-xs truncate z-10">
            {displayedPhotos[lightboxIndex].name}
          </div>
        </div>
      )}
    </Layout>
  );
}
