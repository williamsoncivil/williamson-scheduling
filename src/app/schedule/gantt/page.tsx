"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Layout from "@/components/Layout";
import Link from "next/link";
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

interface Phase {
  id: string;
  name: string;
  description: string | null;
  orderIndex: number;
  startDate: string | null;
  endDate: string | null;
  dependsOnId: string | null;
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
  const start = parseISO(phase.startDate);
  const end = parseISO(phase.endDate);
  if (end < now) return "#22c55e";
  if (start <= now && end >= now) return "#3b82f6";
  return "#94a3b8";
}

export default function MasterGanttPage() {
  const [jobs, setJobs] = useState<JobWithPhases[]>([]);
  const [loading, setLoading] = useState(true);
  const [popover, setPopover] = useState<{ phase: Phase; jobName: string; x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [optimisticDates, setOptimisticDates] = useState<Record<string, { startDate: string; endDate: string }>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // ── Mouse-drag state ──────────────────────────────────────────────────────
  const dragDataRef = useRef<{
    phaseId: string;
    startDate: string;
    endDate: string;
    durationDays: number;
    startMouseX: number;
    barTop: number;
    barColor: string;
  } | null>(null);
  const isDraggingRef = useRef(false);
  const dayWidthRef = useRef(DAY_WIDTH);

  const [dragPhaseId, setDragPhaseId] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<{
    left: number; width: number; top: number; color: string;
  } | null>(null);
  const [dragCursorTooltip, setDragCursorTooltip] = useState<{
    x: number; y: number; newStart: Date; newEnd: Date;
  } | null>(null);

  // Continuous timeline range
  const viewStart = startOfWeek(subWeeks(new Date(), WEEKS_BEFORE), { weekStartsOn: 0 });
  const viewEnd = addDays(addWeeks(viewStart, WEEKS_BEFORE + WEEKS_AFTER), -1);
  const days = eachDayOfInterval({ start: viewStart, end: viewEnd });
  const totalDays = days.length;
  const timelineWidth = totalDays * DAY_WIDTH;

  const todayOffset = differenceInDays(new Date(), viewStart);
  const todayPx = todayOffset * DAY_WIDTH;

  // Stable refs for values used inside window event handlers
  const viewStartRef = useRef(viewStart);
  const totalDaysRef = useRef(totalDays);

  // Keep stable refs in sync after every render
  useEffect(() => {
    viewStartRef.current = viewStart;
    totalDaysRef.current = totalDays;
  });

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

  // ── Window mouse event handlers (mouse-based drag) ──────────────────────────
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragDataRef.current;
      if (!drag || !scrollRef.current) return;

      const dw = dayWidthRef.current;
      const vs = viewStartRef.current;
      const td = totalDaysRef.current;

      // Re-fetch rect on every mousemove so scroll changes are always current
      const containerRect = scrollRef.current.getBoundingClientRect();
      const scrollLeft = scrollRef.current.scrollLeft;
      // scrollRef includes the sidebar, so subtract SIDEBAR_WIDTH from the offset
      const relativeX = e.clientX - containerRect.left + scrollLeft - SIDEBAR_WIDTH;
      const dayIndex = Math.max(0, Math.min(Math.floor(relativeX / dw), td - 1));

      const newStart = addDays(vs, dayIndex);
      const newEnd = addDays(newStart, drag.durationDays);

      setDragGhost({
        left: dayIndex * dw,
        width: (drag.durationDays + 1) * dw,
        top: drag.barTop,
        color: drag.barColor,
      });
      setDragCursorTooltip({ x: e.clientX, y: e.clientY, newStart, newEnd });
    };

    const handleMouseUp = async (e: MouseEvent) => {
      const drag = dragDataRef.current;
      if (!drag) return;

      const deltaX = e.clientX - drag.startMouseX;

      // Clear drag state synchronously
      dragDataRef.current = null;
      isDraggingRef.current = false;
      setDragPhaseId(null);
      setDragGhost(null);
      setDragCursorTooltip(null);

      // Ignore tiny moves (click vs drag threshold)
      if (Math.abs(deltaX) < 5) return;
      if (!scrollRef.current) return;

      const dw = dayWidthRef.current;
      const vs = viewStartRef.current;
      const td = totalDaysRef.current;

      const containerRect = scrollRef.current.getBoundingClientRect();
      const scrollLeft = scrollRef.current.scrollLeft;
      const relativeX = e.clientX - containerRect.left + scrollLeft - SIDEBAR_WIDTH;
      const dayIndex = Math.max(0, Math.min(Math.floor(relativeX / dw), td - 1));

      const newStart = addDays(vs, dayIndex);
      const newEnd = addDays(newStart, drag.durationDays);
      const newStartStr = format(newStart, "yyyy-MM-dd");
      const newEndStr = format(newEnd, "yyyy-MM-dd");

      // Don't make the API call if the date hasn't actually changed
      if (newStartStr === drag.startDate && newEndStr === drag.endDate) return;

      // Optimistic update
      setOptimisticDates((prev) => ({
        ...prev,
        [drag.phaseId]: { startDate: newStartStr, endDate: newEndStr },
      }));

      setSaving(true);
      try {
        await fetch(`/api/phases/${drag.phaseId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate: newStartStr, endDate: newEndStr }),
        });
        fetchData();
      } finally {
        setSaving(false);
        setOptimisticDates((prev) => {
          const next = { ...prev };
          delete next[drag.phaseId];
          return next;
        });
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [fetchData]);

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
    const start = parseISO(sd);
    const end = parseISO(ed);
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

  const rows: RowItem[] = [];
  visibleJobs.forEach((job) => {
    rows.push({ type: "job-header", job, rowIndex: rows.length });
    job.phases.forEach((phase) => {
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
  const getDependencyLines = () => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    rows.forEach((row, rowIdx) => {
      if (row.type !== "phase") return;
      const { phase } = row;
      if (!phase.dependsOnId) return;
      const parentRowIdx = rows.findIndex(
        (r) => r.type === "phase" && r.phase.id === phase.dependsOnId
      );
      if (parentRowIdx < 0) return;
      const parentRow = rows[parentRowIdx];
      if (parentRow.type !== "phase") return;
      const childBar = getBarStyle(phase);
      const parentBar = getBarStyle(parentRow.phase);
      if (!childBar || !parentBar) return;
      const parentY = rowYPositions[parentRowIdx] + ROW_HEIGHT / 2;
      const childY = rowYPositions[rowIdx] + ROW_HEIGHT / 2;
      lines.push({
        x1: parentBar.left + parentBar.width,
        y1: parentY,
        x2: childBar.left,
        y2: childY,
      });
    });
    return lines;
  };

  // ── Mouse-down on phase bar: start drag ──────────────────────────────────────
  const handleBarMouseDown = (
    e: React.MouseEvent,
    phase: Phase,
    barTop: number,
    barColor: string,
  ) => {
    if (!phase.startDate || !phase.endDate) return;
    e.preventDefault();
    e.stopPropagation();
    setPopover(null);

    const durationDays = differenceInDays(parseISO(phase.endDate), parseISO(phase.startDate));

    dragDataRef.current = {
      phaseId: phase.id,
      startDate: phase.startDate,
      endDate: phase.endDate,
      durationDays,
      startMouseX: e.clientX,
      barTop,
      barColor,
    };
    isDraggingRef.current = true;
    setDragPhaseId(phase.id);
  };

  const handleBarClick = (e: React.MouseEvent, phase: Phase, jobName: string) => {
    if (isDraggingRef.current) return;
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopover({ phase, jobName, x: rect.left, y: rect.bottom + 8 });
  };

  if (loading) {
    return (
      <Layout>
        <div className="p-6 text-gray-400">Loading master Gantt...</div>
      </Layout>
    );
  }

  const depLines = getDependencyLines();
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
            {saving && <span className="text-xs text-blue-600 animate-pulse">Saving…</span>}
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
              style={{ maxHeight: "calc(100vh - 260px)", position: "relative" }}
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
                                {format(parseISO(row.phase.startDate), "M/d")} – {format(parseISO(row.phase.endDate), "M/d")}
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

                    {/* Dependency arrows */}
                    {depLines.length > 0 && (
                      <svg
                        className="absolute inset-0 pointer-events-none"
                        style={{ width: timelineWidth, height: totalHeight }}
                      >
                        {depLines.map((line, i) => {
                          const midX = line.x1 + 16;
                          const path = `M ${line.x1} ${line.y1} H ${midX} V ${line.y2} H ${line.x2}`;
                          return (
                            <path
                              key={i}
                              d={path}
                              fill="none"
                              stroke="#6366f1"
                              strokeWidth="1.5"
                              strokeDasharray="4 2"
                              opacity="0.6"
                            />
                          );
                        })}
                        {depLines.map((line, i) => (
                          <polygon
                            key={`arrow-${i}`}
                            points={`${line.x2},${line.y2} ${line.x2 - 5},${line.y2 - 3} ${line.x2 - 5},${line.y2 + 3}`}
                            fill="#6366f1"
                            opacity="0.6"
                          />
                        ))}
                      </svg>
                    )}

                    {/* Ghost bar (drag preview) */}
                    {dragGhost && (
                      <div
                        className="absolute rounded border-2 border-blue-400 pointer-events-none"
                        style={{
                          top: dragGhost.top,
                          left: dragGhost.left,
                          width: Math.max(dragGhost.width, 4),
                          height: BAR_HEIGHT,
                          backgroundColor: dragGhost.color + "40",
                          zIndex: 12,
                        }}
                      />
                    )}

                    {/* Phase bars */}
                    {rows.map((row, i) => {
                      if (row.type !== "phase") return null;
                      const { phase, job } = row;
                      const overrideDates = optimisticDates[phase.id];
                      const bar = getBarStyle(phase, overrideDates);
                      const rowTop = rowYPositions[i];
                      const barTop = rowTop + (ROW_HEIGHT - BAR_HEIGHT) / 2;
                      if (!bar) return null;
                      const isBeingDragged = dragPhaseId === phase.id;

                      return (
                        <div
                          key={phase.id}
                          onMouseDown={(e) => handleBarMouseDown(e, phase, barTop, bar.color)}
                          onClick={(e) => handleBarClick(e, phase, job.name)}
                          onMouseEnter={(e) => {
                            if (!isDraggingRef.current) {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setPopover({ phase, jobName: job.name, x: rect.left, y: rect.bottom + 8 });
                            }
                          }}
                          onMouseLeave={() => { if (!isDraggingRef.current) setPopover(null); }}
                          className={`absolute rounded flex items-center px-1.5 text-white text-xs font-medium shadow-sm overflow-hidden select-none transition-opacity ${
                            isBeingDragged
                              ? "opacity-40 cursor-grabbing"
                              : "cursor-grab hover:opacity-90"
                          }`}
                          style={{
                            top: barTop,
                            left: bar.left,
                            width: Math.max(bar.width, 4),
                            height: BAR_HEIGHT,
                            backgroundColor: bar.color,
                            zIndex: isBeingDragged ? 4 : 8,
                          }}
                        >
                          {bar.width > 40 && <span className="truncate">{phase.name}</span>}
                        </div>
                      );
                    })}
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
              <span className="text-xs text-gray-400 italic">Drag bars to reschedule</span>
            </div>
          </div>
        )}
      </div>

      {/* Drag cursor tooltip (floating near mouse) */}
      {dragCursorTooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-gray-900 text-white text-xs px-3 py-1.5 rounded-lg shadow-lg whitespace-nowrap"
          style={{
            top: dragCursorTooltip.y - 48,
            left: dragCursorTooltip.x + 14,
          }}
        >
          → {format(dragCursorTooltip.newStart, "MMM d")} – {format(dragCursorTooltip.newEnd, "MMM d, yyyy")}
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
                <span className="font-medium">{format(parseISO(popover.phase.startDate), "MMM d, yyyy")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">End</span>
                <span className="font-medium">{format(parseISO(popover.phase.endDate), "MMM d, yyyy")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Duration</span>
                <span className="font-medium">
                  {differenceInDays(parseISO(popover.phase.endDate), parseISO(popover.phase.startDate)) + 1}d
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
