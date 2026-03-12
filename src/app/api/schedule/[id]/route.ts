import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseISO } from "date-fns";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { date, startTime, endTime, notes } = body;

  const data: Record<string, unknown> = {};
  if (date) data.date = parseISO(date);
  if (startTime) data.startTime = startTime;
  if (endTime) data.endTime = endTime;
  if (notes !== undefined) data.notes = notes;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const entry = await prisma.scheduleEntry.update({
    where: { id: params.id },
    data,
    include: {
      user: { select: { id: true, name: true, role: true } },
      supervisor: { select: { id: true, name: true } },
      job: { select: { id: true, name: true, color: true } },
      phase: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(entry);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.scheduleEntry.delete({ where: { id: params.id } });

  return NextResponse.json({ success: true });
}
