import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ count: 0 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { messagesLastReadAt: true },
  });

  const since = user?.messagesLastReadAt ?? new Date(0);

  // Count messages where this user was @mentioned after their last read
  const count = await prisma.messageMention.count({
    where: {
      userId: session.user.id,
      message: {
        createdAt: { gt: since },
        authorId: { not: session.user.id },
      },
    },
  });

  return NextResponse.json({ count });
}
