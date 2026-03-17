"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Layout from "@/components/Layout";
import { PhaseModalTabs } from "@/components/PhaseModalTabs";
import Link from "next/link";
const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 28, 30, 45, 60, 90];

/** Strip time component so UTC dates don't shift by a day in local timezone */
const parseDate = (dateStr: string) => parseISO(dateStr.split("T")[0]);

/** Add N business days (skip weekends), returns yyyy-MM-dd */
function endFromDuration(start: string, days: number): string {
  try {
    let d = parseDate(start);
    // Skip to weekday if start is weekend
    while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
    let remaining = days - 1;
    while (remaining > 0) {
      d = addDays(d, 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) remaining--;
    }
    return format(d, "yyyy-MM-dd");
  }
  catch { return ""; }
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
  }
  catch { return null; }
}

import {
  format,
  parseISO,
  differenceInDays,
  addDays,
  addWeeks,
  subWeeks,
  startOfWeek,
  eachDayOfInterval,
  isWeekend,
  isSameDay,
} from "date-fns";

interface PhaseDep {
  predecessorId: string;
  type: string;
  lagDays: number;
}

interface Phase {
  id: string;
  name: string;
  description: string | null;
  orderIndex: number;
  startDate: string | null;
  endDate: string | null;
  dependsOnId: string | null;
  completion: number;
  successorDeps?: PhaseDep[]; // deps where this phase IS the successor (tells us its predecessors)
}

interface Worker {
  id: string;
  name: string;
}

interface JobWithPhases {
  id: string;
  name: string;
  address: string;
  color: string;
  status: string;
  phases: Phase[];
  visible: boolean;
}

const ROW_HEIGHT = 44;
const JOB_HEADER_HEIGHT = 36;
const BAR_HEIGHT = 26;
const SIDEBAR_WIDTH = 220;
const DAY_WIDTH = 20; // px per day — fixed for continuous scroll

// Total continuous range: 26 weeks before today → 26 weeks after today (52 weeks)
const WEEKS_BEFORE = 8;
const WEEKS_AFTER = 44;

function getPhaseColor(phase: Phase): string {
  if (!phase.startDate || !phase.endDate) return "#94a3b8";
  const now = new Date();
  const start = parseDate(phase.startDate);
  const end = parseDate(phase.endDate);
  if (end < now) return "#22c55e";
  if (start <= now && end >= now) return "#3b82f6";
  return "#94a3b8";
}

export default function MasterGanttPage() {
  const [jobs, setJobs] = useState<JobWithPhases[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [popover, setPopover] = useState<{ phase: Phase; jobName: string; x: number; y: number } | null>(null);
  const [optimisticDates, setOptimisticDates] = useState<Record<string, { startDate: string; endDate: string }>>({});
  const [editModal, setEditModal] = useState<{
    phase: Phase; jobId: string; jobName: string;
    startDate: string; endDate: string;
    completion: number;
    assignedUserIds: Set<string>;
    saving: boolean; error: string;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // Continuous timeline range
  const viewStart = startOfWeek(subWeeks(new Date(), WEEKS_BEFORE), { weekStartsOn: 0 });
  const viewEnd = addDays(addWeeks(viewStart, WEEKS_BEFORE + WEEKS_AFTER), -1);
  const days = eachDayOfInterval({ start: viewStart, end: viewEnd });
  const totalDays = days.length;
  const timelineWidth = totalDays * DAY_WIDTH;

  const todayOffset = differenceInDays(new Date(), viewStart);
  const todayPx = todayOffset * DAY_WIDTH;

  const fetchData = useCallback(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then(async (jobList: JobWithPhases[]) => {
        const activeJobs = jobList.filter((j) => j.status === "ACTIVE");
        const withPhases = await Promise.all(
          activeJobs.map(async (job) => {
            const phases = await fetch(`/api/jobs/${job.id}/phases`).then((r) => r.json());
            return { ...job, phases, visible: true };
          })
        );
        setJobs(withPhases);
        setLoading(false);
      });
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetch("/api/people").then((r) => r.json()).then(setWorkers); }, []);

  // Scroll to today (centered) once data is loaded
  useEffect(() => {
    if (!loading && !hasScrolledRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const containerWidth = container.clientWidth - SIDEBAR_WIDTH;
      const scrollTarget = todayPx - containerWidth / 2;
      container.scrollLeft = Math.max(0, scrollTarget);
      hasScrolledRef.current = true;
    }
  }, [loading, todayPx]);



  const visibleJobs = jobs.filter((j) => j.visible);

  const toggleJobVisibility = (jobId: string) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, visible: !j.visible } : j)));
  };

  const scrollToToday = () => {
    if (scrollRef.current) {
      const containerWidth = scrollRef.current.clientWidth - SIDEBAR_WIDTH;
      const scrollTarget = todayPx - containerWidth / 2;
      scrollRef.current.scrollTo({ left: Math.max(0, scrollTarget), behavior: "smooth" });
    }
  };

  const getBarStyle = (phase: Phase, overrideDates?: { startDate: string; endDate: string }) => {
    const sd = overrideDates?.startDate ?? phase.startDate;
    const ed = overrideDates?.endDate ?? phase.endDate;
    if (!sd || !ed) return null;
    const start = parseDate(sd);
    const end = parseDate(ed);
    const leftDays = differenceInDays(start, viewStart);
    const widthDays = Math.max(differenceInDays(end, start) + 1, 1);
    return {
      left: leftDays * DAY_WIDTH,
      width: widthDays * DAY_WIDTH,
      color: getPhaseColor(phase),
    };
  };

  // Month labels for the header
  const getMonthLabels = () => {
    const labels: { label: string; left: number }[] = [];
    let lastMonth = -1;
    days.forEach((day, i) => {
      if (day.getMonth() !== lastMonth) {
        labels.push({ label: format(day, "MMM yyyy"), left: i * DAY_WIDTH });
        lastMonth = day.getMonth();
      }
    });
    return labels;
  };

  // Build flat rows
  type RowItem =
    | { type: "job-header"; job: JobWithPhases; rowIndex: number }
    | { type: "phase"; phase: Phase; job: JobWithPhases; rowIndex: number };

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const rows: RowItem[] = [];
  visibleJobs.forEach((job) => {
    rows.push({ type: "job-header", job, rowIndex: rows.length });
    job.phases.forEach((phase) => {
      // Hide phases that are 100% complete AND ended more than 1 week ago
      if ((phase.completion ?? 0) >= 100 && phase.endDate) {
        const endDate = parseDate(phase.endDate);
        if (endDate < oneWeekAgo) return;
      }
      rows.push({ type: "phase", phase, job, rowIndex: rows.length });
    });
  });

  const totalHeight = rows.reduce((acc, row) => {
    return acc + (row.type === "job-header" ? JOB_HEADER_HEIGHT : ROW_HEIGHT);
  }, 0);

  const rowYPositions: number[] = [];
  let currentY = 0;
  rows.forEach((row) => {
    rowYPositions.push(currentY);
    currentY += row.type === "job-header" ? JOB_HEADER_HEIGHT : ROW_HEIGHT;
  });

  // Dependency arrows
  interface DepArrow { x1: number; y1: number; x2: number; y2: number; forward: boolean }
  const getDependencyArrows = (): DepArrow[] => {
    const arrows: DepArrow[] = [];
    rows.forEach((row, rowIdx) => {
      if (row.type !== "phase") return;
      const { phase } = row;
      const deps = phase.successorDeps ?? (phase.dependsOnId ? [{ predecessorId: phase.dependsOnId, type: "FINISH_TO_START", lagDays: 0 }] : []);
      deps.forEach((dep) => {
        const predRowIdx = rows.findIndex((r) => r.type === "phase" && r.phase.id === dep.predecessorId);
        if (predRowIdx < 0) return;
        const predRow = rows[predRowIdx];
        if (predRow.type !== "phase") return;
        const succBar = getBarStyle(phase);
        const predBar = getBarStyle(predRow.phase);
        if (!succBar || !predBar) return;
        const predY = rowYPositions[predRowIdx] + ROW_HEIGHT / 2;
        const succY = rowYPositions[rowIdx] + ROW_HEIGHT / 2;
        arrows.push({
          x1: predBar.left + predBar.width, // end of predecessor
          y1: predY,
          x2: succBar.left,                  // start of successor
          y2: succY,
          forward: rowIdx > predRowIdx,
        });
      });
    });
    return arrows;
  };

  const handleBarClick = (e: React.MouseEvent, phase: Phase, job: JobWithPhases) => {
    e.stopPropagation();
    setPopover(null);
    const eff = optimisticDates[phase.id];
    setEditModal({
      phase,
      jobId: job.id,
      jobName: job.name,
      startDate: eff?.startDate ?? phase.startDate ?? "",
      endDate: eff?.endDate ?? phase.endDate ?? "",
      completion: phase.completion ?? 0,
      assignedUserIds: new Set(),
      saving: false,
      error: "",
    });
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
      setEditModal((m) => m ? { ...m, saving: false, error: "Failed to save — please try again" } : null);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="p-6 text-gray-400">Loading master Gantt...</div>
      </Layout>
    );
  }

  const depArrows = getDependencyArrows();
  const monthLabels = getMonthLabels();

  // Header heights for sticky top positioning
  const MONTH_ROW_HEIGHT = 20; // h-5 = 20px
  const DAY_ROW_HEIGHT = 40;   // h-10 = 40px
  const HEADER_HEIGHT = MONTH_ROW_HEIGHT + DAY_ROW_HEIGHT;

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-full" onClick={() => setPopover(null)}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Master Gantt Chart</h1>
            <p className="text-sm text-gray-500 mt-0.5">All active jobs · scroll to navigate · {WEEKS_BEFORE + WEEKS_AFTER} week range</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={scrollToToday}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              📍 Jump to Today
            </button>

            <Link
              href="/schedule"
              className="px-3 py-2 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 text-gray-600"
            >
              ← Calendar View
            </Link>

            <Link
              href="/schedule/timeline"
              className="px-3 py-2 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 text-gray-600"
            >
              Timeline →
            </Link>
          </div>
        </div>

        {/* Job filter */}
        <div className="flex gap-2 flex-wrap mb-4">
          <span className="text-xs font-medium text-gray-500 self-center">Show/hide:</span>
          {jobs.map((job) => (
            <button
              key={job.id}
              onClick={() => toggleJobVisibility(job.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                job.visible
                  ? "border-transparent text-white"
                  : "border-gray-300 text-gray-500 bg-white"
              }`}
              style={job.visible ? { backgroundColor: job.color } : {}}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: job.visible ? "white" : job.color }}
              />
              {job.name}
            </button>
          ))}
        </div>

        {visibleJobs.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
            No active jobs to display
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm">
            {/*
              ── 2D scroll container ─────────────────────────────────────────────
              overflow: auto on both axes. Children use position:sticky for
              both horizontal (left) and vertical (top) pinning.
            */}
            <div
              ref={scrollRef}
              className="overflow-auto"
              style={{ maxHeight: "calc(100vh - 260px)", position: "relative", cursor: "grab" }}
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest("button,select,input,a")) return;
                const el = scrollRef.current;
                if (!el) return;
                e.preventDefault();
                const startX = e.pageX + el.scrollLeft;
                const startY = e.pageY + el.scrollTop;
                el.style.cursor = "grabbing";
                const onMove = (me: MouseEvent) => { el.scrollLeft = startX - me.pageX; el.scrollTop = startY - me.pageY; };
                const onUp = () => { el.style.cursor = "grab"; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            >
              {/* Inner wrapper: explicit full width so sticky left works */}
              <div style={{ width: SIDEBAR_WIDTH + timelineWidth, minWidth: SIDEBAR_WIDTH + timelineWidth }}>

                {/* ── Sticky header row (top: 0) ────────────────────────────── */}
                <div
                  className="flex"
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 30,
                    width: SIDEBAR_WIDTH + timelineWidth,
                  }}
                >
                  {/* Corner cell: sticky left AND part of sticky top row */}
                  <div
                    className="shrink-0 border-r border-b border-gray-200 bg-white"
                    style={{
                      width: SIDEBAR_WIDTH,
                      position: "sticky",
                      left: 0,
                      zIndex: 40,
                    }}
                  >
                    <div className="h-5 bg-gray-50 border-b border-gray-100 flex items-center px-3">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Month</span>
                    </div>
                    <div className="h-10 flex items-center px-3">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Job / Phase</span>
                    </div>
                  </div>

                  {/* Date headers column */}
                  <div
                    className="shrink-0 bg-white"
                    style={{ width: timelineWidth }}
                  >
                    {/* Month labels row */}
                    <div className="relative h-5 border-b border-gray-100 bg-gray-50" style={{ width: timelineWidth }}>
                      {monthLabels.map((ml, i) => (
                        <div
                          key={i}
                          className="absolute top-0 h-full flex items-center border-l border-gray-200"
                          style={{ left: ml.left }}
                        >
                          <span className="text-[10px] font-semibold text-gray-500 px-1 bg-gray-50 whitespace-nowrap">
                            {ml.label}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Day headers row */}
                    <div className="relative h-10 border-b border-gray-100 flex bg-white" style={{ width: timelineWidth }}>
                      {days.map((day, i) => {
                        const isWeekendDay = isWeekend(day);
                        const isToday = isSameDay(day, new Date());
                        const showLabel = day.getDay() === 1 || DAY_WIDTH >= 28;
                        return (
                          <div
                            key={i}
                            className={`flex-none border-r border-gray-50 flex flex-col items-center justify-center ${isWeekendDay ? "bg-gray-50" : ""} ${isToday ? "bg-blue-50" : ""}`}
                            style={{ width: DAY_WIDTH }}
                          >
                            {showLabel && DAY_WIDTH >= 18 && (
                              <span className={`text-[9px] font-semibold leading-none ${isToday ? "text-blue-600" : isWeekendDay ? "text-gray-400" : "text-gray-500"}`}>
                                {format(day, "d")}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {/* ── End sticky header ─────────────────────────────────────── */}

                {/* ── Body row (sidebar + timeline) ─────────────────────────── */}
                <div className="flex" style={{ width: SIDEBAR_WIDTH + timelineWidth }}>

                  {/* ── Sticky left sidebar ───────────────────────────────────── */}
                  <div
                    className="shrink-0 border-r border-gray-200 bg-white"
                    style={{
                      width: SIDEBAR_WIDTH,
                      position: "sticky",
                      left: 0,
                      zIndex: 20,
                    }}
                  >
                    {/* Rows */}
                    {rows.map((row, i) => {
                      if (row.type === "job-header") {
                        return (
                          <div
                            key={`job-${row.job.id}`}
                            className="flex items-center px-3 border-b border-gray-200"
                            style={{ height: JOB_HEADER_HEIGHT, backgroundColor: row.job.color + "18" }}
                          >
                            <div className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: row.job.color }} />
                            <Link
                              href={`/jobs/${row.job.id}`}
                              className="text-xs font-bold text-gray-900 hover:underline truncate"
                            >
                              {row.job.name}
                            </Link>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={`phase-${row.phase.id}`}
                          className="flex items-center px-3 pl-6 border-b border-gray-50"
                          style={{ height: ROW_HEIGHT }}
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-800 truncate">{row.phase.name}</p>
                            {row.phase.startDate && row.phase.endDate && (
                              <p className="text-[10px] text-gray-400 truncate">
                                {format(parseDate(row.phase.startDate), "M/d")} – {format(parseDate(row.phase.endDate), "M/d")}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Timeline area ────────────────────────────────────────── */}
                  <div className="shrink-0 relative" style={{ width: timelineWidth, height: totalHeight }}>

                    {/* Weekend shading */}
                    {days.map((day, i) =>
                      isWeekend(day) ? (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 bg-gray-50/80 pointer-events-none"
                          style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
                        />
                      ) : null
                    )}

                    {/* Today line */}
                    {todayOffset >= 0 && todayOffset <= totalDays && (
                      <div
                        className="absolute top-0 bottom-0 pointer-events-none"
                        style={{ left: todayPx, zIndex: 10, width: 2, backgroundColor: "rgba(59,130,246,0.7)" }}
                      />
                    )}

                    {/* Today column highlight */}
                    {todayOffset >= 0 && todayOffset <= totalDays && (
                      <div
                        className="absolute top-0 bottom-0 bg-blue-50/40 pointer-events-none"
                        style={{ left: todayPx, width: DAY_WIDTH }}
                      />
                    )}

                    {/* Job header row backgrounds */}
                    {rows.map((row, i) => {
                      if (row.type !== "job-header") return null;
                      return (
                        <div
                          key={`job-bg-${row.job.id}`}
                          className="absolute left-0 right-0 border-b border-gray-200 pointer-events-none"
                          style={{
                            top: rowYPositions[i],
                            height: JOB_HEADER_HEIGHT,
                            backgroundColor: row.job.color + "12",
                          }}
                        />
                      );
                    })}

                    {/* Row dividers for phases */}
                    {rows.map((row, i) => {
                      if (row.type !== "phase") return null;
                      return (
                        <div
                          key={`divider-${i}`}
                          className="absolute left-0 right-0 border-b border-gray-50 pointer-events-none"
                          style={{ top: rowYPositions[i] + ROW_HEIGHT - 1 }}
                        />
                      );
                    })}

                    {/* Phase bars */}
                    {rows.map((row, i) => {
                      if (row.type !== "phase") return null;
                      const { phase, job } = row;
                      const overrideDates = optimisticDates[phase.id];
                      const bar = getBarStyle(phase, overrideDates);
                      const rowTop = rowYPositions[i];
                      const barTop = rowTop + (ROW_HEIGHT - BAR_HEIGHT) / 2;
                      if (!bar) return null;

                      return (
                        <div
                          key={phase.id}
                          onClick={(e) => handleBarClick(e, phase, job)}
                          onMouseEnter={(e) => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setPopover({ phase, jobName: job.name, x: rect.left, y: rect.bottom + 8 });
                          }}
                          onMouseLeave={() => setPopover(null)}
                          className="absolute rounded flex items-center px-1.5 text-white text-xs font-medium shadow-sm overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                          style={{
                            top: barTop,
                            left: bar.left,
                            width: Math.max(bar.width, 4),
                            height: BAR_HEIGHT,
                            backgroundColor: bar.color,
                            zIndex: 8,
                          }}
                        >
                          {bar.width > 40 && <span className="truncate">{phase.name}</span>}
                        </div>
                      );
                    })}

                    {/* Dependency arrows — single SVG overlay, z-index above bars */}
                    <svg
                      className="pointer-events-none"
                      style={{ position: "absolute", left: 0, top: 0, width: timelineWidth, height: totalHeight, zIndex: 9 }}
                    >
                      {depArrows.map((a, i) => {
                        const stub = 16;
                        const ax = a.x2 - 5;
                        let d: string;
                        const ex = a.x1 + stub;
                        if (ax >= ex) {
                          d = `M ${a.x1} ${a.y1} H ${ex} V ${a.y2} H ${ax}`;
                        } else {
                          const midY = (a.y1 + a.y2) / 2;
                          d = `M ${a.x1} ${a.y1} H ${ex} V ${midY} H ${a.x2 - stub} V ${a.y2} H ${ax}`;
                        }
                        return (
                          <g key={i}>
                            <path d={d} fill="none" stroke="#1e293b" strokeWidth="1.5" opacity="0.45" />
                            <polygon points={`${ax},${a.y2 - 4} ${a.x2},${a.y2} ${ax},${a.y2 + 4}`} fill="#1e293b" opacity="0.55" />
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>
                {/* ── End body row ──────────────────────────────────────────── */}

              </div>
            </div>

            {/* Legend */}
            <div className="border-t border-gray-100 px-4 py-3 flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-slate-400" />
                <span className="text-xs text-gray-500">Not Started</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-blue-500" />
                <span className="text-xs text-gray-500">In Progress</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-green-500" />
                <span className="text-xs text-gray-500">Complete</span>
              </div>
              <div className="flex items-center gap-1.5 ml-auto">
                <div className="w-2 h-4 rounded-sm bg-blue-400/70" />
                <span className="text-xs text-gray-500">Today</span>
              </div>
              <span className="text-xs text-gray-400 italic">Click a bar to edit dates</span>
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
              {workers.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Assign People <span className="text-gray-400">(optional)</span></label>
                  <div className="space-y-1 max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2">
                    {workers.map((w) => (
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
              <button
                onClick={saveEditModal}
                disabled={editModal.saving || !editModal.startDate || !editModal.endDate}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {editModal.saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setEditModal(null)}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
            <PhaseModalTabs phaseId={editModal.phase.id} jobId={editModal.jobId} />
          </div>
        </div>
      )}

      {/* Hover Tooltip */}
      {popover && (
        <div
          className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 p-4 w-64 pointer-events-none"
          style={{
            top: Math.min(popover.y, window.innerHeight - 220),
            left: Math.min(popover.x, window.innerWidth - 280),
          }}
        >
          <div className="flex items-start justify-between mb-1">
            <h4 className="font-semibold text-gray-900 text-sm">{popover.phase.name}</h4>
            <button onClick={() => setPopover(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-2">×</button>
          </div>
          <p className="text-xs text-gray-400 mb-2">{popover.jobName}</p>
          {popover.phase.description && (
            <p className="text-xs text-gray-500 mb-2">{popover.phase.description}</p>
          )}
          {popover.phase.startDate && popover.phase.endDate && (
            <div className="text-xs text-gray-700 space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Start</span>
                <span className="font-medium">{format(parseDate(popover.phase.startDate), "MMM d, yyyy")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">End</span>
                <span className="font-medium">{format(parseDate(popover.phase.endDate), "MMM d, yyyy")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Duration</span>
                <span className="font-medium">
                  {differenceInDays(parseDate(popover.phase.endDate), parseDate(popover.phase.startDate)) + 1}d
                </span>
              </div>
            </div>
          )}
          {!popover.phase.startDate && (
            <p className="text-xs text-gray-400 italic">No dates set</p>
          )}
        </div>
      )}
    </Layout>
  );
}
