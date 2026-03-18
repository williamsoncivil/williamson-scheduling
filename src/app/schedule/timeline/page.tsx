"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Layout from "@/components/Layout";
import { PhaseModalTabs } from "@/components/PhaseModalTabs";
import Link from "next/link";
import {
  format,
  parseISO,
  differenceInDays,
  addWeeks,
  subWeeks,
  startOfWeek,
  addDays,
  eachDayOfInterval,
  isWeekend,
  isSameDay,
} from "date-fns";

const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 28, 30, 45, 60, 90];

/** Strip time component so UTC dates don't shift by a day in local timezone */
const parseDate = (dateStr: string) => parseISO(dateStr.split("T")[0]);

/** Add N business days (skip weekends), returns yyyy-MM-dd */
function endFromDuration(start: string, days: number): string {
  try {
    let d = parseDate(start);
    while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
    let remaining = days - 1;
    while (remaining > 0) {
      d = addDays(d, 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) remaining--;
    }
    return format(d, "yyyy-MM-dd");
  } catch { return ""; }
}

/** Count business days between two date strings (inclusive) */
function durationFromDates(start: string, end: string): number | null {
  try {
    const endDate = parseDate(end);
    let d = parseDate(start);
    if (endDate < d) return null;
    let count = 0;
    while (d <= endDate) {
      if (d.getDay() !== 0 && d.getDay() !== 6) count++;
      d = addDays(d, 1);
    }
    return count > 0 ? count : null;
  } catch { return null; }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Worker {
  id: string;
  name: string;
  email: string;
}

interface PhaseSchedule {
  user: Worker;
}

interface Phase {
  id: string;
  name: string;
  description: string | null;
  orderIndex: number;
  startDate: string | null;
  endDate: string | null;
  completion: number;
  schedules: PhaseSchedule[];
}

interface Job {
  id: string;
  name: string;
  address: string;
  color: string;
  status: string;
  phases: Phase[];
}

interface TimelineData {
  jobs: Job[];
  allWorkers: Worker[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEK_OPTIONS = [1, 2, 4, 8, 12, 16, 20, 26, 30, 40, 52];
const DEFAULT_WEEK_RANGE = 8;

const PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#6366f1",
  "#14b8a6", "#eab308",
];

const DEFAULT_SIDEBAR_WIDTH = 200;
const MIN_SIDEBAR_WIDTH = 120;
const ROW_HEIGHT = 48;
const BAR_HEIGHT = 28;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserColor(userId: string, allWorkers: Worker[]): string {
  const idx = allWorkers.findIndex((w) => w.id === userId);
  if (idx < 0) return "#94a3b8";
  return PALETTE[idx % PALETTE.length];
}

function getInitials(name: string): string {
  return name.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);
}

function getDayWidth(weekRange: number): number {
  if (weekRange <= 1) return 100;
  if (weekRange <= 2) return 70;
  if (weekRange <= 4) return 40;
  if (weekRange <= 8) return 28;
  if (weekRange <= 12) return 20;
  if (weekRange <= 20) return 16;
  if (weekRange <= 30) return 12;
  return 10;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TimelinePage() {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekRange, setWeekRange] = useState(DEFAULT_WEEK_RANGE);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [tooltip, setTooltip] = useState<{
    phase: Phase;
    job: Job;
    x: number;
    y: number;
  } | null>(null);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("gantt-sidebar-width");
      if (stored) return Math.max(MIN_SIDEBAR_WIDTH, Number(stored));
    }
    return DEFAULT_SIDEBAR_WIDTH;
  });

  const startSidebarDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (me: MouseEvent) => {
      const maxW = Math.floor(window.innerWidth * 0.6);
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxW, startWidth + me.clientX - startX));
      setSidebarWidth(newWidth);
      localStorage.setItem("gantt-sidebar-width", String(newWidth));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startSidebarTouchDrag = (e: React.TouchEvent) => {
    const startX = e.touches[0].clientX;
    const startWidth = sidebarWidth;
    const onMove = (te: TouchEvent) => {
      te.preventDefault();
      const maxW = Math.floor(window.innerWidth * 0.6);
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxW, startWidth + te.touches[0].clientX - startX));
      setSidebarWidth(newWidth);
      localStorage.setItem("gantt-sidebar-width", String(newWidth));
    };
    const onEnd = () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  };

  const [optimisticDates, setOptimisticDates] = useState<Record<string, { startDate: string; endDate: string }>>({});
  const [hiddenJobIds, setHiddenJobIds] = useState<Set<string>>(new Set());
  const toggleJobVisibility = (id: string) => setHiddenJobIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const [editModal, setEditModal] = useState<{
    phase: Phase; jobId: string; jobName: string;
    startDate: string; endDate: string;
    completion: number;
    assignedUserIds: Set<string>;
    saving: boolean; error: string;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(() => {
    fetch("/api/schedule/timeline")
      .then((r) => r.json())
      .then((d: TimelineData) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── View range ──────────────────────────────────────────────────────────────
  const viewStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const viewEnd = addDays(addWeeks(viewStart, weekRange), -1);
  const days = eachDayOfInterval({ start: viewStart, end: viewEnd });
  const totalDays = days.length;
  const dayWidth = getDayWidth(weekRange);
  const timelineWidth = totalDays * dayWidth;

  const stepWeeks = Math.max(1, Math.floor(weekRange / 2));



  // ── Navigation ──────────────────────────────────────────────────────────────
  const prev = () => setCurrentDate((d) => subWeeks(d, stepWeeks));
  const next = () => setCurrentDate((d) => addWeeks(d, stepWeeks));
  const goToday = () => setCurrentDate(new Date());

  // ── Bar geometry ─────────────────────────────────────────────────────────────
  const getBarStyle = (phase: Phase, overrideDates?: { startDate: string; endDate: string }) => {
    const sd = overrideDates?.startDate ?? phase.startDate;
    const ed = overrideDates?.endDate ?? phase.endDate;
    if (!sd || !ed) return null;
    const start = parseDate(sd);
    const end = parseDate(ed);
    const leftDays = differenceInDays(start, viewStart);
    const widthDays = Math.max(differenceInDays(end, start) + 1, 1);
    const left = leftDays * dayWidth;
    const width = widthDays * dayWidth;
    const clampedLeft = Math.max(left, 0);
    const clampedRight = Math.min(left + width, timelineWidth);
    if (clampedRight <= 0 || clampedLeft >= timelineWidth) return null;
    return { left: clampedLeft, width: clampedRight - clampedLeft, rawLeft: left, rawWidth: width };
  };

  // ── Tooltip handler ──────────────────────────────────────────────────────────
  const handleBarMouseEnter = (e: React.MouseEvent, phase: Phase, job: Job) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ phase, job, x: rect.left, y: rect.bottom + 8 });
  };

  const saveEditModal = async () => {
    if (!editModal) return;
    setEditModal((m) => m ? { ...m, saving: true, error: "" } : null);
    try {
      const res = await fetch(`/api/phases/${editModal.phase.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: editModal.startDate, endDate: editModal.endDate, completion: editModal.completion }),
      });
      if (!res.ok) throw new Error("Save failed");

      // Assign selected people
      if (editModal.assignedUserIds.size > 0 && editModal.startDate) {
        await Promise.all(Array.from(editModal.assignedUserIds).map((userId) =>
          fetch("/api/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId: editModal.jobId,
              phaseId: editModal.phase.id,
              userId,
              date: editModal.startDate,
              startTime: "07:00",
              endTime: "15:30",
            }),
          })
        ));
      }

      setOptimisticDates((prev) => ({
        ...prev,
        [editModal.phase.id]: { startDate: editModal.startDate, endDate: editModal.endDate },
      }));
      setEditModal(null);
      fetchData();
    } catch {
      setEditModal((m) => m ? { ...m, saving: false, error: "Failed to save — try again" } : null);
    }
  };

  if (loading || !data) {
    return (
      <Layout>
        <div className="p-6 text-gray-400">Loading timeline…</div>
      </Layout>
    );
  }

  const { jobs, allWorkers } = data;

  const todayOffset = differenceInDays(new Date(), viewStart);
  const showToday = todayOffset >= 0 && todayOffset <= totalDays;

  const allJobsWithPhases = jobs.filter((j) => j.phases.length > 0);
  const jobsWithPhases = allJobsWithPhases.filter((j) => !hiddenJobIds.has(j.id));

  const periodLabel = `${format(viewStart, "MMM d")} – ${format(viewEnd, "MMM d, yyyy")}`;

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-full" onClick={() => setTooltip(null)}>
        {/* ── Page header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">People Timeline</h1>
            <p className="text-sm text-gray-500 mt-0.5">Jobs as rows · phases colored by assigned person · click to edit dates</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Week range selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 whitespace-nowrap">Show</span>
              <select
                value={weekRange}
                onChange={(e) => setWeekRange(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {WEEK_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {w} {w === 1 ? "week" : "weeks"}
                  </option>
                ))}
              </select>
            </div>

            {/* Prev / Today / Next */}
            <button
              onClick={prev}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 text-sm"
            >
              ←
            </button>
            <span className="text-sm font-medium text-gray-700 px-1 whitespace-nowrap">
              {periodLabel}
            </span>
            <button
              onClick={next}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 text-sm"
            >
              →
            </button>
            <button
              onClick={goToday}
              className="px-3 py-2 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 text-gray-600"
            >
              Today
            </button>

            <Link
              href="/schedule/gantt"
              className="px-3 py-2 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 text-gray-600"
            >
              ← Gantt
            </Link>
          </div>
        </div>

        {/* ── Job filter ──────────────────────────────────────────────────────── */}
        {allJobsWithPhases.length > 1 && (
          <div className="bg-white rounded-xl shadow-sm px-4 py-3 mb-4 flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">Jobs</span>
            {allJobsWithPhases.map((job) => {
              const hidden = hiddenJobIds.has(job.id);
              return (
                <button key={job.id} onClick={() => toggleJobVisibility(job.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${hidden ? "border-gray-300 text-gray-400 bg-white" : "border-transparent text-white"}`}
                  style={hidden ? {} : { backgroundColor: job.color }}>
                  <span>{job.name}</span>
                  {hidden && <span className="opacity-60">✕</span>}
                </button>
              );
            })}
            {hiddenJobIds.size > 0 && (
              <button onClick={() => setHiddenJobIds(new Set())} className="text-xs text-blue-600 hover:underline ml-1">Show all</button>
            )}
          </div>
        )}

        {/* ── Person color legend ──────────────────────────────────────────────── */}
        {allWorkers.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm px-4 py-3 mb-4 flex flex-wrap gap-3 items-center">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">People</span>
            {allWorkers.map((worker) => (
              <div key={worker.id} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: getUserColor(worker.id, allWorkers) }} />
                <span className="text-xs text-gray-700">{worker.name}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 ml-2">
              <div className="w-3 h-3 rounded-sm bg-slate-300 shrink-0" />
              <span className="text-xs text-gray-500">Unassigned</span>
            </div>

          </div>
        )}

        {/* ── Timeline grid ────────────────────────────────────────────────────── */}
        {jobsWithPhases.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
            No active jobs with phases to display
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="flex">
              {/* ── Sticky job-name column ─────────────────────────────────────── */}
              <div
                className="shrink-0 bg-white z-10 sticky left-0"
                style={{ width: sidebarWidth }}
              >
                <div className="h-10 border-b border-gray-100 flex items-center px-3">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Job</span>
                </div>
                {jobsWithPhases.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center px-3 border-b border-gray-100"
                    style={{ height: ROW_HEIGHT, backgroundColor: job.color + "14" }}
                  >
                    <div className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: job.color }} />
                    <Link href={`/jobs/${job.id}`} className="text-xs font-semibold text-gray-900 hover:underline truncate">
                      {job.name}
                    </Link>
                  </div>
                ))}
              </div>

              {/* ── Drag handle — wide enough for mobile touch ─────────────── */}
              <div
                className="w-5 shrink-0 cursor-col-resize z-10 sticky left-0 flex items-stretch"
                style={{ touchAction: "none" }}
                onMouseDown={startSidebarDrag}
                onTouchStart={startSidebarTouchDrag}
              >
                <div className="w-1.5 mx-auto bg-gray-200 hover:bg-blue-400 active:bg-blue-500 transition-colors border-x border-gray-200" />
              </div>

              {/* ── Scrollable timeline area ───────────────────────────────────── */}
              <div ref={scrollRef} className="flex-1 overflow-x-auto min-w-0" style={{ cursor: "grab" }}
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement).closest("button,select,input,a")) return;
                  const el = scrollRef.current;
                  if (!el) return;
                  e.preventDefault();
                  const startX = e.pageX + el.scrollLeft;
                  el.style.cursor = "grabbing";
                  const onMove = (me: MouseEvent) => { el.scrollLeft = startX - me.pageX; };
                  const onUp = () => { el.style.cursor = "grab"; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
              >
                <div style={{ width: Math.max(timelineWidth, 100), minWidth: "100%" }}>
                  {/* Day / Month header row */}
                  {dayWidth >= 20 ? (
                    <div className="relative h-10 border-b border-gray-100 flex" style={{ width: Math.max(timelineWidth, 100) }}>
                      {days.map((day, i) => {
                        const weekend = isWeekend(day);
                        const today = isSameDay(day, new Date());
                        return (
                          <div key={i}
                            className={`flex-none border-r border-gray-50 flex flex-col items-center justify-center ${weekend ? "bg-gray-50" : ""} ${today ? "bg-blue-50" : ""}`}
                            style={{ width: dayWidth }}>
                            {dayWidth >= 28 && (
                              <span className={`text-[10px] ${today ? "text-blue-600" : weekend ? "text-gray-300" : "text-gray-400"}`}>
                                {format(day, "EEE").substring(0, 1)}
                              </span>
                            )}
                            <span className={`text-[10px] font-semibold ${today ? "text-blue-600" : weekend ? "text-gray-400" : "text-gray-600"}`}>
                              {format(day, "d")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    // Condensed month header for long views
                    <div className="relative h-8 border-b border-gray-100 flex" style={{ width: Math.max(timelineWidth, 100) }}>
                      {(() => {
                        // Group days by month
                        const monthGroups: { label: string; startIdx: number; count: number }[] = [];
                        days.forEach((day, i) => {
                          const label = format(day, "MMM yyyy");
                          const last = monthGroups[monthGroups.length - 1];
                          if (last && last.label === label) { last.count++; }
                          else monthGroups.push({ label, startIdx: i, count: 1 });
                        });
                        return monthGroups.map((grp) => (
                          <div key={grp.startIdx}
                            className="absolute flex items-center justify-center border-r border-gray-200 bg-gray-50"
                            style={{ left: grp.startIdx * dayWidth, width: grp.count * dayWidth, height: "100%" }}>
                            <span className="text-[10px] font-semibold text-gray-600 px-1 truncate">{grp.label}</span>
                          </div>
                        ));
                      })()}
                    </div>
                  )}

                  {/* Grid body */}
                  <div
                    className="relative"
                    style={{ height: ROW_HEIGHT * jobsWithPhases.length, width: Math.max(timelineWidth, 100) }}
                  >
                    {/* Weekend shading */}
                    {days.map((day, i) =>
                      isWeekend(day) ? (
                        <div key={i} className="absolute top-0 bottom-0 bg-gray-50/60 pointer-events-none" style={{ left: i * dayWidth, width: dayWidth }} />
                      ) : null
                    )}

                    {/* Today line */}
                    {showToday && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-blue-400/60 pointer-events-none"
                        style={{ left: todayOffset * dayWidth, zIndex: 6 }}
                      />
                    )}

                    {/* Row dividers + bars */}
                    {jobsWithPhases.map((job, rowIdx) => {
                      const rowTop = rowIdx * ROW_HEIGHT;
                      const barTop = rowTop + (ROW_HEIGHT - BAR_HEIGHT) / 2;
                      const datedPhases = job.phases.filter((p) => p.startDate && p.endDate);
                      const undatedPhases = job.phases.filter((p) => !p.startDate || !p.endDate);

                      return (
                        <div key={job.id}>
                          <div
                            className="absolute left-0 right-0 border-b border-gray-100 pointer-events-none"
                            style={{ top: rowTop, height: ROW_HEIGHT, backgroundColor: job.color + "08" }}
                          />

                          {datedPhases.map((phase) => {
                            const overrideDates = optimisticDates[phase.id];
                            const bar = getBarStyle(phase, overrideDates);
                            if (!bar) return null;

                            const workers = phase.schedules.map((s) => s.user);
                            const primaryWorker = workers[0] ?? null;
                            const barColor = primaryWorker ? getUserColor(primaryWorker.id, allWorkers) : "#cbd5e1";
                            const extraWorkers = workers.slice(1);
                            return (
                              <div
                                key={phase.id}
                                className="absolute rounded text-white text-xs font-medium shadow-sm overflow-hidden flex items-center gap-1 px-1.5 cursor-pointer hover:opacity-90 transition-opacity"
                                style={{
                                  top: barTop,
                                  left: bar.left,
                                  width: Math.max(bar.width, 4),
                                  height: BAR_HEIGHT,
                                  backgroundColor: barColor,
                                  zIndex: 8,
                                }}
                                onMouseEnter={(e) => handleBarMouseEnter(e, phase, job)}
                                onMouseLeave={() => setTooltip(null)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const eff = optimisticDates[phase.id];
                                  setEditModal({
                                    phase, jobId: job.id, jobName: job.name,
                                    startDate: eff?.startDate ?? phase.startDate ?? "",
                                    endDate: eff?.endDate ?? phase.endDate ?? "",
                                    completion: phase.completion ?? 0,
                                    assignedUserIds: new Set(),
                                    saving: false, error: "",
                                  });
                                }}
                              >
                                {bar.width > 50 && (
                                  <span className="truncate text-[11px] font-semibold drop-shadow-sm">
                                    {phase.name}
                                  </span>
                                )}
                                {bar.width > 80 && extraWorkers.slice(0, 3).map((w) => (
                                  <span
                                    key={w.id}
                                    className="shrink-0 text-[9px] font-bold rounded-full px-1 py-0.5 leading-none"
                                    style={{ backgroundColor: "rgba(0,0,0,0.25)" }}
                                    title={w.name}
                                  >
                                    {getInitials(w.name)}
                                  </span>
                                ))}
                              </div>
                            );
                          })}

                          {undatedPhases.length > 0 && (
                            <div
                              className="absolute left-0 right-0 flex items-center gap-1 px-2 opacity-40 pointer-events-none"
                              style={{ top: rowTop + ROW_HEIGHT - 10, height: 8 }}
                            >
                              {undatedPhases.map((p) => (
                                <div key={p.id} className="h-1.5 rounded-full bg-slate-300 flex-1 min-w-0" title={`${p.name} (no dates)`} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Edit dates modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4">
              <h3 className="font-semibold text-gray-900 text-base">{editModal.phase.name}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{editModal.jobName}</p>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                <input type="date" value={editModal.startDate}
                  onChange={(e) => {
                    const start = e.target.value;
                    const dur = durationFromDates(editModal.startDate, editModal.endDate);
                    const newEnd = dur && start ? endFromDuration(start, dur) : editModal.endDate;
                    setEditModal((m) => m ? { ...m, startDate: start, endDate: newEnd } : null);
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Duration (days)</label>
                <select
                  value={durationFromDates(editModal.startDate, editModal.endDate) ?? ""}
                  onChange={(e) => {
                    const d = Number(e.target.value);
                    if (d && editModal.startDate) setEditModal((m) => m ? { ...m, endDate: endFromDuration(m.startDate, d) } : null);
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— custom —</option>
                  {DURATION_OPTIONS.map((d) => <option key={d} value={d}>{d} day{d !== 1 ? "s" : ""}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                <input type="date" value={editModal.endDate}
                  onChange={(e) => setEditModal((m) => m ? { ...m, endDate: e.target.value } : null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Completion</label>
                <select value={editModal.completion}
                  onChange={(e) => setEditModal((m) => m ? { ...m, completion: parseInt(e.target.value) } : null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {[0,10,20,25,30,40,50,60,70,75,80,90,95,100].map((v) => (
                    <option key={v} value={v}>{v === 100 ? "✓ Complete (100%)" : `${v}%`}</option>
                  ))}
                </select>
              </div>
              {data && data.allWorkers.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Assign People <span className="text-gray-400">(optional)</span></label>
                  <div className="space-y-1 max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2">
                    {data.allWorkers.map((w) => (
                      <label key={w.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                        <input
                          type="checkbox"
                          checked={editModal.assignedUserIds.has(w.id)}
                          onChange={() => setEditModal((m) => {
                            if (!m) return null;
                            const next = new Set(m.assignedUserIds);
                            if (next.has(w.id)) next.delete(w.id); else next.add(w.id);
                            return { ...m, assignedUserIds: next };
                          })}
                          className="rounded border-gray-300 text-blue-600"
                        />
                        <span className="text-xs text-gray-700">{w.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            {editModal.error && <p className="text-xs text-red-500 mb-3">{editModal.error}</p>}
            <div className="flex gap-2 mb-2">
              <button onClick={saveEditModal} disabled={editModal.saving || !editModal.startDate || !editModal.endDate}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50">
                {editModal.saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditModal(null)}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
            <PhaseModalTabs phaseId={editModal.phase.id} jobId={editModal.jobId} />
          </div>
        </div>
      )}

      {/* ── Hover Tooltip ──────────────────────────────────────────────────────────── */}
      {tooltip && (
        <div
          className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 p-4 w-72 pointer-events-none"
          style={{
            top: Math.min(tooltip.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 240),
            left: Math.min(tooltip.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 300),
          }}
        >
          <div className="mb-1">
            <h4 className="font-semibold text-gray-900 text-sm">{tooltip.phase.name}</h4>
            <p className="text-xs text-blue-600 font-medium">{tooltip.job.name}</p>
          </div>

          {tooltip.phase.description && (
            <p className="text-xs text-gray-500 mb-2">{tooltip.phase.description}</p>
          )}

          {tooltip.phase.startDate && tooltip.phase.endDate ? (
            <div className="text-xs text-gray-700 space-y-1 mb-2">
              <div className="flex justify-between">
                <span className="text-gray-500">Start</span>
                <span className="font-medium">{format(parseDate(tooltip.phase.startDate), "MMM d, yyyy")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">End</span>
                <span className="font-medium">{format(parseDate(tooltip.phase.endDate), "MMM d, yyyy")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Duration</span>
                <span className="font-medium">
                  {differenceInDays(parseDate(tooltip.phase.endDate), parseDate(tooltip.phase.startDate)) + 1}d
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic mb-2">No dates set</p>
          )}

          {tooltip.phase.schedules.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Assigned</p>
              <div className="flex flex-col gap-1">
                {tooltip.phase.schedules.map((s) => (
                  <div key={s.user.id} className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: data ? getUserColor(s.user.id, data.allWorkers) : "#94a3b8" }}
                    />
                    <span className="text-xs text-gray-700">{s.user.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No workers assigned</p>
          )}
          <p className="text-xs text-gray-400 mt-2 italic">Click bar to edit dates</p>
        </div>
      )}
    </Layout>
  );
}
