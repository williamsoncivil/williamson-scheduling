import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type HistoryMessage = { role: "user" | "assistant"; content: string };

async function buildScheduleContext() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in14Days = new Date(today);
  in14Days.setDate(in14Days.getDate() + 14);

  const [activeJobs, scheduleEntries, overdueCandidates, users] =
    await Promise.all([
      prisma.job.findMany({
        where: { status: "ACTIVE" },
        include: {
          phases: {
            select: { id: true, name: true, startDate: true, endDate: true, orderIndex: true },
            orderBy: { orderIndex: "asc" },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.scheduleEntry.findMany({
        where: { date: { gte: today, lte: in14Days } },
        include: {
          job: { select: { name: true } },
          phase: { select: { name: true } },
          user: { select: { name: true, id: true } },
        },
        orderBy: { date: "asc" },
        take: 200,
      }),
      prisma.phase.findMany({
        where: { job: { status: "ACTIVE" }, endDate: { lt: today } },
        include: { job: { select: { name: true } } },
        take: 50,
      }),
      prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: "asc" },
      }),
    ]);

  const jobsContext = activeJobs
    .map((j) => {
      const phases = j.phases
        .map((p) => {
          const start = p.startDate ? p.startDate.toISOString().split("T")[0] : "no start";
          const end = p.endDate ? p.endDate.toISOString().split("T")[0] : "no end";
          return `    - ${p.name} (${start} → ${end})`;
        })
        .join("\n");
      return `Job: "${j.name}"\n${phases || "    (no phases)"}`;
    })
    .join("\n\n");

  const scheduleContext = scheduleEntries
    .map((e) => {
      const date = e.date.toISOString().split("T")[0];
      const phase = e.phase ? ` / ${e.phase.name}` : "";
      return `${date}: ${e.user.name} → ${e.job.name}${phase}`;
    })
    .join("\n");

  const overdueContext = overdueCandidates
    .map((p) => {
      const end = p.endDate ? p.endDate.toISOString().split("T")[0] : "?";
      return `- ${p.job.name} / ${p.name} (ended ${end})`;
    })
    .join("\n");

  const usersContext = users.map((u) => `- ${u.name} (${u.role})`).join("\n");

  return { today, jobsContext, scheduleContext, overdueContext, usersContext, users, activeJobs };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const message: string = body.message ?? "";
  const history: HistoryMessage[] = body.history ?? [];

  if (!message.trim()) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  // Classify message
  const classifyCompletion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          'Classify this message as either "question" (asking about the schedule) or "update" (reporting progress on work). Reply with only one word: question or update.',
      },
      { role: "user", content: message },
    ],
  });
  const msgType =
    classifyCompletion.choices[0].message.content?.trim().toLowerCase() === "question"
      ? "question"
      : "update";

  const ctx = await buildScheduleContext();
  const { today, jobsContext, scheduleContext, overdueContext, usersContext, users, activeJobs } = ctx;

  const askingUser = users.find((u) => u.email === session.user?.email);

  if (msgType === "question") {
    const systemPrompt = `You are a helpful construction scheduling assistant for Williamson Civil Construction. Answer the user's question using the schedule data below. Be concise and use line breaks to keep it readable.

Today's date: ${today.toISOString().split("T")[0]}
${askingUser ? `The person asking: ${askingUser.name}` : ""}

ACTIVE JOBS AND PHASES:
${jobsContext || "No active jobs."}

SCHEDULE ENTRIES (next 14 days):
${scheduleContext || "No upcoming schedule entries."}

POTENTIALLY OVERDUE PHASES (end date has passed, job still active):
${overdueContext || "None."}

TEAM MEMBERS:
${usersContext}`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map((h) => ({ role: h.role, content: h.content } as OpenAI.Chat.ChatCompletionMessageParam)),
      { role: "user", content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });

    const reply = completion.choices[0].message.content ?? "Sorry, I couldn't generate an answer.";
    return NextResponse.json({ reply });
  }

  // Handle UPDATE
  const phases = await prisma.phase.findMany({
    where: {
      job: { status: "ACTIVE" },
      startDate: { lte: new Date() },
      endDate: { gte: today },
    },
    include: { job: { select: { id: true, name: true } } },
    take: 30,
  });

  // Also include all phases from active jobs (not just current ones)
  const allActivePhases = activeJobs.flatMap((j) =>
    j.phases.map((p) => ({ ...p, job: { id: j.id, name: j.name } }))
  );

  const phasePool = phases.length > 0 ? phases : allActivePhases;

  const phaseContext = phasePool
    .map((p) => `- Phase ID: ${p.id}, Job: "${p.job.name}", Phase: "${p.name}"`)
    .join("\n");

  const parseCompletion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a construction scheduling assistant. Parse the user's progress update and match it to the relevant phases below.

Active phases:
${phaseContext || "No active phases found."}

Return a JSON object:
{
  "updates": [
    { "phaseId": "<id>", "jobName": "<name>", "phaseName": "<name>", "notes": "<parsed progress note>" }
  ]
}

Only include phases clearly mentioned or inferable. If nothing matches, return { "updates": [] }.`,
      },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
  });

  let parsedUpdates: { phaseId: string; jobName: string; phaseName: string; notes: string }[] = [];
  try {
    const parsed = JSON.parse(parseCompletion.choices[0].message.content ?? "{}");
    parsedUpdates = parsed.updates ?? [];
  } catch {
    return NextResponse.json({
      reply: "I received your update but had trouble parsing it. Please check the schedule manually.",
    });
  }

  if (parsedUpdates.length === 0) {
    return NextResponse.json({
      reply: "I received your message but couldn't match it to any active phases. Please update the schedule manually if needed.",
    });
  }

  const updateSummary: string[] = [];
  for (const update of parsedUpdates) {
    try {
      const phase = phasePool.find((p) => p.id === update.phaseId);
      if (!phase) continue;
      await prisma.productionLog.create({
        data: {
          date: new Date(),
          metricName: "Progress Update",
          value: 0,
          unit: "note",
          notes: update.notes,
          jobId: phase.job.id,
          phaseId: update.phaseId,
        },
      });
      updateSummary.push(`• ${update.jobName} — ${update.phaseName}: ${update.notes}`);
    } catch (err) {
      console.error("Failed to log update for phase", update.phaseId, err);
    }
  }

  const reply =
    updateSummary.length > 0
      ? `Got it! Logged the following updates:\n${updateSummary.join("\n")}`
      : "I received your update but had trouble saving it. Please check the schedule manually.";

  return NextResponse.json({ reply });
}
