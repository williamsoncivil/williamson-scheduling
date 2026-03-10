import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      createdAt: true,
      schedules: {
        orderBy: { date: "asc" },
        include: {
          job: { select: { id: true, name: true, color: true } },
          phase: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Detect conflicts: group entries by date, flag days with multiple entries
  const dateMap: Record<string, typeof user.schedules> = {};
  for (const entry of user.schedules) {
    const key = format(new Date(entry.date), "yyyy-MM-dd");
    if (!dateMap[key]) dateMap[key] = [];
    dateMap[key].push(entry);
  }

  const conflicts: { date: string; entries: typeof user.schedules }[] = [];
  for (const [date, entries] of Object.entries(dateMap)) {
    if (entries.length > 1) {
      conflicts.push({ date, entries });
    }
  }

  return NextResponse.json({ ...user, conflicts });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { name, email, role, phone } = body;

  const user = await prisma.user.update({
    where: { id: params.id },
    data: {
      ...(name && { name }),
      ...(email && { email }),
      ...(role && { role }),
      ...(phone !== undefined && { phone }),
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
    },
  });

  return NextResponse.json(user);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Cannot delete yourself
  if (params.id === session.user.id) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  // Check for active schedule assignments
  const scheduleCount = await prisma.scheduleEntry.count({
    where: {
      OR: [{ userId: params.id }, { supervisorId: params.id }],
    },
  });

  if (scheduleCount > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete: this person has ${scheduleCount} schedule assignment(s). Remove their schedule entries first.`,
      },
      { status: 409 }
    );
  }

  await prisma.user.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
