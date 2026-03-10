import { prisma } from "@/lib/prisma";
import { addDays } from "date-fns";

export interface CascadedPhase {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
}

/**
 * Cascade phase date changes to all successor phases via PhaseDependency relations.
 * Uses BFS to avoid infinite loops.
 * Only shifts phases FORWARD (does not pull dates earlier).
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

      const duration =
        successor.startDate && successor.endDate
          ? successor.endDate.getTime() - successor.startDate.getTime()
          : null;

      let newSuccessorStart: Date | null = successor.startDate;
      let newSuccessorEnd: Date | null = successor.endDate;

      switch (dep.type) {
        case "FINISH_TO_START": {
          // successor starts when predecessor finishes + lag
          if (current.newEnd) {
            const proposed = addDays(current.newEnd, dep.lagDays);
            // Only shift forward
            if (!newSuccessorStart || proposed > newSuccessorStart) {
              newSuccessorStart = proposed;
              // Preserve duration
              if (duration !== null) {
                newSuccessorEnd = new Date(newSuccessorStart.getTime() + duration);
              }
            }
          }
          break;
        }
        case "START_TO_START": {
          // successor starts when predecessor starts + lag
          if (current.newStart) {
            const proposed = addDays(current.newStart, dep.lagDays);
            if (!newSuccessorStart || proposed > newSuccessorStart) {
              newSuccessorStart = proposed;
              if (duration !== null) {
                newSuccessorEnd = new Date(newSuccessorStart.getTime() + duration);
              }
            }
          }
          break;
        }
        case "FINISH_TO_FINISH": {
          // successor finishes when predecessor finishes + lag
          if (current.newEnd) {
            const proposed = addDays(current.newEnd, dep.lagDays);
            if (!newSuccessorEnd || proposed > newSuccessorEnd) {
              newSuccessorEnd = proposed;
              // Preserve duration (shift start back)
              if (duration !== null) {
                newSuccessorStart = new Date(newSuccessorEnd.getTime() - duration);
              }
            }
          }
          break;
        }
        case "START_TO_FINISH": {
          // successor finishes when predecessor starts + lag (rare)
          if (current.newStart) {
            const proposed = addDays(current.newStart, dep.lagDays);
            if (!newSuccessorEnd || proposed > newSuccessorEnd) {
              newSuccessorEnd = proposed;
              if (duration !== null) {
                newSuccessorStart = new Date(newSuccessorEnd.getTime() - duration);
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
