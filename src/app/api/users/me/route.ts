import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EmailNotificationLevel } from "@prisma/client";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, phone: true, emailNotificationLevel: true, telegramChatId: true, endOfDayPrompt: true },
  });

  return NextResponse.json(user);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const data: { emailNotificationLevel?: EmailNotificationLevel; phone?: string | null; telegramChatId?: string | null; endOfDayPrompt?: boolean } = {};

  if (body.emailNotificationLevel && Object.values(EmailNotificationLevel).includes(body.emailNotificationLevel)) {
    data.emailNotificationLevel = body.emailNotificationLevel as EmailNotificationLevel;
  }
  if ("phone" in body) data.phone = body.phone ?? null;
  if ("telegramChatId" in body) data.telegramChatId = body.telegramChatId || null;
  if ("endOfDayPrompt" in body) data.endOfDayPrompt = Boolean(body.endOfDayPrompt);

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { id: true, name: true, email: true, role: true, phone: true, emailNotificationLevel: true, telegramChatId: true, endOfDayPrompt: true },
  });

  return NextResponse.json(user);
}
