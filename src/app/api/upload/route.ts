import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const maxDuration = 60;

// Handles both phases of the Vercel Blob client upload handshake:
//   Phase 1 (token generation): Vercel Blob SDK → POST /api/upload → returns clientToken
//   Phase 2 (upload complete):  Vercel Blob → POST /api/upload → we do nothing (DB save is client-side)
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, _clientPayload) => {
        const session = await getServerSession(authOptions);
        if (!session) throw new Error("Unauthorized");
        return {
          allowedContentTypes: [
            "image/jpeg", "image/png", "image/gif", "image/webp",
            "image/heic", "image/heif",
            "application/pdf",
            "video/mp4", "video/quicktime",
          ],
          maximumSizeInBytes: 50 * 1024 * 1024, // 50 MB
        };
      },
      onUploadCompleted: async () => {
        // DB record is saved by the client after upload — nothing to do here
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Upload token error:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
