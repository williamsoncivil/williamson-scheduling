import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfWeek, endOfWeek, parseISO, startOfDay, endOfDay } from "date-fns";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  const userId = searchParams.get("userId");
  const date = searchParams.get("date");
  const week = searchParams.get("week");

  const where: Record<string, unknown> = {};

  if (jobId) {
    where.jobId = jobId;
  } else {
    // When viewing the schedule calendar (no specific job), only show ACTIVE jobs
    where.job = { status: "ACTIVE" };
  }
  if (userId) where.userId = userId;

  if (date) {
    const d = parseISO(date);
    where.date = {
      gte: startOfDay(d),
      lte: endOfDay(d),
    };
  } else if (week) {
    const d = parseISO(week);
    where.date = {
      gte: startOfWeek(d, { weekStartsOn: 0 }),
      lte: endOfWeek(d, { weekStartsOn: 0 }),
    };
  }

  const entries = await prisma.scheduleEntry.findMany({
    where,
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    include: {
      user: { select: { id: true, name: true, role: true } },
      supervisor: { select: { id: true, name: true } },
      job: { select: { id: true, name: true, color: true } },
      phase: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(entries);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { jobId, phaseId, userId, supervisorId, date, startTime, endTime, notes } = body;

  if (!jobId || !userId || !date || !startTime || !endTime) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const entryDate = parseISO(date);

  // Check for conflicts: other entries for same user on same day
  const sameDay = await prisma.scheduleEntry.findMany({
    where: {
      userId,
      date: {
        gte: startOfDay(entryDate),
        lte: endOfDay(entryDate),
      },
    },
    include: {
      job: { select: { name: true } },
      phase: { select: { name: true } },
    },
  });

  let warning: string | null = null;
  let hardConflict = false;

  if (sameDay.length > 0) {
    // Check for exact time overlap
    const newStart = timeToMinutes(startTime);
    const newEnd = timeToMinutes(endTime);

    for (const existing of sameDay) {
      const existStart = timeToMinutes(existing.startTime);
      const existEnd = timeToMinutes(existing.endTime);

      const overlaps = newStart < existEnd && newEnd > existStart;

      if (overlaps) {
        hardConflict = true;
        return NextResponse.json(
          {
            error: "Time conflict",
            conflict: {
              existingEntry: {
                jobName: existing.job.name,
                phaseName: existing.phase?.name,
                startTime: existing.startTime,
                endTime: existing.endTime,
              },
            },
          },
          { status: 409 }
        );
      }
    }

    // Same day, different time — soft warning
    if (!hardConflict) {
      warning = `This person is already scheduled on this day at ${sameDay[0].startTime}–${sameDay[0].endTime} for ${sameDay[0].job.name}`;
    }
  }

  const entry = await prisma.scheduleEntry.create({
    data: {
      jobId,
      phaseId: phaseId || null,
      userId,
      supervisorId: supervisorId || null,
      date: entryDate,
      startTime,
      endTime,
      notes: notes || null,
    },
    include: {
      user: { select: { id: true, name: true } },
      supervisor: { select: { id: true, name: true } },
      job: { select: { id: true, name: true, color: true } },
      phase: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ entry, warning }, { status: 201 });
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
