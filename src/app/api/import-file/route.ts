import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { put } from "@vercel/blob";

// One-time import token for Buildertrend migration
const IMPORT_TOKEN = "bt-import-2026-williamson";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "https://buildertrend.net",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, name, b64, contentType, jobName, phaseTitle } = body;

  if (token !== IMPORT_TOKEN) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 }, );
  }

  // Find job by name
  const job = await prisma.job.findFirst({ where: { name: jobName } });
  if (!job) {
    return NextResponse.json({ error: `Job not found: ${jobName}` }, { status: 404 });
  }

  // Find phase by title + jobId
  const phase = phaseTitle
    ? await prisma.phase.findFirst({ where: { name: phaseTitle, jobId: job.id } })
    : null;

  // Upload to Vercel Blob
  const buf = Buffer.from(b64, "base64");
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const blobPath = `williamson/${jobName.replace(/[^a-zA-Z0-9]/g, "-")}/${Date.now()}_${safeName}`;
  const blob = await put(blobPath, buf, { access: "public", contentType: contentType || "application/pdf" });

  // Find an admin user to attribute the upload to
  const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });

  // Save document record
  const doc = await prisma.document.create({
    data: {
      name,
      fileUrl: blob.url,
      fileType: contentType || "application/pdf",
      fileCategory: (contentType || "").startsWith("image/") ? "photo" : "document",
      uploadedById: adminUser!.id,
      jobId: job.id,
      phaseId: phase?.id || null,
    },
  });

  return NextResponse.json(
    { ok: true, url: blob.url, docId: doc.id, phaseTitle },
    { status: 201, headers: corsHeaders() }
  );
}
