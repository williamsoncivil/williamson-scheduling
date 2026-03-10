import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");

  // Default: ACTIVE + COMPLETED. ?status=archived → ARCHIVED only.
  const statusFilter =
    statusParam === "archived" ? ["ARCHIVED"] : ["ACTIVE", "COMPLETED"];

  const jobs = await prisma.job.findMany({
    where: { status: { in: statusFilter } },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          phases: true,
          schedules: true,
        },
      },
    },
  });

  return NextResponse.json(jobs);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, address, description, color } = body;

  if (!name || !address) {
    return NextResponse.json({ error: "Name and address are required" }, { status: 400 });
  }

  const job = await prisma.job.create({
    data: {
      name,
      address,
      description: description || null,
      color: color || "#3B82F6",
    },
  });

  return NextResponse.json(job, { status: 201 });
}
