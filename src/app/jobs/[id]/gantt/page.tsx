"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
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
  endOfWeek,
  startOfMonth,
  endOfMonth,
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

interface Job {
  id: string;
  name: string;
  address: string;
  color: string;
  phases: Phase[];
}

type ViewMode = "week" | "month" | "wholejob";

const ROW_HEIGHT = 48;
const BAR_HEIGHT = 28;
const SIDEBAR_WIDTH = 200;

function getPhaseColor(phase: Phase): string {
  if (!phase.startDate || !phase.endDate) return "#94a3b8"; // slate — no dates
  const now = new Date();
  const start = parseISO(phase.startDate);
  const end = parseISO(phase.endDate);
  if (end < now) return "#22c55e"; // green — complete
  if (start <= now && end >= now) return "#3b82f6"; // blue — in progress
  return "#94a3b8"; // slate — not started
}

function skipWeekendDisplay(d: Date): boolean {
  return isWeekend(d);
}

export default function JobGanttPage() {
  const params = useParams();
  const jobId = params.id as string;

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [popover, setPopover] = useState<{ phase: Phase; x: number; y: number } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/jobs/${jobId}`).then((r) => r.json()),
      fetch(`/api/jobs/${jobId}/phases`).then((r) => r.json()),
    ]).then(([jobData, phasesData]) => {
      setJob({ ...jobData, phases: phasesData });
      setLoading(false);
    });
  }, [jobId]);

  const phases = job?.phases || [];

  // Compute view range
  const getViewRange = useCallback((): { viewStart: Date; viewEnd: Date; dayWidth: number } => {
    if (viewMode === "week") {
      const viewStart = startOfWeek(currentDate, { weekStartsOn: 0 });
      const viewEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
      return { viewStart, viewEnd, dayWidth: 80 };
    }
    if (viewMode === "month") {
      const viewStart = startOfMonth(currentDate);
      const viewEnd = endOfMonth(currentDate);
      return { viewStart, viewEnd, dayWidth: 32 };
    }
    // Whole job
    const datedPhases = phases.filter((p) => p.startDate && p.endDate);
    if (datedPhases.length === 0) {
      const viewStart = startOfMonth(currentDate);
      const viewEnd = endOfMonth(addWeeks(currentDate, 4));
      return { viewStart, viewEnd, dayWidth: 28 };
    }
    const starts = datedPhases.map((p) => parseISO(p.startDate!));
    const ends = datedPhases.map((p) => parseISO(p.endDate!));
    const viewStart = addDays(starts.reduce((a, b) => (a < b ? a : b)), -2);
    const viewEnd = addDays(ends.reduce((a, b) => (a > b ? a : b)), 2);
    const totalDays = Math.max(differenceInDays(viewEnd, viewStart) + 1, 1);
    const containerW = containerRef.current?.clientWidth ?? 800;
    const availableW = containerW - SIDEBAR_WIDTH;
    const dayWidth = Math.max(20, Math.floor(availableW / totalDays));
    return { viewStart, viewEnd, dayWidth };
  }, [viewMode, currentDate, phases]);

  const { viewStart, viewEnd, dayWidth } = getViewRange();
  const totalDays = Math.max(differenceInDays(viewEnd, viewStart) + 1, 1);
  const timelineWidth = totalDays * dayWidth;

  const days = eachDayOfInterval({ start: viewStart, end: viewEnd });

  const getBarStyle = (phase: Phase) => {
    if (!phase.startDate || !phase.endDate) return null;
    const start = parseISO(phase.startDate);
    const end = parseISO(phase.endDate);
    const leftDays = differenceInDays(start, viewStart);
    const widthDays = Math.max(differenceInDays(end, start) + 1, 1);
    return {
      left: leftDays * dayWidth,
      width: widthDays * dayWidth,
      color: getPhaseColor(phase),
    };
  };

  const prevPeriod = () => {
    if (viewMode === "week") setCurrentDate((d) => subWeeks(d, 1));
    else if (viewMode === "month") setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };

  const nextPeriod = () => {
    if (viewMode === "week") setCurrentDate((d) => addWeeks(d, 1));
    else if (viewMode === "month") setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };

  // Month label grouping for whole job view
  const getMonthLabels = () => {
    const labels: { label: string; left: number }[] = [];
    let lastMonth = -1;
    days.forEach((day, i) => {
      if (day.getMonth() !== lastMonth) {
        labels.push({ label: format(day, "MMM yyyy"), left: i * dayWidth });
        lastMonth = day.getMonth();
      }
    });
    return labels;
  };

  // Dependency arrows data
  const getDependencyLines = () => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    phases.forEach((phase, idx) => {
      if (!phase.dependsOnId) return;
      const parentIdx = phases.findIndex((p) => p.id === phase.dependsOnId);
      if (parentIdx < 0) return;
      const parent = phases[parentIdx];
      const childBar = getBarStyle(phase);
      const parentBar = getBarStyle(parent);
      if (!childBar || !parentBar) return;

      const x1 = parentBar.left + parentBar.width;
      const y1 = parentIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
      const x2 = childBar.left;
      const y2 = idx * ROW_HEIGHT + ROW_HEIGHT / 2;
      lines.push({ x1, y1, x2, y2 });
    });
    return lines;
  };

  const handleBarClick = (e: React.MouseEvent, phase: Phase) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopover({ phase, x: rect.left, y: rect.bottom + 8 });
  };

  if (loading || !job) {
    return (
      <Layout>
        <div className="p-6 text-gray-400">Loading Gantt...</div>
      </Layout>
    );
  }

  const depLines = getDependencyLines();
  const totalHeight = phases.length * ROW_HEIGHT;

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
              <Link href="/jobs" className="hover:text-gray-600">Jobs</Link>
              <span>/</span>
              <Link href={`/jobs/${jobId}`} className="hover:text-gray-600">{job.name}</Link>
              <span>/</span>
              <span className="text-gray-700">Gantt</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: job.color }} />
              <h1 className="text-xl font-bold text-gray-900">{job.name} — Gantt Chart</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* View mode */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              {(["week", "month", "wholejob"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    viewMode === mode ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {mode === "week" ? "Week" : mode === "month" ? "Month" : "Whole Job"}
                </button>
              ))}
            </div>

            {/* Navigation */}
            {viewMode !== "wholejob" && (
              <>
                <button onClick={prevPeriod} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 text-sm">←</button>
                <button onClick={() => setCurrentDate(new Date())} className="px-3 py-2 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 text-gray-600">Today</button>
                <button onClick={nextPeriod} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 text-sm">→</button>
              </>
            )}
          </div>
        </div>

        {/* Period label */}
        {viewMode !== "wholejob" && (
          <p className="text-sm text-gray-500 mb-4">
            {viewMode === "week"
              ? `${format(viewStart, "MMM d")} – ${format(viewEnd, "MMM d, yyyy")}`
              : format(currentDate, "MMMM yyyy")}
          </p>
        )}

        {phases.filter((p) => p.startDate && p.endDate).length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm mb-4">
            ⚠️ No phases have dates set yet. Go to the{" "}
            <Link href={`/jobs/${jobId}`} className="underline font-medium">Phases tab</Link>{" "}
            and add start/end dates to see them on the Gantt chart.
          </div>
        )}

        {/* Gantt chart */}
        <div
          ref={containerRef}
          className="bg-white rounded-xl shadow-sm overflow-hidden"
          onClick={() => setPopover(null)}
        >
          <div className="flex">
            {/* Left sidebar - phase names */}
            <div
              className="shrink-0 border-r border-gray-200 bg-white z-10"
              style={{ width: SIDEBAR_WIDTH }}
            >
              {/* Header spacer */}
              <div className="h-10 border-b border-gray-100 flex items-center px-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Phase</span>
              </div>
              {/* Phase rows */}
              {phases.map((phase) => (
                <div
                  key={phase.id}
                  className="flex items-center px-3 border-b border-gray-50"
                  style={{ height: ROW_HEIGHT }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">{phase.name}</p>
                    {phase.startDate && phase.endDate && (
                      <p className="text-[10px] text-gray-400 truncate">
                        {format(parseISO(phase.startDate), "M/d")} – {format(parseISO(phase.endDate), "M/d")}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Timeline */}
            <div className="flex-1 overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              <div style={{ width: timelineWidth, minWidth: "100%" }}>
                {/* Month labels for whole job view */}
                {viewMode === "wholejob" && (
                  <div className="relative h-5 border-b border-gray-100 bg-gray-50">
                    {getMonthLabels().map((ml, i) => (
                      <div
                        key={i}
                        className="absolute top-0 h-full flex items-center"
                        style={{ left: ml.left }}
                      >
                        <span className="text-[10px] font-medium text-gray-500 px-1 bg-gray-50 whitespace-nowrap">{ml.label}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Day headers */}
                <div className="relative h-10 border-b border-gray-100 flex" style={{ width: timelineWidth }}>
                  {days.map((day, i) => {
                    const isWeekendDay = skipWeekendDisplay(day);
                    const isToday = isSameDay(day, new Date());
                    return (
                      <div
                        key={i}
                        className={`flex-none border-r border-gray-50 flex flex-col items-center justify-center ${isWeekendDay ? "bg-gray-50" : ""} ${isToday ? "bg-blue-50" : ""}`}
                        style={{ width: dayWidth }}
                      >
                        {dayWidth >= 28 && (
                          <>
                            <span className={`text-[10px] font-medium ${isToday ? "text-blue-600" : isWeekendDay ? "text-gray-300" : "text-gray-400"}`}>
                              {format(day, "EEE").substring(0, 1)}
                            </span>
                            <span className={`text-xs font-semibold ${isToday ? "text-blue-600 font-bold" : isWeekendDay ? "text-gray-400" : "text-gray-600"}`}>
                              {format(day, "d")}
                            </span>
                          </>
                        )}
                        {dayWidth >= 60 && (
                          <span className="text-[10px] text-gray-400">{format(day, "MMM")}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Timeline body */}
                <div
                  ref={timelineRef}
                  className="relative"
                  style={{ height: totalHeight, width: timelineWidth }}
                >
                  {/* Weekend columns */}
                  {days.map((day, i) => (
                    skipWeekendDisplay(day) ? (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0 bg-gray-50/80"
                        style={{ left: i * dayWidth, width: dayWidth }}
                      />
                    ) : null
                  ))}

                  {/* Today line */}
                  {(() => {
                    const todayOffset = differenceInDays(new Date(), viewStart);
                    if (todayOffset >= 0 && todayOffset <= totalDays) {
                      return (
                        <div
                          className="absolute top-0 bottom-0 w-px bg-blue-400/60 z-10"
                          style={{ left: todayOffset * dayWidth }}
                        />
                      );
                    }
                    return null;
                  })()}

                  {/* Row dividers */}
                  {phases.map((_, i) => (
                    <div
                      key={i}
                      className="absolute left-0 right-0 border-b border-gray-50"
                      style={{ top: (i + 1) * ROW_HEIGHT - 1 }}
                    />
                  ))}

                  {/* Dependency arrows (SVG overlay) */}
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
                            opacity="0.7"
                          />
                        );
                      })}
                      {depLines.map((line, i) => (
                        <polygon
                          key={`arrow-${i}`}
                          points={`${line.x2},${line.y2} ${line.x2 - 6},${line.y2 - 4} ${line.x2 - 6},${line.y2 + 4}`}
                          fill="#6366f1"
                          opacity="0.7"
                        />
                      ))}
                    </svg>
                  )}

                  {/* Phase bars */}
                  {phases.map((phase, idx) => {
                    const bar = getBarStyle(phase);
                    const rowTop = idx * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;

                    if (!bar) {
                      return (
                        <div
                          key={phase.id}
                          className="absolute flex items-center"
                          style={{ top: rowTop, left: 8, height: BAR_HEIGHT }}
                        >
                          <span className="text-[10px] text-gray-400 italic">No dates set</span>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={phase.id}
                        onClick={(e) => handleBarClick(e, phase)}
                        className="absolute rounded-md flex items-center px-2 text-white text-xs font-medium shadow-sm hover:opacity-90 transition-opacity cursor-pointer overflow-hidden"
                        style={{
                          top: rowTop,
                          left: bar.left,
                          width: Math.max(bar.width, 4),
                          height: BAR_HEIGHT,
                          backgroundColor: bar.color,
                        }}
                      >
                        {bar.width > 40 && (
                          <span className="truncate">{phase.name}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
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
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-indigo-400" style={{ borderBottom: "1.5px dashed #6366f1" }} />
              <span className="text-xs text-gray-500">Dependency</span>
            </div>
          </div>
        </div>
      </div>

      {/* Phase popover */}
      {popover && (
        <div
          className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 p-4 w-64"
          style={{ top: Math.min(popover.y, window.innerHeight - 200), left: Math.min(popover.x, window.innerWidth - 280) }}
        >
          <div className="flex items-start justify-between mb-2">
            <h4 className="font-semibold text-gray-900 text-sm">{popover.phase.name}</h4>
            <button onClick={() => setPopover(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-2">×</button>
          </div>
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
                  {differenceInDays(parseISO(popover.phase.endDate), parseISO(popover.phase.startDate)) + 1} days
                </span>
              </div>
            </div>
          )}
          {!popover.phase.startDate && (
            <p className="text-xs text-gray-400 italic">No dates set for this phase</p>
          )}
          <div
            className="w-full h-1.5 rounded-full mt-3"
            style={{ backgroundColor: getPhaseColor(popover.phase) }}
          />
        </div>
      )}
    </Layout>
  );
}
