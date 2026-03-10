"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Layout from "@/components/Layout";
import CopyJobModal from "@/components/CopyJobModal";
import Link from "next/link";
import { format, parseISO } from "date-fns";

type TabId = "overview" | "phases" | "schedule" | "files" | "messages" | "production";

interface Job {
  id: string;
  name: string;
  address: string;
  description: string | null;
  status: string;
  color: string;
  phases: Phase[];
  schedules: ScheduleEntry[];
  _count: { messages: number; documents: number };
}

interface Phase {
  id: string;
  name: string;
  description: string | null;
  orderIndex: number;
  startDate: string | null;
  endDate: string | null;
  dependsOnId: string | null;
}

interface ScheduleEntry {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  user: { id: string; name: string };
  supervisor: { id: string; name: string } | null;
  phase: { id: string; name: string } | null;
}

interface Message {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; role: string };
  phase: { id: string; name: string } | null;
}

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
}

interface ProductionLog {
  id: string;
  date: string;
  metricName: string;
  value: number;
  unit: string;
  notes: string | null;
  phase: { id: string; name: string } | null;
}

interface ProductionMetric {
  name: string;
  unit: string;
  total: number;
  count: number;
  average: number;
}

interface User {
  id: string;
  name: string;
  role: string;
}

interface CascadeModal {
  phaseId: string;
  phaseName: string;
  newStartDate: string;
  newEndDate: string;
  updatedPhases: Array<{ id: string; name: string; startDate: string | null; endDate: string | null }>;
  conflicts: Array<{ userName: string; date: string; jobName: string; phaseName: string }>;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "phases", label: "Phases" },
  { id: "schedule", label: "Schedule" },
  { id: "files", label: "Files" },
  { id: "messages", label: "Messages" },
  { id: "production", label: "Production" },
];

const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  COMPLETED: "bg-blue-100 text-blue-800",
  ARCHIVED: "bg-gray-100 text-gray-600",
};

export default function JobDetailPage() {
  const params = useParams();
  const { data: session } = useSession();
  const jobId = params.id as string;

  const [job, setJob] = useState<Job | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(true);
  const [copyModal, setCopyModal] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Overview editing
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState("");

  // Phases
  const [newPhaseName, setNewPhaseName] = useState("");
  const [newPhaseDesc, setNewPhaseDesc] = useState("");
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [phaseEditStart, setPhaseEditStart] = useState("");
  const [phaseEditEnd, setPhaseEditEnd] = useState("");
  const [phaseEditDependsOn, setPhaseEditDependsOn] = useState("");
  const [cascadeModal, setCascadeModal] = useState<CascadeModal | null>(null);
  const [savingPhase, setSavingPhase] = useState(false);

  // Schedule
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [schedUserId, setSchedUserId] = useState("");
  const [schedSupervisorId, setSchedSupervisorId] = useState("");
  const [schedPhaseId, setSchedPhaseId] = useState("");
  const [schedDate, setSchedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [schedStart, setSchedStart] = useState("07:00");
  const [schedEnd, setSchedEnd] = useState("15:00");
  const [schedNotes, setSchedNotes] = useState("");
  const [schedWarning, setSchedWarning] = useState("");
  const [schedError, setSchedError] = useState("");

  // Messages
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgContent, setMsgContent] = useState("");
  const [msgPhaseFilter, setMsgPhaseFilter] = useState("");

  // Files
  const [documents, setDocuments] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadPhaseId, setUploadPhaseId] = useState("");
  const [fileFilter, setFileFilter] = useState<"all" | "photos" | "documents">("all");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["__no_phase__"]));

  // Production
  const [prodLogs, setProdLogs] = useState<ProductionLog[]>([]);
  const [prodMetrics, setProdMetrics] = useState<ProductionMetric[]>([]);
  const [prodMetricName, setProdMetricName] = useState("");
  const [prodValue, setProdValue] = useState("");
  const [prodUnit, setProdUnit] = useState("");
  const [prodDate, setProdDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [prodPhaseId, setProdPhaseId] = useState("");
  const [prodNotes, setProdNotes] = useState("");

  const fetchJob = useCallback(async () => {
    const res = await fetch(`/api/jobs/${jobId}`);
    const data = await res.json();
    setJob(data);
    setLoading(false);
  }, [jobId]);

  const fetchSchedule = useCallback(async () => {
    const res = await fetch(`/api/schedule?jobId=${jobId}`);
    const data = await res.json();
    setScheduleEntries(data);
  }, [jobId]);

  const fetchMessages = useCallback(async () => {
    const url = msgPhaseFilter
      ? `/api/messages?jobId=${jobId}&phaseId=${msgPhaseFilter}`
      : `/api/messages?jobId=${jobId}`;
    const res = await fetch(url);
    const data = await res.json();
    setMessages(data);
  }, [jobId, msgPhaseFilter]);

  const fetchDocuments = useCallback(async () => {
    const res = await fetch(`/api/documents?jobId=${jobId}`);
    if (res.ok) {
      const data = await res.json();
      setDocuments(data);
    }
  }, [jobId]);

  const fetchProduction = useCallback(async () => {
    const res = await fetch(`/api/production?jobId=${jobId}`);
    const data = await res.json();
    setProdLogs(data.logs || []);
    setProdMetrics(data.metrics || []);
  }, [jobId]);

  const fetchUsers = useCallback(async () => {
    const res = await fetch("/api/people");
    const data = await res.json();
    setUsers(data);
    if (data.length > 0) setSchedUserId(data[0].id);
  }, []);

  useEffect(() => {
    fetchJob();
    fetchUsers();
  }, [fetchJob, fetchUsers]);

  useEffect(() => {
    if (activeTab === "schedule") fetchSchedule();
    if (activeTab === "messages") fetchMessages();
    if (activeTab === "files") fetchDocuments();
    if (activeTab === "production") fetchProduction();
  }, [activeTab, fetchSchedule, fetchMessages, fetchDocuments, fetchProduction]);

  useEffect(() => {
    if (activeTab === "messages") fetchMessages();
  }, [msgPhaseFilter, activeTab, fetchMessages]);

  const saveOverview = async () => {
    await fetch(`/api/jobs/${jobId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        address: editAddress,
        description: editDescription,
        status: editStatus,
      }),
    });
    setEditing(false);
    fetchJob();
  };

  const setJobStatus = async (status: string) => {
    setArchiving(true);
    await fetch(`/api/jobs/${jobId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setArchiving(false);
    fetchJob();
  };

  const addPhase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhaseName) return;
    await fetch(`/api/jobs/${jobId}/phases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newPhaseName, description: newPhaseDesc }),
    });
    setNewPhaseName("");
    setNewPhaseDesc("");
    fetchJob();
  };

  const deletePhase = async (phaseId: string) => {
    if (!confirm("Delete this phase?")) return;
    await fetch(`/api/jobs/${jobId}/phases?phaseId=${phaseId}`, { method: "DELETE" });
    fetchJob();
  };

  const movePhase = async (phase: Phase, direction: "up" | "down", phases: Phase[]) => {
    const idx = phases.indexOf(phase);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= phases.length) return;
    const swap = phases[swapIdx];

    await Promise.all([
      fetch(`/api/jobs/${jobId}/phases`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phaseId: phase.id, orderIndex: swap.orderIndex }),
      }),
      fetch(`/api/jobs/${jobId}/phases`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phaseId: swap.id, orderIndex: phase.orderIndex }),
      }),
    ]);
    fetchJob();
  };

  const startEditPhaseDates = (phase: Phase) => {
    setEditingPhaseId(phase.id);
    setPhaseEditStart(phase.startDate ? phase.startDate.split("T")[0] : "");
    setPhaseEditEnd(phase.endDate ? phase.endDate.split("T")[0] : "");
    setPhaseEditDependsOn(phase.dependsOnId || "");
  };

  const savePhaseDates = async (phase: Phase) => {
    setSavingPhase(true);
    try {
      // Preview the cascade first
      const res = await fetch(`/api/jobs/${jobId}/phases/${phase.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: phaseEditStart,
          endDate: phaseEditEnd,
          preview: true,
        }),
      });
      const data = await res.json();

      if (data.updatedPhases && data.updatedPhases.length > 0) {
        // Show confirmation modal
        setCascadeModal({
          phaseId: phase.id,
          phaseName: phase.name,
          newStartDate: phaseEditStart,
          newEndDate: phaseEditEnd,
          updatedPhases: data.updatedPhases,
          conflicts: data.conflicts || [],
        });
      } else {
        // No dependents — just save directly
        await commitPhaseDates(phase.id, phaseEditStart, phaseEditEnd);
        // Also update dependsOn
        await fetch(`/api/jobs/${jobId}/phases`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phaseId: phase.id, dependsOnId: phaseEditDependsOn }),
        });
        setEditingPhaseId(null);
        fetchJob();
      }
    } finally {
      setSavingPhase(false);
    }
  };

  const commitPhaseDates = async (phaseId: string, startDate: string, endDate: string) => {
    await fetch(`/api/jobs/${jobId}/phases/${phaseId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, preview: false }),
    });
  };

  const confirmCascade = async () => {
    if (!cascadeModal) return;
    setSavingPhase(true);
    await commitPhaseDates(cascadeModal.phaseId, cascadeModal.newStartDate, cascadeModal.newEndDate);
    // Also update dependsOn
    await fetch(`/api/jobs/${jobId}/phases`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phaseId: cascadeModal.phaseId, dependsOnId: phaseEditDependsOn }),
    });
    setCascadeModal(null);
    setEditingPhaseId(null);
    setSavingPhase(false);
    fetchJob();
  };

  const addScheduleEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setSchedWarning("");
    setSchedError("");

    const res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        phaseId: schedPhaseId || null,
        userId: schedUserId,
        supervisorId: schedSupervisorId || null,
        date: schedDate,
        startTime: schedStart,
        endTime: schedEnd,
        notes: schedNotes,
      }),
    });

    if (res.status === 409) {
      const data = await res.json();
      const c = data.conflict?.existingEntry;
      setSchedError(`Time conflict: already scheduled ${c?.startTime}–${c?.endTime} at ${c?.jobName}`);
      return;
    }

    const data = await res.json();
    if (data.warning) setSchedWarning(data.warning);
    fetchSchedule();
    setSchedNotes("");
  };

  const deleteEntry = async (id: string) => {
    await fetch(`/api/schedule/${id}`, { method: "DELETE" });
    fetchSchedule();
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgContent.trim()) return;
    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: msgContent, jobId, phaseId: msgPhaseFilter || null }),
    });
    setMsgContent("");
    fetchMessages();
  };

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("jobId", jobId);
    if (uploadPhaseId) form.append("phaseId", uploadPhaseId);
    await fetch("/api/upload", { method: "POST", body: form });
    setUploading(false);
    e.target.value = "";
    fetchDocuments();
  };

  const addProductionLog = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/production", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        phaseId: prodPhaseId || null,
        date: prodDate,
        metricName: prodMetricName,
        value: parseFloat(prodValue),
        unit: prodUnit,
        notes: prodNotes,
      }),
    });
    setProdMetricName("");
    setProdValue("");
    setProdUnit("");
    setProdNotes("");
    fetchProduction();
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loading || !job) {
    return (
      <Layout>
        <div className="p-6 text-gray-400">Loading...</div>
      </Layout>
    );
  }

  const phases = job.phases || [];
  const supervisorUsers = users.filter((u) => u.role === "ADMIN" || u.role === "EMPLOYEE");

  // Group documents by phase
  const docsByPhaseId: Record<string, Document[]> = {};
  const docsNoPhase: Document[] = [];
  documents.forEach((doc) => {
    if (doc.phaseId) {
      if (!docsByPhaseId[doc.phaseId]) docsByPhaseId[doc.phaseId] = [];
      docsByPhaseId[doc.phaseId].push(doc);
    } else {
      docsNoPhase.push(doc);
    }
  });

  const filteredDocs = (docs: Document[]) => {
    if (fileFilter === "photos") return docs.filter((d) => d.fileCategory === "photo");
    if (fileFilter === "documents") return docs.filter((d) => d.fileCategory === "document");
    return docs;
  };

  const renderDocGroup = (docs: Document[], sectionKey: string, label: string) => {
    const filtered = filteredDocs(docs);
    if (filtered.length === 0 && fileFilter !== "all") return null;
    const isExpanded = expandedSections.has(sectionKey);
    const photos = filtered.filter((d) => d.fileCategory === "photo");
    const docFiles = filtered.filter((d) => d.fileCategory === "document");

    return (
      <div key={sectionKey} className="bg-white rounded-xl shadow-sm overflow-hidden">
        <button
          onClick={() => toggleSection(sectionKey)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 text-sm">{label}</span>
            <span className="text-xs text-gray-400">({docs.length} files)</span>
          </div>
          <span className="text-gray-400 text-sm">{isExpanded ? "▲" : "▼"}</span>
        </button>

        {isExpanded && (
          <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
            {/* Photos sub-section */}
            {(fileFilter === "all" || fileFilter === "photos") && photos.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  📷 Photos ({photos.length})
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {photos.map((doc) => (
                    <a
                      key={doc.id}
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="aspect-square rounded-lg overflow-hidden bg-gray-100 hover:opacity-90 transition-opacity"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={doc.fileUrl} alt={doc.name} className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Documents sub-section */}
            {(fileFilter === "all" || fileFilter === "documents") && docFiles.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  📄 Documents ({docFiles.length})
                </p>
                <div className="space-y-2">
                  {docFiles.map((doc) => (
                    <a
                      key={doc.id}
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="w-8 h-8 flex items-center justify-center bg-blue-50 rounded text-lg shrink-0">
                        📄
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-xs text-gray-900 truncate">{doc.name}</p>
                        <p className="text-xs text-gray-400">
                          {doc.uploadedBy.name} · {format(parseISO(doc.createdAt), "MMM d")}
                        </p>
                      </div>
                      <span className="text-xs text-blue-600 shrink-0">↗</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {filtered.length === 0 && (
              <p className="text-gray-400 text-sm">No files in this section</p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
              <Link href="/jobs" className="hover:text-gray-600">Jobs</Link>
              <span>/</span>
              <span className="text-gray-700">{job.name}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: job.color }} />
              <h1 className="text-2xl font-bold text-gray-900">{job.name}</h1>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[job.status] || statusColors.ACTIVE}`}>
                {job.status}
              </span>
            </div>
            <p className="text-gray-500 text-sm mt-1">{job.address}</p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/jobs/${jobId}/gantt`}
              className="bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              📊 Gantt View
            </Link>
            <button
              onClick={() => setCopyModal(true)}
              className="border border-gray-300 text-gray-700 py-2 px-4 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Copy Job
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeTab === "overview" && (
          <div className="bg-white rounded-xl shadow-sm p-6">
            {!editing ? (
              <>
                <div className="flex justify-between items-start mb-4">
                  <h2 className="font-semibold text-gray-900">Job Details</h2>
                  <div className="flex items-center gap-3">
                    {session?.user?.role === "ADMIN" && job.status !== "ARCHIVED" && (
                      <button
                        onClick={() => {
                          if (confirm("Archive this job? It will be hidden from schedules.")) {
                            setJobStatus("ARCHIVED");
                          }
                        }}
                        disabled={archiving}
                        className="text-sm text-gray-500 hover:text-gray-700 border border-gray-300 px-3 py-1 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                      >
                        {archiving ? "Archiving…" : "Archive Job"}
                      </button>
                    )}
                    {session?.user?.role === "ADMIN" && job.status === "ARCHIVED" && (
                      <button
                        onClick={() => setJobStatus("ACTIVE")}
                        disabled={archiving}
                        className="text-sm text-green-600 hover:text-green-800 border border-green-300 px-3 py-1 rounded-lg hover:bg-green-50 disabled:opacity-50"
                      >
                        {archiving ? "Restoring…" : "Restore Job"}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditing(true);
                        setEditName(job.name);
                        setEditAddress(job.address);
                        setEditDescription(job.description || "");
                        setEditStatus(job.status);
                      }}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Edit
                    </button>
                  </div>
                </div>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-xs text-gray-400 uppercase tracking-wide">Name</dt>
                    <dd className="text-gray-900">{job.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-400 uppercase tracking-wide">Address</dt>
                    <dd className="text-gray-900">{job.address}</dd>
                  </div>
                  {job.description && (
                    <div>
                      <dt className="text-xs text-gray-400 uppercase tracking-wide">Description</dt>
                      <dd className="text-gray-700">{job.description}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-gray-400 uppercase tracking-wide">Status</dt>
                    <dd>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[job.status]}`}>
                        {job.status}
                      </span>
                    </dd>
                  </div>
                  <div className="grid grid-cols-3 gap-4 pt-2">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-gray-900">{phases.length}</p>
                      <p className="text-xs text-gray-500">Phases</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-gray-900">{job._count.messages}</p>
                      <p className="text-xs text-gray-500">Messages</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-gray-900">{job._count.documents}</p>
                      <p className="text-xs text-gray-500">Files</p>
                    </div>
                  </div>
                </dl>
              </>
            ) : (
              <div>
                <h2 className="font-semibold text-gray-900 mb-4">Edit Job</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                    <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                    <input type="text" value={editAddress} onChange={(e) => setEditAddress(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="COMPLETED">COMPLETED</option>
                      <option value="ARCHIVED">ARCHIVED</option>
                    </select>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setEditing(false)} className="border border-gray-300 text-gray-700 py-2 px-4 rounded-lg text-sm hover:bg-gray-50">
                      Cancel
                    </button>
                    <button onClick={saveOverview} className="bg-blue-600 text-white py-2 px-4 rounded-lg text-sm hover:bg-blue-700">
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Phases */}
        {activeTab === "phases" && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Phases</h2>
              {phases.length === 0 ? (
                <p className="text-gray-400 text-sm">No phases yet</p>
              ) : (
                <div className="space-y-3">
                  {phases.map((phase, idx) => (
                    <div key={phase.id} className="border border-gray-200 rounded-xl overflow-hidden">
                      {/* Phase header */}
                      <div className="flex items-center gap-3 p-3 bg-gray-50">
                        <div className="flex flex-col gap-0.5">
                          <button onClick={() => movePhase(phase, "up", phases)} disabled={idx === 0}
                            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 leading-none">▲</button>
                          <button onClick={() => movePhase(phase, "down", phases)} disabled={idx === phases.length - 1}
                            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 leading-none">▼</button>
                        </div>
                        <span className="text-xs text-gray-400 w-5 text-center">{idx + 1}</span>
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 text-sm">{phase.name}</p>
                          {phase.description && <p className="text-xs text-gray-500">{phase.description}</p>}
                          {(phase.startDate || phase.endDate) && (
                            <p className="text-xs text-blue-600 mt-0.5">
                              {phase.startDate ? format(parseISO(phase.startDate), "MMM d") : "?"}
                              {" → "}
                              {phase.endDate ? format(parseISO(phase.endDate), "MMM d, yyyy") : "?"}
                            </p>
                          )}
                          {phase.dependsOnId && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              depends on: {phases.find((p) => p.id === phase.dependsOnId)?.name || "—"}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => editingPhaseId === phase.id ? setEditingPhaseId(null) : startEditPhaseDates(phase)}
                            className="text-sm text-blue-600 hover:text-blue-800"
                          >
                            {editingPhaseId === phase.id ? "Cancel" : "Edit Dates"}
                          </button>
                          <button onClick={() => deletePhase(phase.id)} className="text-red-400 hover:text-red-600 text-sm">
                            Delete
                          </button>
                        </div>
                      </div>

                      {/* Phase date editor */}
                      {editingPhaseId === phase.id && (
                        <div className="p-4 border-t border-gray-200 bg-white">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                              <input
                                type="date"
                                value={phaseEditStart}
                                onChange={(e) => setPhaseEditStart(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                              <input
                                type="date"
                                value={phaseEditEnd}
                                onChange={(e) => setPhaseEditEnd(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-xs font-medium text-gray-600 mb-1">Depends On (phase that must finish first)</label>
                              <select
                                value={phaseEditDependsOn}
                                onChange={(e) => setPhaseEditDependsOn(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">— No dependency —</option>
                                {phases.filter((p) => p.id !== phase.id).map((p) => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="sm:col-span-2">
                              <button
                                onClick={() => savePhaseDates(phase)}
                                disabled={savingPhase || !phaseEditStart || !phaseEditEnd}
                                className="bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                              >
                                {savingPhase ? "Saving..." : "Save Dates"}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Add Phase</h3>
              <form onSubmit={addPhase} className="space-y-3">
                <input type="text" value={newPhaseName} onChange={(e) => setNewPhaseName(e.target.value)}
                  placeholder="Phase name" required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="text" value={newPhaseDesc} onChange={(e) => setNewPhaseDesc(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button type="submit" className="bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700">
                  Add Phase
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Schedule */}
        {activeTab === "schedule" && (
          <div className="space-y-4">
            {schedWarning && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
                ⚠️ {schedWarning}
              </div>
            )}
            {schedError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                ❌ {schedError}
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Add Schedule Entry</h3>
              <form onSubmit={addScheduleEntry} className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Worker (assigned person)</label>
                  <select value={schedUserId} onChange={(e) => setSchedUserId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Supervisor (optional)</label>
                  <select value={schedSupervisorId} onChange={(e) => setSchedSupervisorId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— No supervisor —</option>
                    {supervisorUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phase</label>
                  <select value={schedPhaseId} onChange={(e) => setSchedPhaseId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— No phase —</option>
                    {phases.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                  <input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
                    <input type="time" value={schedStart} onChange={(e) => setSchedStart(e.target.value)} required
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
                    <input type="time" value={schedEnd} onChange={(e) => setSchedEnd(e.target.value)} required
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
                  <input type="text" value={schedNotes} onChange={(e) => setSchedNotes(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="sm:col-span-2">
                  <button type="submit" className="bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700">
                    Add Entry
                  </button>
                </div>
              </form>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Schedule Entries</h3>
              {scheduleEntries.length === 0 ? (
                <p className="text-gray-400 text-sm">No schedule entries yet</p>
              ) : (
                <div className="space-y-2">
                  {scheduleEntries.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-sm text-gray-900">{entry.user.name}</p>
                        {entry.supervisor && (
                          <p className="text-xs text-blue-600">Supervisor: {entry.supervisor.name}</p>
                        )}
                        <p className="text-xs text-gray-500">
                          {format(parseISO(entry.date), "EEE, MMM d")} · {entry.startTime}–{entry.endTime}
                          {entry.phase && ` · ${entry.phase.name}`}
                        </p>
                        {entry.notes && <p className="text-xs text-gray-400 mt-0.5">{entry.notes}</p>}
                      </div>
                      <button onClick={() => deleteEntry(entry.id)} className="text-red-400 hover:text-red-600 text-sm ml-4">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Files */}
        {activeTab === "files" && (
          <div className="space-y-4">
            {/* Upload */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Upload File</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phase (optional)</label>
                  <select
                    value={uploadPhaseId}
                    onChange={(e) => setUploadPhaseId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— No phase —</option>
                    {phases.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl p-8 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                  <span className="text-3xl mb-2">📎</span>
                  <span className="text-sm text-gray-500">{uploading ? "Uploading..." : "Click to upload a file"}</span>
                  <span className="text-xs text-gray-400 mt-1">Images auto-categorized as photos</span>
                  <input type="file" className="hidden" onChange={uploadFile} disabled={uploading} />
                </label>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="flex bg-gray-100 rounded-lg p-1 w-fit">
              {(["all", "photos", "documents"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFileFilter(f)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                    fileFilter === f ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {f === "all" ? "All" : f === "photos" ? "📷 Photos" : "📄 Documents"}
                </button>
              ))}
            </div>

            {/* Files grouped by phase */}
            {documents.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm p-6 text-center text-gray-400 text-sm">
                No files uploaded yet
              </div>
            ) : (
              <div className="space-y-3">
                {/* No-phase section */}
                {docsNoPhase.length > 0 && renderDocGroup(docsNoPhase, "__no_phase__", "📁 No Phase")}

                {/* Per-phase sections */}
                {phases.map((phase) => {
                  const phaseDocs = docsByPhaseId[phase.id] || [];
                  if (phaseDocs.length === 0) return null;
                  return renderDocGroup(phaseDocs, phase.id, `📁 ${phase.name}`);
                })}
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        {activeTab === "messages" && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm p-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Filter by phase</label>
              <select value={msgPhaseFilter} onChange={(e) => setMsgPhaseFilter(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">All phases</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 min-h-64">
              {messages.length === 0 ? (
                <p className="text-gray-400 text-sm">No messages yet</p>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`flex gap-3 ${msg.author.id === session?.user.id ? "flex-row-reverse" : ""}`}>
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 shrink-0">
                        {msg.author.name[0]}
                      </div>
                      <div className={`max-w-xs ${msg.author.id === session?.user.id ? "items-end" : ""} flex flex-col`}>
                        <div className={`rounded-xl px-4 py-2.5 text-sm ${
                          msg.author.id === session?.user.id
                            ? "bg-blue-600 text-white rounded-tr-sm"
                            : "bg-gray-100 text-gray-900 rounded-tl-sm"
                        }`}>
                          {msg.content}
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {msg.author.name}
                          {msg.phase && ` · ${msg.phase.name}`}
                          {" · "}{format(parseISO(msg.createdAt), "MMM d, h:mm a")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm p-4">
              <form onSubmit={sendMessage} className="flex gap-3">
                <input
                  type="text"
                  value={msgContent}
                  onChange={(e) => setMsgContent(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button type="submit" className="bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700">
                  Send
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Production */}
        {activeTab === "production" && (
          <div className="space-y-4">
            {prodMetrics.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {prodMetrics.map((metric) => (
                  <div key={metric.name} className="bg-white rounded-xl shadow-sm p-4">
                    <p className="text-xs text-gray-500 mb-1">{metric.name}</p>
                    <p className="text-2xl font-bold text-gray-900">{metric.total.toLocaleString()} <span className="text-sm font-normal text-gray-500">{metric.unit}</span></p>
                    <p className="text-xs text-gray-400 mt-1">avg {metric.average.toFixed(1)} per entry · {metric.count} entries</p>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Log Production</h3>
              <form onSubmit={addProductionLog} className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Metric</label>
                  <input type="text" value={prodMetricName} onChange={(e) => setProdMetricName(e.target.value)}
                    placeholder="Linear ft of pipe installed" required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Value</label>
                    <input type="number" step="any" value={prodValue} onChange={(e) => setProdValue(e.target.value)} required
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
                    <input type="text" value={prodUnit} onChange={(e) => setProdUnit(e.target.value)} placeholder="linear ft" required
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                  <input type="date" value={prodDate} onChange={(e) => setProdDate(e.target.value)} required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phase</label>
                  <select value={prodPhaseId} onChange={(e) => setProdPhaseId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— No phase —</option>
                    {phases.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
                  <input type="text" value={prodNotes} onChange={(e) => setProdNotes(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="sm:col-span-2">
                  <button type="submit" className="bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700">
                    Log Entry
                  </button>
                </div>
              </form>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Production History</h3>
              {prodLogs.length === 0 ? (
                <p className="text-gray-400 text-sm">No logs yet</p>
              ) : (
                <div className="space-y-2">
                  {prodLogs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-sm text-gray-900">{log.metricName}</p>
                        <p className="text-xs text-gray-500">
                          {format(parseISO(log.date), "MMM d, yyyy")}
                          {log.phase && ` · ${log.phase.name}`}
                        </p>
                        {log.notes && <p className="text-xs text-gray-400">{log.notes}</p>}
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-gray-900">{log.value.toLocaleString()}</p>
                        <p className="text-xs text-gray-500">{log.unit}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Cascade Confirmation Modal */}
      {cascadeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">⚠️ Cascade Phase Dates</h3>
            <p className="text-sm text-gray-600 mb-4">
              Moving <strong>{cascadeModal.phaseName}</strong> will shift{" "}
              <strong>{cascadeModal.updatedPhases.length}</strong> dependent phase(s).
            </p>

            {/* Affected phases */}
            <div className="mb-4 space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Phases that will shift:</p>
              {cascadeModal.updatedPhases.map((p) => (
                <div key={p.id} className="text-sm text-gray-700 bg-blue-50 rounded px-3 py-1.5">
                  <span className="font-medium">{p.name}</span>
                  {p.startDate && p.endDate && (
                    <span className="text-xs text-blue-600 ml-2">
                      → {format(parseISO(p.startDate as string), "MMM d")} – {format(parseISO(p.endDate as string), "MMM d, yyyy")}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Conflicts */}
            {cascadeModal.conflicts.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">
                  ⚠️ Scheduling Conflicts Found:
                </p>
                {cascadeModal.conflicts.map((c, i) => (
                  <div key={i} className="text-sm text-red-700 bg-red-50 rounded px-3 py-1.5 mb-1">
                    {c.userName} on {c.date} is also booked at {c.jobName} ({c.phaseName})
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setCascadeModal(null)}
                className="flex-1 border border-gray-300 text-gray-700 py-2 px-4 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmCascade}
                disabled={savingPhase}
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {savingPhase ? "Saving..." : "Confirm & Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <CopyJobModal
        isOpen={copyModal}
        sourceJobId={jobId}
        sourceJobName={job.name}
        onClose={() => setCopyModal(false)}
      />
    </Layout>
  );
}
