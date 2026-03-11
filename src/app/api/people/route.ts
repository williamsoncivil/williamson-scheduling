import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { name, email, password, role, phone, trade } = body;

  // Subcontractors don't need email/password
  if (role === "SUBCONTRACTOR") {
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const placeholderEmail = `sub-${randomUUID()}@nologin.local`;
    const placeholderHash = await bcrypt.hash(randomUUID(), 10);

    const user = await prisma.user.create({
      data: {
        name: trade ? `${name} (${trade})` : name,
        email: placeholderEmail,
        passwordHash: placeholderHash,
        role: "SUBCONTRACTOR",
        phone: phone || null,
      },
      select: { id: true, name: true, email: true, role: true, phone: true, createdAt: true },
    });
    return NextResponse.json(user, { status: 201 });
  }

  // Regular users require email + password
  if (!name || !email || !password) {
    return NextResponse.json({ error: "Name, email, and password are required" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: role || "EMPLOYEE",
      phone: phone || null,
    },
    select: { id: true, name: true, email: true, role: true, phone: true, createdAt: true },
  });

  return NextResponse.json(user, { status: 201 });
}
