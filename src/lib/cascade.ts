import { prisma } from "@/lib/prisma";
import { addDays } from "date-fns";

export interface CascadedPhase {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
}

// ─── Business-day helpers (UTC-safe for server-side Prisma dates) ─────────────

function isWeekendUTC(date: Date): boolean {
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6;
}

/** Advance date forward until it lands on a weekday (UTC). */
function snapToWeekdayUTC(date: Date): Date {
  let d = new Date(date);
  while (isWeekendUTC(d)) {
    d = addDays(d, 1);
  }
  return d;
}

/**
 * Add `n` business days to a date (UTC). Day 1 counts as the start date itself.
 * If the start date is a weekend it is first snapped to the next weekday.
 */
function addBusinessDaysUTC(date: Date, n: number): Date {
  let d = snapToWeekdayUTC(new Date(date));
  let remaining = n - 1;
  while (remaining > 0) {
    d = addDays(d, 1);
    if (!isWeekendUTC(d)) remaining--;
  }
  return d;
}

/** Count business days between two dates (inclusive, UTC). Returns null if end < start. */
function countBusinessDaysUTC(start: Date, end: Date): number | null {
  if (end < start) return null;
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    if (!isWeekendUTC(d)) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count > 0 ? count : null;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cascade phase date changes to all successor phases via PhaseDependency relations.
 * Uses BFS to avoid infinite loops.
 * Only shifts phases FORWARD (does not pull dates earlier).
 * Durations are preserved in business days; new start/end dates skip weekends.
 */
export async function cascadePhaseUpdate(
  phaseId: string,
  newStartDate: Date | null,
  newEndDate: Date | null
): Promise<CascadedPhase[]> {
  const cascadedPhases: CascadedPhase[] = [];
  const visited = new Set<string>([phaseId]);

  // BFS queue: [phaseId, its new startDate, its new endDate]
  const queue: Array<{ id: string; newStart: Date | null; newEnd: Date | null }> = [
    { id: phaseId, newStart: newStartDate, newEnd: newEndDate },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Find all dependencies where this phase is a predecessor
    const deps = await prisma.phaseDependency.findMany({
      where: { predecessorId: current.id },
      include: {
        successor: true,
      },
    });

    for (const dep of deps) {
      if (visited.has(dep.successorId)) continue;
      visited.add(dep.successorId);

      const successor = dep.successor;
      if (!successor.startDate && !successor.endDate) continue; // Skip phases with no dates

      // Preserve duration in business days (skips weekends)
      const businessDayDuration =
        successor.startDate && successor.endDate
          ? countBusinessDaysUTC(successor.startDate, successor.endDate)
          : null;

      let newSuccessorStart: Date | null = successor.startDate;
      let newSuccessorEnd: Date | null = successor.endDate;

      switch (dep.type) {
        case "FINISH_TO_START": {
          // successor starts when predecessor finishes + lag
          if (current.newEnd) {
            let proposed = addDays(current.newEnd, dep.lagDays);
            proposed = snapToWeekdayUTC(proposed);
            newSuccessorStart = proposed;
            if (businessDayDuration !== null) {
              newSuccessorEnd = addBusinessDaysUTC(newSuccessorStart, businessDayDuration);
            }
          }
          break;
        }
        case "START_TO_START": {
          // successor starts when predecessor starts + lag
          if (current.newStart) {
            let proposed = addDays(current.newStart, dep.lagDays);
            proposed = snapToWeekdayUTC(proposed);
            newSuccessorStart = proposed;
            if (businessDayDuration !== null) {
              newSuccessorEnd = addBusinessDaysUTC(newSuccessorStart, businessDayDuration);
            }
          }
          break;
        }
        case "FINISH_TO_FINISH": {
          // successor finishes when predecessor finishes + lag
          if (current.newEnd) {
            let proposed = addDays(current.newEnd, dep.lagDays);
            proposed = snapToWeekdayUTC(proposed);
            {
              newSuccessorEnd = proposed;
              // Preserve duration (shift start back by business days)
              if (businessDayDuration !== null && newSuccessorEnd) {
                // Walk backward to find start
                let d = new Date(newSuccessorEnd);
                let remaining = businessDayDuration - 1;
                while (remaining > 0) {
                  d = addDays(d, -1);
                  if (!isWeekendUTC(d)) remaining--;
                }
                newSuccessorStart = snapToWeekdayUTC(d);
              }
            }
          }
          break;
        }
        case "START_TO_FINISH": {
          // successor finishes when predecessor starts + lag (rare)
          if (current.newStart) {
            let proposed = addDays(current.newStart, dep.lagDays);
            proposed = snapToWeekdayUTC(proposed);
            {
              newSuccessorEnd = proposed;
              if (businessDayDuration !== null && newSuccessorEnd) {
                let d = new Date(newSuccessorEnd);
                let remaining = businessDayDuration - 1;
                while (remaining > 0) {
                  d = addDays(d, -1);
                  if (!isWeekendUTC(d)) remaining--;
                }
                newSuccessorStart = snapToWeekdayUTC(d);
              }
            }
          }
          break;
        }
      }

      // Only update if dates actually changed
      const startChanged =
        newSuccessorStart?.getTime() !== successor.startDate?.getTime();
      const endChanged =
        newSuccessorEnd?.getTime() !== successor.endDate?.getTime();

      if (startChanged || endChanged) {
        const updated = await prisma.phase.update({
          where: { id: dep.successorId },
          data: {
            ...(newSuccessorStart !== null && { startDate: newSuccessorStart }),
            ...(newSuccessorEnd !== null && { endDate: newSuccessorEnd }),
          },
        });

        cascadedPhases.push({
          id: updated.id,
          name: updated.name,
          startDate: updated.startDate?.toISOString() ?? null,
          endDate: updated.endDate?.toISOString() ?? null,
        });

        // Enqueue this successor to cascade further
        queue.push({
          id: dep.successorId,
          newStart: newSuccessorStart,
          newEnd: newSuccessorEnd,
        });
      }
    }
  }

  return cascadedPhases;
}
