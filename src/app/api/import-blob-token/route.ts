/**
 * Issues a Vercel Blob client-upload token for large file migration.
 * The client uses this token to upload directly to Blob storage, bypassing the 4.5MB function limit.
 */
import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { prisma } from "@/lib/prisma";

const IMPORT_TOKEN = "bt-import-2026-williamson";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // Validate the import token passed as a query param
        const token = req.nextUrl.searchParams.get("token");
        if (token !== IMPORT_TOKEN) throw new Error("Invalid import token");
        return {
          allowedContentTypes: ["application/pdf", "application/octet-stream", "image/*"],
          maximumSizeInBytes: 50 * 1024 * 1024, // 50MB
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Register in DB after upload
        const jobName = req.nextUrl.searchParams.get("jobName") || "392 West Alder";
        const fileName = blob.pathname.split("/").pop() || blob.pathname;
        const job = await prisma.job.findFirst({ where: { name: jobName } });
        if (job) {
          const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
          await prisma.document.create({
            data: {
              name: fileName,
              fileUrl: blob.url,
              fileType: blob.contentType || "application/pdf",
              fileCategory: "document",
              uploadedById: adminUser!.id,
              jobId: job.id,
              phaseId: null,
            },
          });
        }
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
