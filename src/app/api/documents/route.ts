import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  const fileCategory = searchParams.get("fileCategory"); // "photo" | "document" | null (all)

  const phaseId = searchParams.get("phaseId");

  const where: Record<string, unknown> = {};

  if (jobId) where.jobId = jobId;
  if (phaseId) where.phaseId = phaseId;
  if (fileCategory && fileCategory !== "all") where.fileCategory = fileCategory;

  const documents = await prisma.document.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      uploadedBy: { select: { id: true, name: true } },
      phase: { select: { id: true, name: true } },
      job: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(documents);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, fileUrl, fileType, jobId, phaseId } = await req.json();
  if (!name || !fileUrl || !jobId) {
    return NextResponse.json({ error: "name, fileUrl, and jobId are required" }, { status: 400 });
  }

  const fileCategory = (fileType || "").startsWith("image/") ? "photo" : "document";

  const document = await prisma.document.create({
    data: {
      name,
      fileUrl,
      fileType: fileType || "application/octet-stream",
      fileCategory,
      uploadedById: session.user.id,
      jobId,
      phaseId: phaseId || null,
    },
    include: {
      uploadedBy: { select: { id: true, name: true } },
      phase: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(document, { status: 201 });
}
