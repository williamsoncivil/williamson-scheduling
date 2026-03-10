"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Layout from "@/components/Layout";
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

const JOB_LABEL_WIDTH = 200;
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

  // Drag state
  const dragDataRef = useRef<{
    phaseId: string;
    jobId: string;
    origStartDay: number; // day offset from viewStart when drag started
    barStartDay: number;  // original startDate offset from viewStart
    barDurationDays: number;
  } | null>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  const [optimisticDates, setOptimisticDates] = useState<Record<string, { startDate: string; endDate: string }>>({});
  const [saving, setSaving] = useState(false);
  const [dragTooltip, setDragTooltip] = useState<{ newStart: Date; newEnd: Date } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

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
    const start = parseISO(sd);
    const end = parseISO(ed);
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

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const handleDragStart = (
    e: React.DragEvent,
    phase: Phase,
    job: Job,
    barLeftPx: number
  ) => {
    if (!phase.startDate || !phase.endDate) return;
    const gridEl = gridRef.current;
    const gridLeft = gridEl?.getBoundingClientRect().left ?? 0;
    const mouseXInGrid = e.clientX - gridLeft;
    const origStartDay = Math.floor(mouseXInGrid / dayWidth);
    const barStartDay = differenceInDays(parseISO(phase.startDate), viewStart);
    const barDurationDays = differenceInDays(parseISO(phase.endDate), parseISO(phase.startDate));

    dragDataRef.current = {
      phaseId: phase.id,
      jobId: job.id,
      origStartDay,
      barStartDay,
      barDurationDays,
    };

    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", phase.id);
    setTooltip(null);
  };

  const handleDragOver = (e: React.DragEvent, dayOffset: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dragDataRef.current) return;
    const { origStartDay, barStartDay, barDurationDays } = dragDataRef.current;
    const delta = dayOffset - origStartDay;
    const newStartDay = barStartDay + delta;
    const newStart = addDays(viewStart, newStartDay);
    const newEnd = addDays(newStart, barDurationDays);
    setDragOverDay(dayOffset);
    setDragTooltip({ newStart, newEnd });
  };

  const handleDrop = async (e: React.DragEvent, dayOffset: number) => {
    e.preventDefault();
    if (!dragDataRef.current) return;
    const { phaseId, origStartDay, barStartDay, barDurationDays } = dragDataRef.current;
    const delta = dayOffset - origStartDay;
    const newStartDay = barStartDay + delta;
    const newStart = addDays(viewStart, newStartDay);
    const newEnd = addDays(newStart, barDurationDays);

    const newStartStr = format(newStart, "yyyy-MM-dd");
    const newEndStr = format(newEnd, "yyyy-MM-dd");

    // Optimistic update
    setOptimisticDates((prev) => ({
      ...prev,
      [phaseId]: { startDate: newStartStr, endDate: newEndStr },
    }));
    setDragOverDay(null);
    setDragTooltip(null);
    dragDataRef.current = null;

    // API call
    setSaving(true);
    try {
      await fetch(`/api/phases/${phaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: newStartStr, endDate: newEndStr }),
      });
      fetchData();
    } finally {
      setSaving(false);
      setOptimisticDates((prev) => {
        const next = { ...prev };
        delete next[phaseId];
        return next;
      });
    }
  };

  const handleDragEnd = () => {
    dragDataRef.current = null;
    setDragOverDay(null);
    setDragTooltip(null);
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

  const jobsWithPhases = jobs.filter((j) => j.phases.length > 0);

  const periodLabel = `${format(viewStart, "MMM d")} – ${format(viewEnd, "MMM d, yyyy")}`;

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-full" onClick={() => setTooltip(null)}>
        {/* ── Page header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">People Timeline</h1>
            <p className="text-sm text-gray-500 mt-0.5">Jobs as rows · phases colored by assigned person</p>
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
            {saving && (
              <span className="ml-auto text-xs text-blue-600 animate-pulse">Saving…</span>
            )}
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
                className="shrink-0 border-r border-gray-200 bg-white z-10 sticky left-0"
                style={{ width: JOB_LABEL_WIDTH }}
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

              {/* ── Scrollable timeline area ───────────────────────────────────── */}
              <div ref={scrollRef} className="flex-1 overflow-x-auto">
                <div style={{ width: Math.max(timelineWidth, 100), minWidth: "100%" }}>
                  {/* Day header row */}
                  <div className="relative h-10 border-b border-gray-100 flex" style={{ width: Math.max(timelineWidth, 100) }}>
                    {days.map((day, i) => {
                      const weekend = isWeekend(day);
                      const today = isSameDay(day, new Date());
                      return (
                        <div
                          key={i}
                          className={`flex-none border-r border-gray-50 flex flex-col items-center justify-center ${weekend ? "bg-gray-50" : ""} ${today ? "bg-blue-50" : ""}`}
                          style={{ width: dayWidth }}
                        >
                          {dayWidth >= 20 && (
                            <>
                              {dayWidth >= 28 && (
                                <span className={`text-[10px] ${today ? "text-blue-600" : weekend ? "text-gray-300" : "text-gray-400"}`}>
                                  {format(day, "EEE").substring(0, 1)}
                                </span>
                              )}
                              <span className={`text-[10px] font-semibold ${today ? "text-blue-600" : weekend ? "text-gray-400" : "text-gray-600"}`}>
                                {format(day, "d")}
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Grid body */}
                  <div
                    ref={gridRef}
                    className="relative"
                    style={{ height: ROW_HEIGHT * jobsWithPhases.length, width: Math.max(timelineWidth, 100) }}
                  >
                    {/* Weekend shading */}
                    {days.map((day, i) =>
                      isWeekend(day) ? (
                        <div key={i} className="absolute top-0 bottom-0 bg-gray-50/60" style={{ left: i * dayWidth, width: dayWidth }} />
                      ) : null
                    )}

                    {/* Day drop targets overlay */}
                    {days.map((day, i) => (
                      <div
                        key={`drop-${i}`}
                        className={`absolute top-0 bottom-0 ${dragOverDay === i ? "bg-blue-100/40" : ""}`}
                        style={{ left: i * dayWidth, width: dayWidth, zIndex: 5 }}
                        onDragOver={(e) => handleDragOver(e, i)}
                        onDrop={(e) => handleDrop(e, i)}
                      />
                    ))}

                    {/* Today line */}
                    {showToday && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-blue-400/60 z-10"
                        style={{ left: todayOffset * dayWidth }}
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
                            className="absolute left-0 right-0 border-b border-gray-100"
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
                            const isDragging = dragDataRef.current?.phaseId === phase.id;

                            return (
                              <div
                                key={phase.id}
                                draggable={!!(phase.startDate && phase.endDate)}
                                onDragStart={(e) => handleDragStart(e, phase, job, bar.left)}
                                onDragEnd={handleDragEnd}
                                className={`absolute rounded text-white text-xs font-medium shadow-sm overflow-hidden flex items-center gap-1 px-1.5 cursor-grab active:cursor-grabbing group select-none ${isDragging ? "opacity-50" : "hover:opacity-90"} transition-opacity`}
                                style={{
                                  top: barTop,
                                  left: bar.left,
                                  width: Math.max(bar.width, 4),
                                  height: BAR_HEIGHT,
                                  backgroundColor: barColor,
                                  zIndex: 8,
                                }}
                                onMouseEnter={(e) => {
                                  if (!dragDataRef.current) handleBarMouseEnter(e, phase, job);
                                }}
                                onMouseLeave={() => setTooltip(null)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleBarMouseEnter(e, phase, job);
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

        {/* Drag tooltip */}
        {dragTooltip && (
          <div
            className="fixed z-50 pointer-events-none bg-gray-900 text-white text-xs px-3 py-1.5 rounded-lg shadow-lg"
            style={{ bottom: 32, left: "50%", transform: "translateX(-50%)" }}
          >
            {format(dragTooltip.newStart, "MMM d")} – {format(dragTooltip.newEnd, "MMM d, yyyy")}
          </div>
        )}
      </div>

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
                <span className="font-medium">{format(parseISO(tooltip.phase.startDate), "MMM d, yyyy")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">End</span>
                <span className="font-medium">{format(parseISO(tooltip.phase.endDate), "MMM d, yyyy")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Duration</span>
                <span className="font-medium">
                  {differenceInDays(parseISO(tooltip.phase.endDate), parseISO(tooltip.phase.startDate)) + 1}d
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
          <p className="text-xs text-gray-400 mt-2 italic">Drag bar to reschedule</p>
        </div>
      )}
    </Layout>
  );
}
