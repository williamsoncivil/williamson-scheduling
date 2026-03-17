"use client";

import { useEffect, useState, useRef } from "react";
import Layout from "@/components/Layout";
import { PhaseModalTabs } from "@/components/PhaseModalTabs";
import Link from "next/link";
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  eachDayOfInterval,
  parseISO,
  isSameDay,
  startOfMonth,
  endOfMonth,
  eachWeekOfInterval,
} from "date-fns";

interface ScheduleEntry {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  job: { id: string; name: string; color: string };
  phase: { id: string; name: string; completion: number; startDate: string | null; endDate: string | null } | null;
  user: { id: string; name: string; role: string };
}

interface UnassignedPhase {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  job: { id: string; name: string; color: string };
}

interface User {
  id: string;
  name: string;
}

type GroupBy = "people" | "jobs";

export default function SchedulePage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [unassignedPhases, setUnassignedPhases] = useState<UnassignedPhase[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [filterUserId, setFilterUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"week" | "month">("month");
  const [groupBy, setGroupBy] = useState<GroupBy>("people");
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [jobDropdownOpen, setJobDropdownOpen] = useState(false);

  const [entryModal, setEntryModal] = useState<{
    entry: ScheduleEntry;
    date: string;
    startTime: string;
    endTime: string;
    notes: string;
    completion: number;
    additionalUserIds: Set<string>;
    saving: boolean;
    error: string;
  } | null>(null);

  const [phaseModal, setPhaseModal] = useState<{
    phase: UnassignedPhase;
    startDate: string;
    endDate: string;
    completion: number;
    assignedUserIds: Set<string>;
    saving: boolean;
    error: string;
  } | null>(null);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  useEffect(() => {
    fetch("/api/people").then((r) => r.json()).then((d) => setUsers(d));
  }, []);

  useEffect(() => {
    setLoading(true);
    let url: string;
    if (viewMode === "month") {
      const monthStr = format(monthStart, "yyyy-MM-dd");
      url = filterUserId
        ? `/api/schedule?month=${monthStr}&userId=${filterUserId}`
        : `/api/schedule?month=${monthStr}`;
    } else {
      const weekStr = format(weekStart, "yyyy-MM-dd");
      url = filterUserId
        ? `/api/schedule?week=${weekStr}&userId=${filterUserId}`
        : `/api/schedule?week=${weekStr}`;
    }

    fetch(url).then((r) => r.json()).then((d) => {
      setEntries(d.entries ?? d);
      setUnassignedPhases(d.unassignedPhases ?? []);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate, filterUserId, viewMode]);

  /** Strip UTC time offset so dates don't shift by a day in local timezone */
  const parseDate = (dateStr: string) => parseISO(dateStr.split("T")[0]);

  const refetch = async () => {
    let url: string;
    if (viewMode === "month") {
      const monthStr = format(monthStart, "yyyy-MM-dd");
      url = filterUserId ? `/api/schedule?month=${monthStr}&userId=${filterUserId}` : `/api/schedule?month=${monthStr}`;
    } else {
      const weekStr = format(weekStart, "yyyy-MM-dd");
      url = filterUserId ? `/api/schedule?week=${weekStr}&userId=${filterUserId}` : `/api/schedule?week=${weekStr}`;
    }
    const d = await fetch(url).then((r) => r.json());
    setEntries(d.entries ?? d);
    setUnassignedPhases(d.unassignedPhases ?? []);
  };

  const getEntriesForDay = (day: Date, entryList?: ScheduleEntry[]) => {
    const list = entryList ?? entries;
    const matched = list.filter((e) => {
      if (e.phase?.startDate) {
        const start = parseDate(e.phase.startDate);
        const end = e.phase.endDate ? parseDate(e.phase.endDate) : start;
        return day >= start && day <= end;
      }
      return isSameDay(parseDate(e.date), day);
    });
    // Deduplicate: only one entry per phase per day
    const seen = new Set<string>();
    return matched.filter((e) => {
      const key = e.phase?.id ?? e.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const prevPeriod = () => setCurrentDate(viewMode === "month" ? subMonths(currentDate, 1) : subWeeks(currentDate, 1));
  const nextPeriod = () => setCurrentDate(viewMode === "month" ? addMonths(currentDate, 1) : addWeeks(currentDate, 1));

  // For month view
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const weeksInMonth = eachWeekOfInterval(
    { start: monthStart, end: monthEnd },
    { weekStartsOn: 0 }
  );

  // ── Entry click-to-edit ────────────────────────────────────────────────────
  const openEntryModal = (entry: ScheduleEntry) => {
    const dateStr = entry.date.split("T")[0];
    setEntryModal({
      entry,
      date: dateStr,
      startTime: entry.startTime,
      endTime: entry.endTime,
      notes: entry.notes ?? "",
      completion: entry.phase?.completion ?? 0,
      additionalUserIds: new Set(),
      saving: false,
      error: "",
    });
  };

  const saveEntryModal = async () => {
    if (!entryModal) return;
    setEntryModal((m) => m ? { ...m, saving: true, error: "" } : null);
    try {
      const res = await fetch(`/api/schedule/${entryModal.entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: entryModal.date,
          startTime: entryModal.startTime,
          endTime: entryModal.endTime,
          notes: entryModal.notes,
        }),
      });
      if (!res.ok) throw new Error("Save failed");

      // Save completion if phase exists
      if (entryModal.entry.phase?.id) {
        await fetch(`/api/phases/${entryModal.entry.phase.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completion: entryModal.completion }),
        });
      }

      // Create schedule entries for additional people
      if (entryModal.additionalUserIds.size > 0) {
        await Promise.all(Array.from(entryModal.additionalUserIds).map((userId) =>
          fetch("/api/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId: entryModal.entry.job.id,
              phaseId: entryModal.entry.phase?.id ?? null,
              userId,
              date: entryModal.date,
              startTime: entryModal.startTime,
              endTime: entryModal.endTime,
            }),
          })
        ));
      }

      setEntryModal(null);
      await refetch();
    } catch {
      setEntryModal((m) => m ? { ...m, saving: false, error: "Failed to save — try again" } : null);
    }
  };

  // ── Unassigned phase date edit ─────────────────────────────────────────────
  const openPhaseModal = (phase: UnassignedPhase) => {
    setPhaseModal({
      phase,
      startDate: phase.startDate.split("T")[0],
      endDate: phase.endDate ? phase.endDate.split("T")[0] : "",
      completion: 0,
      assignedUserIds: new Set(),
      saving: false,
      error: "",
    });
  };

  const savePhaseModal = async () => {
    if (!phaseModal) return;
    setPhaseModal((m) => m ? { ...m, saving: true, error: "" } : null);
    try {
      const res = await fetch(`/api/phases/${phaseModal.phase.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: phaseModal.startDate, endDate: phaseModal.endDate || null, completion: phaseModal.completion }),
      });
      if (!res.ok) throw new Error("Save failed");

      // Assign selected people
      if (phaseModal.assignedUserIds.size > 0 && phaseModal.startDate) {
        await Promise.all(Array.from(phaseModal.assignedUserIds).map((userId) =>
          fetch("/api/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId: phaseModal.phase.job.id,
              phaseId: phaseModal.phase.id,
              userId,
              date: phaseModal.startDate,
              startTime: "07:00",
              endTime: "15:30",
            }),
          })
        ));
      }

      setPhaseModal(null);
      await refetch();
    } catch {
      setPhaseModal((m) => m ? { ...m, saving: false, error: "Failed to save — try again" } : null);
    }
  };

  // ── By Jobs grouping ───────────────────────────────────────────────────────
  // All unique jobs in current entries
  const allJobRows = (() => {
    const jobMap = new Map<string, { id: string; name: string; color: string }>();
    entries.forEach((e) => {
      if (!jobMap.has(e.job.id)) jobMap.set(e.job.id, e.job);
    });
    return Array.from(jobMap.values());
  })();

  // Auto-select all jobs when job list first loads
  const prevJobIdsRef = useRef<string>("");
  const jobIdKey = allJobRows.map((j) => j.id).sort().join(",");
  if (jobIdKey !== prevJobIdsRef.current && allJobRows.length > 0) {
    prevJobIdsRef.current = jobIdKey;
    if (selectedJobIds.size === 0) {
      setSelectedJobIds(new Set(allJobRows.map((j) => j.id)));
    }
  }

  const visibleJobRows = allJobRows.filter((j) => selectedJobIds.size === 0 || selectedJobIds.has(j.id));

  const toggleJob = (jobId: string) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
      return next;
    });
  };

  const getEntriesForJobAndDay = (jobId: string, day: Date) => {
    const matched = entries.filter((e) => {
      if (e.job.id !== jobId) return false;
      if (e.phase?.startDate) {
        const start = parseDate(e.phase.startDate);
        const end = e.phase.endDate ? parseDate(e.phase.endDate) : start;
        return day >= start && day <= end;
      }
      return isSameDay(parseDate(e.date), day);
    });
    const seen = new Set<string>();
    return matched.filter((e) => {
      const key = e.phase?.id ?? e.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const getUnassignedForDay = (day: Date) =>
    unassignedPhases.filter((p) => {
      const start = parseDate(p.startDate);
      const end = p.endDate ? parseDate(p.endDate) : start;
      return day >= start && day <= end;
    });

  const renderUnassignedPhase = (phase: UnassignedPhase) => (
    <div
      key={`unassigned-${phase.id}`}
      onClick={(e) => { e.stopPropagation(); openPhaseModal(phase); }}
      className="mb-1.5 p-2 rounded-lg text-white text-xs opacity-50 cursor-pointer hover:opacity-70 transition-opacity"
      style={{ backgroundColor: phase.job.color }}
    >
      <p className="font-semibold truncate">{phase.job.name}</p>
      <p className="truncate">{phase.name}</p>
      <p className="opacity-80 italic">Unassigned</p>
    </div>
  );

  // ── Render entry card ───────────────────────────────────────────────────────
  const renderEntry = (entry: ScheduleEntry, mode: GroupBy) => (
    <div
      key={entry.id}
      onClick={(e) => { e.stopPropagation(); openEntryModal(entry); }}
      className="mb-1.5 p-2 rounded-lg text-white text-xs cursor-pointer hover:opacity-90 active:opacity-75 transition-opacity"
      style={{ backgroundColor: entry.job.color }}
    >
      <p className="font-semibold truncate">
        {mode === "people" ? entry.job.name : entry.user.name.split(" ")[0]}
      </p>
      {entry.phase && <p className="opacity-80 truncate">{entry.phase.name}</p>}
      <p className="opacity-70">{entry.startTime}–{entry.endTime}</p>
    </div>
  );

  const renderDayCell = (day: Date, entryList: ScheduleEntry[], mode: GroupBy) => {
    const isToday = isSameDay(day, new Date());
    const unassigned = getUnassignedForDay(day);
    return (
      <div
        key={day.toISOString()}
        className={`p-2 border-r last:border-r-0 border-gray-100 min-h-24 ${isToday ? "bg-blue-50/50" : ""}`}
      >
        {entryList.map((entry) => renderEntry(entry, mode))}
        {unassigned.map((p) => renderUnassignedPhase(p))}
      </div>
    );
  };

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Schedule</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {viewMode === "week"
                ? `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`
                : format(currentDate, "MMMM yyyy")}

            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Gantt View link */}
            <Link
              href="/schedule/gantt"
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              📊 Gantt View
            </Link>

            {/* Group by toggle */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setGroupBy("people")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${groupBy === "people" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
              >
                By People
              </button>
              <button
                onClick={() => setGroupBy("jobs")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${groupBy === "jobs" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
              >
                By Jobs
              </button>
            </div>

            {/* View mode toggle */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode("week")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === "week" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}
              >
                Week
              </button>
              <button
                onClick={() => setViewMode("month")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === "month" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}
              >
                Month
              </button>
            </div>

            {/* Navigation */}
            <button onClick={prevPeriod} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600">←</button>
            <button onClick={() => setCurrentDate(new Date())} className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 text-gray-600">Today</button>
            <button onClick={nextPeriod} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600">→</button>
          </div>
        </div>

        {/* Filter row */}
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          {groupBy === "people" ? (
            /* People filter */
            <select
              value={filterUserId}
              onChange={(e) => setFilterUserId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All People</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          ) : (
            /* Jobs multi-select dropdown */
            <div className="relative">
              <button
                onClick={() => setJobDropdownOpen((o) => !o)}
                className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-40"
              >
                <span className="flex-1 text-left text-gray-700">
                  {selectedJobIds.size === 0 || selectedJobIds.size === allJobRows.length
                    ? "All Jobs"
                    : `${selectedJobIds.size} of ${allJobRows.length} jobs`}
                </span>
                <span className="text-gray-400 text-xs">{jobDropdownOpen ? "▲" : "▼"}</span>
              </button>

              {jobDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg w-56 py-1">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Jobs</span>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedJobIds(new Set(allJobRows.map((j) => j.id)))}
                        className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">All</button>
                      <button onClick={() => setSelectedJobIds(new Set())}
                        className="text-[10px] text-gray-400 hover:text-gray-600 font-medium">None</button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {allJobRows.map((job) => {
                      const checked = selectedJobIds.size === 0 || selectedJobIds.has(job.id);
                      return (
                        <label key={job.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50">
                          <input type="checkbox" checked={checked} onChange={() => toggleJob(job.id)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0" />
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: job.color }} />
                          <span className="text-xs text-gray-800 truncate">{job.name}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="border-t border-gray-100 px-3 py-1.5">
                    <button onClick={() => setJobDropdownOpen(false)}
                      className="w-full text-center text-xs text-gray-500 hover:text-gray-700 font-medium py-0.5">
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-12">Loading...</div>
        ) : viewMode === "week" ? (
          /* ── Week View ────────────────────────────────────────────────────── */
          groupBy === "people" ? (
            /* By People: traditional day-column calendar */
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="grid grid-cols-7 border-b border-gray-100">
                {days.map((day) => (
                  <div key={day.toISOString()} className="p-3 text-center border-r last:border-r-0 border-gray-100">
                    <p className="text-xs font-medium text-gray-400 uppercase">{format(day, "EEE")}</p>
                    <p className={`text-lg font-semibold mt-0.5 ${isSameDay(day, new Date()) ? "text-blue-600" : "text-gray-700"}`}>
                      {format(day, "d")}
                    </p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 min-h-64">
                {days.map((day) => renderDayCell(day, getEntriesForDay(day), "people"))}
              </div>
            </div>
          ) : (
            /* By Jobs: full-width grid, filtered by job dropdown */
            <div className="bg-white rounded-xl shadow-sm overflow-hidden" onClick={() => setJobDropdownOpen(false)}>
              {visibleJobRows.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  {allJobRows.length === 0 ? "No schedule entries this week" : "No jobs selected — use the Jobs dropdown above"}
                </div>
              ) : (
                <>
                  <div className="flex border-b border-gray-100">
                    <div className="w-44 shrink-0 px-3 py-3 border-r border-gray-100">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Job</span>
                    </div>
                    {days.map((day) => (
                      <div key={day.toISOString()} className="flex-1 p-3 text-center border-r last:border-r-0 border-gray-100">
                        <p className="text-xs font-medium text-gray-400 uppercase">{format(day, "EEE")}</p>
                        <p className={`text-lg font-semibold mt-0.5 ${isSameDay(day, new Date()) ? "text-blue-600" : "text-gray-700"}`}>
                          {format(day, "d")}
                        </p>
                      </div>
                    ))}
                  </div>
                  {visibleJobRows.map((job) => (
                    <div key={job.id} className="flex border-b last:border-b-0 border-gray-100" style={{ minHeight: 80 }}>
                      <div className="w-44 shrink-0 px-3 py-2 border-r border-gray-100 flex items-start gap-2 pt-3">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: job.color }} />
                        <Link href={`/jobs/${job.id}`} className="text-xs font-semibold text-gray-800 hover:underline leading-tight">
                          {job.name}
                        </Link>
                      </div>
                      {days.map((day) => {
                        const dayEntries = getEntriesForJobAndDay(job.id, day);
                        const isToday = isSameDay(day, new Date());
                        return (
                          <div key={day.toISOString()}
                            className={`flex-1 p-2 border-r last:border-r-0 border-gray-100 ${isToday ? "bg-blue-50/50" : ""}`}
                          >
                            {dayEntries.map((entry) => (
                              <div key={entry.id}
                                onClick={(e) => { e.stopPropagation(); openEntryModal(entry); }}
                                className="mb-1.5 p-1.5 rounded-lg text-white text-xs cursor-pointer hover:opacity-90 transition-opacity"
                                style={{ backgroundColor: job.color }}
                              >
                                <p className="font-semibold truncate">{entry.user.name.split(" ")[0]}</p>
                                {entry.phase && <p className="opacity-80 truncate text-[10px]">{entry.phase.name}</p>}
                                <p className="opacity-70 text-[10px]">{entry.startTime}–{entry.endTime}</p>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}
            </div>
          )
        ) : (
          /* ── Month View ───────────────────────────────────────────────────── */
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-100">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="p-3 text-center">
                  <p className="text-xs font-medium text-gray-400 uppercase">{d}</p>
                </div>
              ))}
            </div>
            {weeksInMonth.map((ws) => {
              const weekDays = eachDayOfInterval({
                start: ws,
                end: endOfWeek(ws, { weekStartsOn: 0 }),
              });
              return (
                <div key={ws.toISOString()} className="grid grid-cols-7 border-b last:border-b-0 border-gray-100">
                  {weekDays.map((day) => {
                    const dayEntries = getEntriesForDay(day);
                    const inMonth = day.getMonth() === currentDate.getMonth();
                    const isToday = isSameDay(day, new Date());
                    return (
                      <div
                        key={day.toISOString()}
                        className={`p-2 border-r last:border-r-0 border-gray-100 min-h-24 ${!inMonth ? "bg-gray-50" : ""} ${isToday ? "bg-blue-50/50" : ""}`}
                      >
                        <p className={`text-xs font-medium mb-1 ${!inMonth ? "text-gray-300" : isToday ? "text-blue-600 font-bold" : "text-gray-600"}`}>
                          {format(day, "d")}
                        </p>
                        {dayEntries.slice(0, 3).map((entry) => (
                          <div
                            key={entry.id}
                            onClick={(e) => { e.stopPropagation(); openEntryModal(entry); }}
                            className="mb-0.5 px-1.5 py-0.5 rounded text-white text-xs truncate cursor-pointer hover:opacity-90"
                            style={{ backgroundColor: entry.job.color }}
                          >
                            {groupBy === "people"
                              ? `${entry.user.name.split(" ")[0]} · ${entry.job.name}`
                              : `${entry.job.name} · ${entry.user.name.split(" ")[0]}`}
                          </div>
                        ))}
                        {dayEntries.length > 3 && (
                          <p className="text-xs text-gray-400">+{dayEntries.length - 3} more</p>
                        )}
                        {getUnassignedForDay(day).map((p) => (
                          <div
                            key={`unassigned-${p.id}`}
                            onClick={(e) => { e.stopPropagation(); openPhaseModal(p); }}
                            className="mb-0.5 px-1.5 py-0.5 rounded text-white text-xs truncate opacity-50 cursor-pointer hover:opacity-70 transition-opacity"
                            style={{ backgroundColor: p.job.color }}
                          >
                            {p.name} · Unassigned
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Entry edit modal */}
      {entryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEntryModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4">
              <h3 className="font-semibold text-gray-900 text-base">{entryModal.entry.job.name}</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {entryModal.entry.user.name}
                {entryModal.entry.phase && ` · ${entryModal.entry.phase.name}`}
              </p>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <input type="date" value={entryModal.date}
                  onChange={(e) => setEntryModal((m) => m ? { ...m, date: e.target.value } : null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
                  <input type="time" value={entryModal.startTime}
                    onChange={(e) => setEntryModal((m) => m ? { ...m, startTime: e.target.value } : null)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
                  <input type="time" value={entryModal.endTime}
                    onChange={(e) => setEntryModal((m) => m ? { ...m, endTime: e.target.value } : null)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes <span className="text-gray-400">(optional)</span></label>
                <textarea value={entryModal.notes} rows={2}
                  onChange={(e) => setEntryModal((m) => m ? { ...m, notes: e.target.value } : null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
            </div>
              {entryModal.entry.phase && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phase Completion</label>
                  <select value={entryModal.completion}
                    onChange={(e) => setEntryModal((m) => m ? { ...m, completion: parseInt(e.target.value) } : null)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {[0,10,20,25,30,40,50,60,70,75,80,90,95,100].map((v) => (
                      <option key={v} value={v}>{v === 100 ? "✓ Complete (100%)" : `${v}%`}</option>
                    ))}
                  </select>
                </div>
              )}
              {users.filter((u) => u.id !== entryModal.entry.user.id).length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Add More People <span className="text-gray-400">(optional)</span></label>
                  <div className="space-y-1 max-h-28 overflow-y-auto border border-gray-200 rounded-lg p-2">
                    {users.filter((u) => u.id !== entryModal.entry.user.id).map((u) => (
                      <label key={u.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                        <input
                          type="checkbox"
                          checked={entryModal.additionalUserIds.has(u.id)}
                          onChange={() => setEntryModal((m) => {
                            if (!m) return null;
                            const next = new Set(m.additionalUserIds);
                            if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                            return { ...m, additionalUserIds: next };
                          })}
                          className="rounded border-gray-300 text-blue-600"
                        />
                        <span className="text-xs text-gray-700">{u.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            {entryModal.error && <p className="text-xs text-red-500 mb-3">{entryModal.error}</p>}
            <div className="flex gap-2 mb-2">
              <button onClick={saveEntryModal} disabled={entryModal.saving}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50">
                {entryModal.saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEntryModal(null)}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
            {entryModal.entry.phase?.id && (
              <PhaseModalTabs phaseId={entryModal.entry.phase.id} jobId={entryModal.entry.job.id} />
            )}
          </div>
        </div>
      )}
      {/* Phase date edit modal */}
      {phaseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPhaseModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4">
              <h3 className="font-semibold text-gray-900 text-base">{phaseModal.phase.name}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{phaseModal.phase.job.name} · Unassigned phase</p>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                <input type="date" value={phaseModal.startDate}
                  onChange={(e) => setPhaseModal((m) => m ? { ...m, startDate: e.target.value } : null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                <input type="date" value={phaseModal.endDate}
                  onChange={(e) => setPhaseModal((m) => m ? { ...m, endDate: e.target.value } : null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">Completion</label>
              <select value={phaseModal.completion}
                onChange={(e) => setPhaseModal((m) => m ? { ...m, completion: parseInt(e.target.value) } : null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {[0,10,20,25,30,40,50,60,70,75,80,90,95,100].map((v) => (
                  <option key={v} value={v}>{v === 100 ? "✓ Complete (100%)" : `${v}%`}</option>
                ))}
              </select>
            </div>
            {users.length > 0 && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Assign People <span className="text-gray-400">(optional)</span></label>
                <div className="space-y-1 max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2">
                  {users.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={phaseModal.assignedUserIds.has(u.id)}
                        onChange={() => setPhaseModal((m) => {
                          if (!m) return null;
                          const next = new Set(m.assignedUserIds);
                          if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                          return { ...m, assignedUserIds: next };
                        })}
                        className="rounded border-gray-300 text-blue-600"
                      />
                      <span className="text-xs text-gray-700">{u.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-gray-400 mb-3">Saving will update the Gantt, Timeline, and Jobs page — and cascade to dependent phases.</p>
            {phaseModal.error && <p className="text-xs text-red-500 mb-3">{phaseModal.error}</p>}
            <div className="flex gap-2 mb-2">
              <button onClick={savePhaseModal} disabled={phaseModal.saving || !phaseModal.startDate}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50">
                {phaseModal.saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setPhaseModal(null)}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
            <PhaseModalTabs phaseId={phaseModal.phase.id} jobId={phaseModal.phase.job.id} />
          </div>
        </div>
      )}
    </Layout>
  );
}
