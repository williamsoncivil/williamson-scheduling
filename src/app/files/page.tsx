"use client";

import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { format, parseISO } from "date-fns";

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

type CategoryFilter = "all" | "photo" | "document";
type GroupBy = "none" | "phase";

export default function FilesPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filterJob, setFilterJob] = useState("");
  const [filterCategory, setFilterCategory] = useState<CategoryFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((d) => setJobs(d));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterJob) params.set("jobId", filterJob);
    if (filterCategory !== "all") params.set("fileCategory", filterCategory);
    fetch(`/api/documents?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setDocuments(d);
        setLoading(false);
      });
  }, [filterJob, filterCategory]);

  const photos = documents.filter((d) => d.fileCategory === "photo");
  const docs = documents.filter((d) => d.fileCategory === "document");

  const displayedPhotos = filterCategory === "document" ? [] : photos;
  const displayedDocs = filterCategory === "photo" ? [] : docs;

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
    const entries = [...map.entries()].sort(([a], [b]) => {
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
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Files</h1>
          <p className="text-gray-500 text-sm mt-0.5">All uploaded documents and photos</p>
        </div>

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
                  {displayedPhotos.map((doc) => (
                    <a
                      key={doc.id}
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="group relative aspect-square rounded-xl overflow-hidden bg-gray-100 hover:opacity-90 transition-opacity"
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
                    </a>
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
                          <a
                            key={doc.id}
                            href={doc.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors"
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
    </Layout>
  );
}
