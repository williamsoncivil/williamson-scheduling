import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendMentionEmail, sendNewMessageEmail } from "@/lib/email";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  const phaseId = searchParams.get("phaseId");

  const messages = await prisma.message.findMany({
    where: {
      ...(jobId ? { jobId } : {}),
      ...(phaseId ? { phaseId } : {}),
    },
    include: {
      author: { select: { id: true, name: true, role: true } },
      job: { select: { id: true, name: true, color: true } },
      phase: { select: { id: true, name: true } },
      mentions: { include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json(messages);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { content, jobId, phaseId } = await req.json();
  if (!content?.trim() || !jobId) {
    return NextResponse.json({ error: "Content and jobId required" }, { status: 400 });
  }

  // Parse @mentions: match @Name or @First Last (two words)
  const allUsers = await prisma.user.findMany({ select: { id: true, name: true, email: true, emailNotifications: true, role: true } });
  const mentionedUserIds: string[] = [];

  // Sort by name length desc so "John Smith" matches before "John"
  const sorted = [...allUsers].sort((a, b) => b.name.length - a.name.length);
  const contentLower = content.toLowerCase();
  for (const user of sorted) {
    if (contentLower.includes(`@${user.name.toLowerCase()}`)) {
      if (!mentionedUserIds.includes(user.id) && user.id !== session.user.id) {
        mentionedUserIds.push(user.id);
      }
    }
  }

  const message = await prisma.message.create({
    data: {
      content: content.trim(),
      authorId: session.user.id,
      jobId,
      phaseId: phaseId || null,
      mentions: mentionedUserIds.length > 0 ? {
        create: mentionedUserIds.map((userId) => ({ userId })),
      } : undefined,
    },
    include: {
      author: { select: { id: true, name: true, role: true } },
      job: { select: { id: true, name: true, color: true } },
      phase: { select: { id: true, name: true } },
      mentions: { include: { user: { select: { id: true, name: true } } } },
    },
  });

  // Send email notifications to mentioned users who have it enabled
  if (mentionedUserIds.length > 0) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { name: true } });
    const phase = phaseId ? await prisma.phase.findUnique({ where: { id: phaseId }, select: { name: true } }) : null;
    const authorUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } });

    for (const uid of mentionedUserIds) {
      const mentionedUser = allUsers.find((u) => u.id === uid);
      if (mentionedUser?.emailNotifications && mentionedUser.email) {
        // Fire and forget — don't await so response isn't delayed
        sendMentionEmail({
          toEmail: mentionedUser.email,
          toName: mentionedUser.name,
          fromName: authorUser?.name ?? "A teammate",
          messageContent: content.trim(),
          jobName: job?.name ?? jobId,
          phaseName: phase?.name,
        }).catch(console.error);
      }
    }
  }

  // Notify all admins with email notifications enabled (who aren't the author and weren't already @mentioned)
  const admins = allUsers.filter(
    (u) =>
      u.role === "ADMIN" &&
      u.emailNotifications &&
      u.email &&
      u.id !== session.user.id &&
      !mentionedUserIds.includes(u.id)
  );

  if (admins.length > 0) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { name: true } });
    const phase = phaseId ? await prisma.phase.findUnique({ where: { id: phaseId }, select: { name: true } }) : null;
    const authorUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } });

    for (const admin of admins) {
      sendNewMessageEmail({
        toEmail: admin.email!,
        toName: admin.name,
        fromName: authorUser?.name ?? "A teammate",
        messageContent: content.trim(),
        jobName: job?.name ?? jobId,
        phaseName: phase?.name,
      }).catch(console.error);
    }
  }

  return NextResponse.json(message, { status: 201 });
}
