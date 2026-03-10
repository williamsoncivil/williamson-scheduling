import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [predecessorDeps, successorDeps] = await Promise.all([
    prisma.phaseDependency.findMany({
      where: { successorId: params.id },
      include: { predecessor: { select: { id: true, name: true, startDate: true, endDate: true } } },
    }),
    prisma.phaseDependency.findMany({
      where: { predecessorId: params.id },
      include: { successor: { select: { id: true, name: true, startDate: true, endDate: true } } },
    }),
  ]);

  return NextResponse.json({ predecessorDeps, successorDeps });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { predecessorId, type = "FINISH_TO_START", lagDays = 0 } = body;

  if (!predecessorId) {
    return NextResponse.json({ error: "predecessorId is required" }, { status: 400 });
  }

  // Prevent self-dependency
  if (predecessorId === params.id) {
    return NextResponse.json({ error: "A phase cannot depend on itself" }, { status: 400 });
  }

  // Prevent circular dependencies (simple check: successor cannot be an ancestor of predecessor)
  const isCircular = await wouldCreateCycle(params.id, predecessorId);
  if (isCircular) {
    return NextResponse.json({ error: "This would create a circular dependency" }, { status: 400 });
  }

  const dep = await prisma.phaseDependency.upsert({
    where: { predecessorId_successorId: { predecessorId, successorId: params.id } },
    create: {
      predecessorId,
      successorId: params.id,
      type,
      lagDays: lagDays ?? 0,
    },
    update: {
      type,
      lagDays: lagDays ?? 0,
    },
    include: {
      predecessor: { select: { id: true, name: true, startDate: true, endDate: true } },
      successor: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(dep, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const predecessorId = searchParams.get("predecessorId");

  if (!predecessorId) {
    return NextResponse.json({ error: "predecessorId query param required" }, { status: 400 });
  }

  await prisma.phaseDependency.delete({
    where: { predecessorId_successorId: { predecessorId, successorId: params.id } },
  });

  return NextResponse.json({ success: true });
}

/**
 * Check if adding predecessorId → successorId (params.id) would create a cycle.
 * We check if params.id is already an ancestor of predecessorId.
 */
async function wouldCreateCycle(
  successorId: string,
  predecessorId: string
): Promise<boolean> {
  // BFS upward from predecessorId — if we reach successorId, it's a cycle
  const visited = new Set<string>();
  const queue = [predecessorId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === successorId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const parents = await prisma.phaseDependency.findMany({
      where: { successorId: current },
      select: { predecessorId: true },
    });
    for (const p of parents) {
      queue.push(p.predecessorId);
    }
  }

  return false;
}
