import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

// Called by the Vercel Blob client SDK (two phases: token generation + upload complete)
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // Verify session before issuing an upload token
        const session = await getServerSession(authOptions);
        if (!session) throw new Error("Unauthorized");
        return {
          allowedContentTypes: [
            "image/jpeg", "image/png", "image/gif", "image/webp",
            "image/heic", "image/heif",
            "application/pdf",
            "video/mp4", "video/quicktime", "video/mov",
          ],
          maximumSizeInBytes: 50 * 1024 * 1024, // 50 MB
          tokenPayload: clientPayload ?? "",
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Called by Vercel after the file is stored — save record to DB
        const { jobId, phaseId, userId, originalName } = JSON.parse(tokenPayload || "{}");
        const fileType = blob.contentType || "application/octet-stream";
        const fileCategory = fileType.startsWith("image/") ? "photo" : "document";

        await prisma.document.create({
          data: {
            name: originalName || blob.pathname,
            fileUrl: blob.url,
            fileType,
            fileCategory,
            uploadedById: userId,
            jobId,
            phaseId: phaseId || null,
          },
        });
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Upload error:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
