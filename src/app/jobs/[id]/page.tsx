"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { upload } from "@vercel/blob/client";
import Layout from "@/components/Layout";
import CopyJobModal from "@/components/CopyJobModal";
import Link from "next/link";
import { format, parseISO, addDays } from "date-fns";

const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 28, 30, 45, 60, 90];

// ── Business-day helpers (client-side, local time) ───────────────────────────

function isWeekendLocal(date: Date): boolean {
  const dow = date.getDay();
  return dow === 0 || dow === 6;
}

/** Advance date to the next weekday (local time). */
function snapToWeekday(date: Date): Date {
  let d = new Date(date);
  while (isWeekendLocal(d)) d = addDays(d, 1);
  return d;
}

/**
 * Calculate end date given a start and a number of *business* days.
 * Day 1 = start day itself (if a weekday). Weekends are skipped over.
 */
function endFromDuration(start: string, days: number): string {
  try {
    let d = snapToWeekday(parseISO(start));
    let remaining = days - 1;
    while (remaining > 0) {
      d = addDays(d, 1);
      if (!isWeekendLocal(d)) remaining--;
    }
    return format(d, "yyyy-MM-dd");
  } catch { return ""; }
}

/** Count business days between two date strings (inclusive). */
function durationFromDates(start: string, end: string): number | null {
  try {
    const endDate = parseISO(end);
    let d = parseISO(start);
    if (endDate < d) return null;
    let count = 0;
    while (d <= endDate) {
      if (!isWeekendLocal(d)) count++;
      d = addDays(d, 1);
    }
    return count > 0 ? count : null;
  } catch { return null; }
}

/**
 * Return the next business day AFTER the given date string
 * (used to auto-fill start date from a predecessor's end date).
 */
function nextBusinessDayAfter(dateStr: string): string {
  try {
    let d = addDays(parseISO(dateStr), 1);
    while (isWeekendLocal(d)) d = addDays(d, 1);
    return format(d, "yyyy-MM-dd");
  } catch { return ""; }
}

/**
 * Given a predecessor phase, dep type, and lag, compute new start + end dates
 * for the successor, preserving its current business-day duration.
 */
function computeDatesFromPredecessor(
  predPhase: { startDate?: string | null; endDate?: string | null },
  type: "FINISH_TO_START" | "START_TO_START" | "FINISH_TO_FINISH" | "START_TO_FINISH",
  lagDays: number,
  currentDuration: number
): { startDate: string; endDate: string } | null {
  const predStart = predPhase.startDate?.split("T")[0] ?? "";
  const predEnd = predPhase.endDate?.split("T")[0] ?? "";

  let newStart = "";
  let newEnd = "";

  switch (type) {
    case "FINISH_TO_START": {
      if (!predEnd) return null;
      // Start = next business day after (predEnd + lagDays calendar days)
      let d = addDays(parseISO(predEnd), lagDays + 1);
      while (isWeekendLocal(d)) d = addDays(d, 1);
      newStart = format(d, "yyyy-MM-dd");
      newEnd = endFromDuration(newStart, currentDuration);
      break;
    }
    case "START_TO_START": {
      if (!predStart) return null;
      let d = addDays(parseISO(predStart), lagDays);
      while (isWeekendLocal(d)) d = addDays(d, 1);
      newStart = format(d, "yyyy-MM-dd");
      newEnd = endFromDuration(newStart, currentDuration);
      break;
    }
    case "FINISH_TO_FINISH": {
      if (!predEnd) return null;
      let d = addDays(parseISO(predEnd), lagDays);
      while (isWeekendLocal(d)) d = addDays(d, 1);
      newEnd = format(d, "yyyy-MM-dd");
      // Walk backward to find start
      let start = parseISO(newEnd);
      let remaining = currentDuration - 1;
      while (remaining > 0) {
        start = addDays(start, -1);
        if (!isWeekendLocal(start)) remaining--;
      }
      while (isWeekendLocal(start)) start = addDays(start, -1);
      newStart = format(start, "yyyy-MM-dd");
      break;
    }
    case "START_TO_FINISH": {
      if (!predStart) return null;
      let d = addDays(parseISO(predStart), lagDays);
      while (isWeekendLocal(d)) d = addDays(d, 1);
      newEnd = format(d, "yyyy-MM-dd");
      let start = parseISO(newEnd);
      let remaining = currentDuration - 1;
      while (remaining > 0) {
        start = addDays(start, -1);
        if (!isWeekendLocal(start)) remaining--;
      }
      while (isWeekendLocal(start)) start = addDays(start, -1);
      newStart = format(start, "yyyy-MM-dd");
      break;
    }
  }

  return newStart && newEnd ? { startDate: newStart, endDate: newEnd } : null;
}

// ─────────────────────────────────────────────────────────────────────────────

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

interface PhaseDependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: "FINISH_TO_START" | "START_TO_START" | "FINISH_TO_FINISH" | "START_TO_FINISH";
  lagDays: number;
  predecessor?: { id: string; name: string; startDate: string | null; endDate: string | null };
  successor?: { id: string; name: string };
}

interface Phase {
  id: string;
  name: string;
  description: string | null;
  orderIndex: number;
  startDate: string | null;
  endDate: string | null;
  dependsOnId: string | null;
  predecessorDeps?: PhaseDependency[];
  successorDeps?: PhaseDependency[];
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
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Overview editing
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState("");

  // Phases
  const [newPhaseName, setNewPhaseName] = useState("");
  const [newPhaseDesc, setNewPhaseDesc] = useState("");
  const [newPhaseStart, setNewPhaseStart] = useState("");
  const [newPhaseDuration, setNewPhaseDuration] = useState<number | "">(7);
  const [newPhasePredecessorId, setNewPhasePredecessorId] = useState("");
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [phaseEditStart, setPhaseEditStart] = useState("");
  const [phaseEditEnd, setPhaseEditEnd] = useState("");
  const [phaseEditDuration, setPhaseEditDuration] = useState<number | "">("");
  const [phaseEditDependsOn, setPhaseEditDependsOn] = useState("");
  const [cascadeModal, setCascadeModal] = useState<CascadeModal | null>(null);
  const [savingPhase, setSavingPhase] = useState(false);

  // Dependency management
  const [phaseDeps, setPhaseDeps] = useState<Record<string, { predecessorDeps: PhaseDependency[]; successorDeps: PhaseDependency[] }>>({});
  const [addDepModal, setAddDepModal] = useState<{ phaseId: string; phaseName: string } | null>(null);
  const [depPredecessorId, setDepPredecessorId] = useState("");
  const [depType, setDepType] = useState<"FINISH_TO_START" | "START_TO_START" | "FINISH_TO_FINISH" | "START_TO_FINISH">("FINISH_TO_START");
  const [depLagDays, setDepLagDays] = useState(0);
  const [savingDep, setSavingDep] = useState(false);
  // Edit existing predecessor
  const [editDepModal, setEditDepModal] = useState<{
    phaseId: string;
    phaseName: string;
    predecessorId: string;
    predecessorName: string;
  } | null>(null);
  const [editDepType, setEditDepType] = useState<"FINISH_TO_START" | "START_TO_START" | "FINISH_TO_FINISH" | "START_TO_FINISH">("FINISH_TO_START");
  const [editDepLagDays, setEditDepLagDays] = useState(0);
  const [editDepNewPredecessorId, setEditDepNewPredecessorId] = useState("");
  const [savingEditDep, setSavingEditDep] = useState(false);

  // Cascade toast
  const [cascadeToast, setCascadeToast] = useState<{ count: number; phases: Array<{ name: string; startDate: string | null; endDate: string | null }> } | null>(null);

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

  // Phase people assignment (from Phases tab)
  const [phaseAssignModal, setPhaseAssignModal] = useState<{
    phaseId: string; phaseName: string; phaseStart: string | null; phaseEnd: string | null;
  } | null>(null);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignStartDate, setAssignStartDate] = useState("");
  const [assignEndDate, setAssignEndDate] = useState("");
  const [assignStartTime, setAssignStartTime] = useState("07:00");
  const [assignEndTime, setAssignEndTime] = useState("17:00");
  const [assignWorkDays, setAssignWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [savingAssign, setSavingAssign] = useState(false);

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
    // Fetch dependencies for all phases
    if (data.phases?.length) {
      const depsMap: Record<string, { predecessorDeps: PhaseDependency[]; successorDeps: PhaseDependency[] }> = {};
      await Promise.all(
        data.phases.map(async (phase: Phase) => {
          const r = await fetch(`/api/phases/${phase.id}/dependencies`);
          if (r.ok) depsMap[phase.id] = await r.json();
        })
      );
      setPhaseDeps(depsMap);
    }
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
    fetchSchedule();
  }, [fetchJob, fetchUsers, fetchSchedule]);

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

  const deleteJob = async () => {
    setDeleting(true);
    const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    if (res.ok) {
      window.location.href = "/jobs";
    } else {
      setDeleting(false);
      setDeleteConfirm(false);
      alert("Failed to delete job.");
    }
  };

  const addPhase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhaseName) return;
    const startDate = newPhaseStart || null;
    const endDate = (startDate && newPhaseDuration) ? endFromDuration(startDate, Number(newPhaseDuration)) : null;
    const res = await fetch(`/api/jobs/${jobId}/phases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newPhaseName, description: newPhaseDesc, startDate, endDate }),
    });
    if (res.ok && newPhasePredecessorId) {
      const created = await res.json();
      // Auto-create a FINISH_TO_START dependency with the selected predecessor
      await fetch(`/api/phases/${created.id}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ predecessorId: newPhasePredecessorId, type: "FINISH_TO_START", lagDays: 0 }),
      });
    }
    setNewPhaseName("");
    setNewPhaseDesc("");
    setNewPhaseStart("");
    setNewPhaseDuration(7);
    setNewPhasePredecessorId("");
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
    const start = phase.startDate ? phase.startDate.split("T")[0] : "";
    const end = phase.endDate ? phase.endDate.split("T")[0] : "";
    setPhaseEditStart(start);
    setPhaseEditEnd(end);
    setPhaseEditDuration(durationFromDates(start, end) ?? "");
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
    // Use both the old move endpoint (for old dependsOnId cascade) and new PATCH endpoint (for PhaseDependency cascade)
    await fetch(`/api/jobs/${jobId}/phases/${phaseId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, preview: false }),
    });
    // Also trigger new cascade system
    const res = await fetch(`/api/phases/${phaseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.cascadedPhases?.length > 0) {
        setCascadeToast({ count: data.cascadedPhases.length, phases: data.cascadedPhases });
        setTimeout(() => setCascadeToast(null), 7000);
      }
    }
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

  const openAddDepModal = (phase: Phase) => {
    setAddDepModal({ phaseId: phase.id, phaseName: phase.name });
    setDepPredecessorId("");
    setDepType("FINISH_TO_START");
    setDepLagDays(0);
  };

  const saveNewDependency = async () => {
    if (!addDepModal || !depPredecessorId) return;
    setSavingDep(true);
    try {
      const res = await fetch(`/api/phases/${addDepModal.phaseId}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ predecessorId: depPredecessorId, type: depType, lagDays: depLagDays }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to add dependency");
        return;
      }
      // Auto-apply dates from predecessor
      const predPhase = phases.find((p) => p.id === depPredecessorId);
      const thisPhase = phases.find((p) => p.id === addDepModal.phaseId);
      if (predPhase && thisPhase) {
        const currentStart = thisPhase.startDate?.split("T")[0] ?? "";
        const currentEnd = thisPhase.endDate?.split("T")[0] ?? "";
        const duration = (currentStart && currentEnd) ? (durationFromDates(currentStart, currentEnd) ?? 5) : 5;
        const newDates = computeDatesFromPredecessor(predPhase, depType, depLagDays, duration);
        if (newDates) {
          await fetch(`/api/phases/${addDepModal.phaseId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startDate: newDates.startDate, endDate: newDates.endDate }),
          });
        }
      }
      setAddDepModal(null);
      fetchJob();
    } finally {
      setSavingDep(false);
    }
  };

  const openEditDepModal = (phase: Phase, dep: PhaseDependency) => {
    setEditDepModal({
      phaseId: phase.id,
      phaseName: phase.name,
      predecessorId: dep.predecessorId,
      predecessorName: dep.predecessor?.name ?? dep.predecessorId,
    });
    setEditDepType(dep.type);
    setEditDepLagDays(dep.lagDays);
    setEditDepNewPredecessorId(dep.predecessorId);
  };

  const saveEditDependency = async () => {
    if (!editDepModal) return;
    setSavingEditDep(true);
    try {
      const predecessorChanged = editDepNewPredecessorId !== editDepModal.predecessorId;

      // If predecessor changed, delete the old dependency first
      if (predecessorChanged && editDepModal.predecessorId) {
        await fetch(`/api/phases/${editDepModal.phaseId}/dependencies?predecessorId=${editDepModal.predecessorId}`, {
          method: "DELETE",
        });
      }

      // Create/upsert with the (possibly new) predecessorId
      const res = await fetch(`/api/phases/${editDepModal.phaseId}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          predecessorId: editDepNewPredecessorId,
          type: editDepType,
          lagDays: editDepLagDays,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to update dependency");
        return;
      }

      // Auto-apply dates from the (possibly new) predecessor
      const predPhase = phases.find((p) => p.id === editDepNewPredecessorId);
      const thisPhase = phases.find((p) => p.id === editDepModal.phaseId);
      if (predPhase && thisPhase) {
        const currentStart = thisPhase.startDate?.split("T")[0] ?? "";
        const currentEnd = thisPhase.endDate?.split("T")[0] ?? "";
        const duration = (currentStart && currentEnd) ? (durationFromDates(currentStart, currentEnd) ?? 5) : 5;
        const newDates = computeDatesFromPredecessor(predPhase, editDepType, editDepLagDays, duration);
        if (newDates) {
          await fetch(`/api/phases/${editDepModal.phaseId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startDate: newDates.startDate, endDate: newDates.endDate }),
          });
        }
      }

      setEditDepModal(null);
      fetchJob();
    } finally {
      setSavingEditDep(false);
    }
  };

  const removeDependency = async (phaseId: string, predecessorId: string) => {
    if (!confirm("Remove this dependency?")) return;
    await fetch(`/api/phases/${phaseId}/dependencies?predecessorId=${predecessorId}`, {
      method: "DELETE",
    });
    fetchJob();
  };

  const depTypeLabel = (type: PhaseDependency["type"]) => {
    switch (type) {
      case "FINISH_TO_START": return "Finish → Start";
      case "START_TO_START": return "Start → Start";
      case "FINISH_TO_FINISH": return "Finish → Finish";
      case "START_TO_FINISH": return "Start → Finish";
    }
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

  // ── Phase people assignment helpers ────────────────────────────────────────

  /** Group schedule entries for a phase by user, return summary rows. */
  const getPhaseAssignments = (phaseId: string) => {
    const phaseEntries = scheduleEntries.filter((e) => e.phase?.id === phaseId);
    const byUser: Record<string, { user: { id: string; name: string; role?: string }; dates: string[] }> = {};
    for (const entry of phaseEntries) {
      if (!byUser[entry.user.id]) byUser[entry.user.id] = { user: entry.user, dates: [] };
      byUser[entry.user.id].dates.push(entry.date.split("T")[0]);
    }
    return Object.values(byUser).map(({ user, dates }) => {
      const sorted = [...dates].sort();
      return { user, startDate: sorted[0], endDate: sorted[sorted.length - 1], count: sorted.length };
    });
  };

  const openAssignModal = (phase: Phase) => {
    setPhaseAssignModal({ phaseId: phase.id, phaseName: phase.name, phaseStart: phase.startDate, phaseEnd: phase.endDate });
    setAssignUserId("");
    setAssignStartDate(phase.startDate?.split("T")[0] ?? "");
    setAssignEndDate(phase.endDate?.split("T")[0] ?? "");
    setAssignStartTime("07:00");
    setAssignEndTime("17:00");
    setAssignWorkDays([1, 2, 3, 4, 5]);
  };

  const toggleAssignWorkDay = (day: number) => {
    setAssignWorkDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const unassignPersonFromPhase = async (phaseId: string, userId: string) => {
    if (!confirm("Remove this person from the phase?")) return;
    const toDelete = scheduleEntries.filter((e) => e.phase?.id === phaseId && e.user.id === userId);
    await Promise.all(toDelete.map((e) => fetch(`/api/schedule/${e.id}`, { method: "DELETE" })));
    fetchSchedule();
  };

  const assignPersonToPhase = async () => {
    if (!phaseAssignModal || !assignUserId || !assignStartDate || !assignEndDate) return;
    setSavingAssign(true);
    try {
      const dates: string[] = [];
      let d = parseISO(assignStartDate);
      const endD = parseISO(assignEndDate);
      while (d <= endD) {
        if (assignWorkDays.includes(d.getDay())) dates.push(format(d, "yyyy-MM-dd"));
        d = addDays(d, 1);
      }
      // Skip days already assigned
      const alreadyAssigned = new Set(
        scheduleEntries
          .filter((e) => e.phase?.id === phaseAssignModal.phaseId && e.user.id === assignUserId)
          .map((e) => e.date.split("T")[0])
      );
      const newDates = dates.filter((dt) => !alreadyAssigned.has(dt));
      for (const date of newDates) {
        await fetch("/api/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            phaseId: phaseAssignModal.phaseId,
            userId: assignUserId,
            date,
            startTime: assignStartTime,
            endTime: assignEndTime,
          }),
        });
      }
      setPhaseAssignModal(null);
      fetchSchedule();
    } finally {
      setSavingAssign(false);
    }
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

    if (!session?.user?.id) {
      alert("Not logged in — please refresh and try again.");
      return;
    }

    setUploading(true);
    try {
      // Phase 1: upload file directly from browser to Vercel Blob
      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filename = `uploads/${timestamp}_${safeName}`;

      let blobUrl: string;
      try {
        const blob = await upload(filename, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
        });
        blobUrl = blob.url;
      } catch (uploadErr) {
        alert(`Upload to storage failed: ${String(uploadErr)}`);
        return;
      }

      // Phase 2: save document record to DB
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          fileUrl: blobUrl,
          fileType: file.type || "application/octet-stream",
          jobId,
          phaseId: uploadPhaseId || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`File uploaded but failed to save record: ${err.error ?? res.statusText}`);
      }
    } catch (err) {
      alert(`Unexpected error: ${String(err)}`);
    } finally {
      setUploading(false);
      e.target.value = "";
      fetchDocuments();
    }
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
                    {session?.user?.role === "ADMIN" && (
                      <button
                        onClick={() => setDeleteConfirm(true)}
                        className="text-sm text-red-600 hover:text-red-800 border border-red-300 px-3 py-1 rounded-lg hover:bg-red-50"
                      >
                        Delete Job
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
                  {phases.map((phase, idx) => {
                    const deps = phaseDeps[phase.id] ?? { predecessorDeps: [], successorDeps: [] };
                    const hasDeps = deps.predecessorDeps.length > 0 || deps.successorDeps.length > 0;

                    // Blocked: any predecessor whose endDate is in the future
                    const now = new Date();
                    const blockers = deps.predecessorDeps.filter((d) => {
                      const predEnd = d.predecessor?.endDate ? new Date(d.predecessor.endDate) : null;
                      return predEnd && predEnd > now;
                    });
                    const isBlocked = blockers.length > 0;

                    return (
                    <div key={phase.id} className={`border rounded-xl overflow-hidden ${isBlocked ? "border-amber-300" : "border-gray-200"}`}>
                      {/* Phase header */}
                      <div className={`flex items-center gap-3 p-3 ${isBlocked ? "bg-amber-50" : "bg-gray-50"}`}>
                        <div className="flex flex-col gap-0.5">
                          <button onClick={() => movePhase(phase, "up", phases)} disabled={idx === 0}
                            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 leading-none">▲</button>
                          <button onClick={() => movePhase(phase, "down", phases)} disabled={idx === phases.length - 1}
                            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 leading-none">▼</button>
                        </div>
                        <span className="text-xs text-gray-400 w-5 text-center">{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-medium text-gray-900 text-sm">{phase.name}</p>
                            {hasDeps && <span title="Has dependencies" className="text-sm">🔗</span>}
                            {isBlocked && (
                              <span
                                title={`Waiting on: ${blockers.map((d) => d.predecessor?.name).join(", ")}`}
                                className="text-sm cursor-help"
                              >
                                🔒
                              </span>
                            )}
                          </div>
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
                        <div className="flex gap-2 shrink-0">
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

                      {/* Dependencies section */}
                      <div className="px-4 py-3 border-t border-gray-100 bg-white">
                        {/* Predecessors */}
                        {deps.predecessorDeps.length > 0 && (
                          <div className="mb-2">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Predecessors</p>
                            <div className="space-y-1">
                              {deps.predecessorDeps.map((d) => (
                                <div key={d.predecessorId} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="text-gray-700">
                                    <span className="font-medium">{d.predecessor?.name}</span>
                                    {" "}
                                    <span className="text-gray-400">({depTypeLabel(d.type)}{d.lagDays > 0 ? ` + ${d.lagDays}d` : ""})</span>
                                    {d.predecessor?.endDate && (
                                      <span className="text-gray-400 ml-1">
                                        · ends {format(parseISO(d.predecessor.endDate.split("T")[0]), "MMM d")}
                                      </span>
                                    )}
                                  </span>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      onClick={() => openEditDepModal(phase, d)}
                                      className="text-blue-500 hover:text-blue-700 font-medium"
                                      title="Edit dependency"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => removeDependency(phase.id, d.predecessorId)}
                                      className="text-red-400 hover:text-red-600"
                                      title="Remove dependency"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Successors */}
                        {deps.successorDeps.length > 0 && (
                          <div className="mb-2">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Blocks</p>
                            <div className="space-y-1">
                              {deps.successorDeps.map((d) => (
                                <div key={d.successorId} className="text-xs text-gray-600">
                                  🔗 <span className="font-medium">{d.successor?.name}</span>
                                  {" "}
                                  <span className="text-gray-400">({depTypeLabel(d.type)}{d.lagDays > 0 ? ` + ${d.lagDays}d` : ""})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <button
                          onClick={() => openAddDepModal(phase)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          + Add Predecessor
                        </button>
                      </div>

                      {/* Assigned People */}
                      <div className="px-4 py-3 border-t border-gray-100 bg-white">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Assigned</p>
                          <button
                            onClick={() => openAssignModal(phase)}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            + Assign
                          </button>
                        </div>
                        {getPhaseAssignments(phase.id).length === 0 ? (
                          <p className="text-xs text-gray-400 italic">No one assigned yet</p>
                        ) : (
                          <div className="space-y-1">
                            {getPhaseAssignments(phase.id).map(({ user, startDate, endDate, count }) => (
                              <div key={user.id} className="flex items-center justify-between gap-2 text-xs">
                                <span className="text-gray-700">
                                  <span className="font-medium">{user.name}</span>
                                  {" "}
                                  <span className="text-gray-400">
                                    {startDate && format(parseISO(startDate), "MMM d")}
                                    {startDate !== endDate && endDate && ` – ${format(parseISO(endDate), "MMM d")}`}
                                    {" "}({count}d)
                                  </span>
                                </span>
                                <button
                                  onClick={() => unassignPersonFromPhase(phase.id, user.id)}
                                  className="text-red-400 hover:text-red-600 shrink-0"
                                  title="Remove from phase"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Phase date editor */}
                      {editingPhaseId === phase.id && (
                        <div className="p-4 border-t border-gray-200 bg-white">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                              <input
                                type="date"
                                value={phaseEditStart}
                                onChange={(e) => {
                                  setPhaseEditStart(e.target.value);
                                  if (phaseEditDuration && e.target.value)
                                    setPhaseEditEnd(endFromDuration(e.target.value, Number(phaseEditDuration)));
                                }}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Duration (days)</label>
                              <select
                                value={phaseEditDuration}
                                onChange={(e) => {
                                  const d = e.target.value ? Number(e.target.value) : "";
                                  setPhaseEditDuration(d);
                                  if (d && phaseEditStart) setPhaseEditEnd(endFromDuration(phaseEditStart, Number(d)));
                                }}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">— custom —</option>
                                {DURATION_OPTIONS.map((d) => <option key={d} value={d}>{d}d</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                              <input
                                type="date"
                                value={phaseEditEnd}
                                onChange={(e) => {
                                  setPhaseEditEnd(e.target.value);
                                  setPhaseEditDuration(durationFromDates(phaseEditStart, e.target.value) ?? "");
                                }}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-xs font-medium text-gray-600 mb-1">Depends On (phase that must finish first)</label>
                              <select
                                value={phaseEditDependsOn}
                                onChange={(e) => {
                                  const predId = e.target.value;
                                  setPhaseEditDependsOn(predId);
                                  // Auto-fill start date from predecessor's end date
                                  if (predId) {
                                    const pred = phases.find((p) => p.id === predId);
                                    if (pred?.endDate) {
                                      const suggestedStart = nextBusinessDayAfter(pred.endDate.split("T")[0]);
                                      setPhaseEditStart(suggestedStart);
                                      if (phaseEditDuration) {
                                        setPhaseEditEnd(endFromDuration(suggestedStart, Number(phaseEditDuration)));
                                      }
                                    }
                                  }
                                }}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">— No dependency —</option>
                                {phases.filter((p) => p.id !== phase.id).map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                    {p.endDate ? ` (ends ${format(parseISO(p.endDate.split("T")[0]), "MMM d")})` : ""}
                                  </option>
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
                    );
                  })}
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Start Date <span className="text-gray-400">(optional)</span></label>
                    <input type="date" value={newPhaseStart}
                      onChange={(e) => setNewPhaseStart(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Duration (working days)</label>
                    <select value={newPhaseDuration}
                      onChange={(e) => setNewPhaseDuration(e.target.value ? Number(e.target.value) : "")}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">— set later —</option>
                      {DURATION_OPTIONS.map((d) => <option key={d} value={d}>{d} day{d !== 1 ? "s" : ""}</option>)}
                    </select>
                  </div>
                </div>
                {/* Predecessor selector – auto-fills start date */}
                {phases.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Predecessor <span className="text-gray-400">(auto-fills start date)</span></label>
                    <select
                      value={newPhasePredecessorId}
                      onChange={(e) => {
                        const predId = e.target.value;
                        setNewPhasePredecessorId(predId);
                        if (predId) {
                          const pred = phases.find((p) => p.id === predId);
                          if (pred?.endDate) {
                            const suggested = nextBusinessDayAfter(pred.endDate.split("T")[0]);
                            setNewPhaseStart(suggested);
                          }
                        }
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— None —</option>
                      {phases.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.endDate ? ` (ends ${format(parseISO(p.endDate.split("T")[0]), "MMM d")})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {newPhaseStart && newPhaseDuration && (
                  <p className="text-xs text-blue-600">
                    End: {endFromDuration(newPhaseStart, Number(newPhaseDuration))
                      ? format(parseISO(endFromDuration(newPhaseStart, Number(newPhaseDuration))), "MMM d, yyyy")
                      : "—"}
                    {" "}(skips weekends)
                  </p>
                )}
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
                  <input type="file" className="hidden" accept="image/*,application/pdf,video/*,.heic,.heif" onChange={uploadFile} disabled={uploading} />
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

      {/* Delete Job Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-xl shrink-0">
                🗑️
              </div>
              <h3 className="text-lg font-bold text-gray-900">Delete Job Permanently</h3>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-5">
              <p className="text-sm text-red-800 font-medium">
                This will permanently delete <strong>{job.name}</strong> and all its phases, schedule entries, and dependencies. This cannot be undone.
              </p>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              Are you absolutely sure you want to delete this job?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={deleteJob}
                disabled={deleting}
                className="flex-1 bg-red-600 text-white py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Yes, Delete Forever"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cascade Toast */}
      {cascadeToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full bg-blue-600 text-white rounded-xl shadow-2xl p-4 animate-in slide-in-from-bottom-4">
          <div className="flex items-start gap-3">
            <span className="text-xl shrink-0">📅</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">
                {cascadeToast.count} phase{cascadeToast.count !== 1 ? "s" : ""} automatically rescheduled
              </p>
              <div className="mt-1.5 space-y-1">
                {cascadeToast.phases.map((p, i) => (
                  <p key={i} className="text-xs text-blue-100">
                    <span className="font-medium">{p.name}</span>
                    {p.startDate && p.endDate && (
                      <span>
                        {" → "}{format(parseISO(p.startDate), "MMM d")}–{format(parseISO(p.endDate), "MMM d, yyyy")}
                      </span>
                    )}
                  </p>
                ))}
              </div>
            </div>
            <button onClick={() => setCascadeToast(null)} className="text-blue-200 hover:text-white shrink-0 text-lg leading-none">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Add Predecessor Modal */}
      {addDepModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Add Predecessor</h3>
            <p className="text-sm text-gray-500 mb-4">
              Choose a phase that must complete before <strong>{addDepModal.phaseName}</strong> can start.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Predecessor Phase</label>
                <select
                  value={depPredecessorId}
                  onChange={(e) => setDepPredecessorId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Select a phase —</option>
                  {phases.filter((p) => p.id !== addDepModal.phaseId).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.endDate ? ` (ends ${format(parseISO(p.endDate.split("T")[0]), "MMM d")})` : ""}
                    </option>
                  ))}
                </select>
                {/* Show suggested start date */}
                {depPredecessorId && (() => {
                  const pred = phases.find((p) => p.id === depPredecessorId);
                  if (pred?.endDate && depType === "FINISH_TO_START") {
                    const suggested = nextBusinessDayAfter(pred.endDate.split("T")[0]);
                    return (
                      <p className="text-xs text-blue-600 mt-1">
                        📅 Suggested start: <strong>{format(parseISO(suggested), "EEE, MMM d, yyyy")}</strong> (next business day after predecessor ends)
                      </p>
                    );
                  }
                  return null;
                })()}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Dependency Type</label>
                <select
                  value={depType}
                  onChange={(e) => setDepType(e.target.value as typeof depType)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="FINISH_TO_START">Finish → Start (most common)</option>
                  <option value="START_TO_START">Start → Start</option>
                  <option value="FINISH_TO_FINISH">Finish → Finish</option>
                  <option value="START_TO_FINISH">Start → Finish (rare)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Lag Days (default: 0)</label>
                <input
                  type="number"
                  min={0}
                  value={depLagDays}
                  onChange={(e) => setDepLagDays(parseInt(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Business days to wait after the dependency condition is met</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setAddDepModal(null)}
                className="flex-1 border border-gray-300 text-gray-700 py-2 px-4 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveNewDependency}
                disabled={savingDep || !depPredecessorId}
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {savingDep ? "Saving..." : "Add Dependency"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Predecessor Modal */}
      {editDepModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Edit Predecessor</h3>
            <p className="text-sm text-gray-500 mb-4">
              For <strong>{editDepModal.phaseName}</strong>
            </p>

            <div className="space-y-4">
              {/* Predecessor selector — can be changed */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Predecessor Phase</label>
                <select
                  value={editDepNewPredecessorId}
                  onChange={(e) => setEditDepNewPredecessorId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {phases.filter((p) => p.id !== editDepModal.phaseId).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.endDate ? ` (ends ${format(parseISO(p.endDate.split("T")[0]), "MMM d")})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Dependency Type</label>
                <select
                  value={editDepType}
                  onChange={(e) => setEditDepType(e.target.value as typeof editDepType)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="FINISH_TO_START">Finish → Start (most common)</option>
                  <option value="START_TO_START">Start → Start</option>
                  <option value="FINISH_TO_FINISH">Finish → Finish</option>
                  <option value="START_TO_FINISH">Start → Finish (rare)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Lag Days</label>
                <input
                  type="number"
                  min={0}
                  value={editDepLagDays}
                  onChange={(e) => setEditDepLagDays(parseInt(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Live date preview — updates as user changes predecessor/type/lag */}
              {(() => {
                const predPhase = phases.find((p) => p.id === editDepNewPredecessorId);
                const thisPhase = phases.find((p) => p.id === editDepModal.phaseId);
                if (!predPhase || !thisPhase) return null;
                const currentStart = thisPhase.startDate?.split("T")[0] ?? "";
                const currentEnd = thisPhase.endDate?.split("T")[0] ?? "";
                const duration = (currentStart && currentEnd) ? (durationFromDates(currentStart, currentEnd) ?? 5) : 5;
                const newDates = computeDatesFromPredecessor(predPhase, editDepType, editDepLagDays, duration);
                if (!newDates) return null;
                return (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800">
                    <p className="font-semibold mb-1">📅 Dates will update to:</p>
                    <p>Start: <strong>{format(parseISO(newDates.startDate), "EEE, MMM d, yyyy")}</strong></p>
                    <p>End: <strong>{format(parseISO(newDates.endDate), "EEE, MMM d, yyyy")}</strong></p>
                    <p className="text-green-600 mt-1">({duration} working day{duration !== 1 ? "s" : ""})</p>
                  </div>
                );
              })()}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditDepModal(null)}
                className="flex-1 border border-gray-300 text-gray-700 py-2 px-4 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEditDependency}
                disabled={savingEditDep}
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {savingEditDep ? "Saving..." : "Save & Apply Dates"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Assign Person to Phase Modal */}
      {phaseAssignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Assign to Phase</h3>
            <p className="text-sm text-gray-500 mb-4"><strong>{phaseAssignModal.phaseName}</strong></p>

            <div className="space-y-4">
              {/* Person */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Person</label>
                <select
                  value={assignUserId}
                  onChange={(e) => setAssignUserId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Select person —</option>
                  {["ADMIN", "EMPLOYEE", "SUBCONTRACTOR"].map((role) => {
                    const group = users.filter((u) => u.role === role);
                    if (!group.length) return null;
                    return (
                      <optgroup key={role} label={role.charAt(0) + role.slice(1).toLowerCase() + "s"}>
                        {group.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </optgroup>
                    );
                  })}
                </select>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
                  <input type="date" value={assignStartDate} onChange={(e) => setAssignStartDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">End Date</label>
                  <input type="date" value={assignEndDate} onChange={(e) => setAssignEndDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              {/* Hours */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Start Time</label>
                  <input type="time" value={assignStartTime} onChange={(e) => setAssignStartTime(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">End Time</label>
                  <input type="time" value={assignEndTime} onChange={(e) => setAssignEndTime(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              {/* Working days toggles */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">Working Days</label>
                <div className="flex gap-1.5">
                  {[{l:"M",d:1},{l:"T",d:2},{l:"W",d:3},{l:"Th",d:4},{l:"F",d:5},{l:"Sa",d:6},{l:"Su",d:0}].map(({l,d}) => (
                    <button key={d} type="button" onClick={() => toggleAssignWorkDay(d)}
                      className={`w-9 h-9 rounded-lg text-xs font-medium transition-colors ${assignWorkDays.includes(d) ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview count */}
              {assignStartDate && assignEndDate && assignWorkDays.length > 0 && (() => {
                let count = 0;
                let d = parseISO(assignStartDate);
                const end = parseISO(assignEndDate);
                while (d <= end) { if (assignWorkDays.includes(d.getDay())) count++; d = addDays(d, 1); }
                return <p className="text-xs text-blue-600">{count} day{count !== 1 ? "s" : ""} will be scheduled</p>;
              })()}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setPhaseAssignModal(null)}
                className="flex-1 border border-gray-300 text-gray-700 py-2 px-4 rounded-lg text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={assignPersonToPhase}
                disabled={savingAssign || !assignUserId || !assignStartDate || !assignEndDate}
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {savingAssign ? "Assigning..." : "Assign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
