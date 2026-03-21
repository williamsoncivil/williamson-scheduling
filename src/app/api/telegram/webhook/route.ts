import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function sendTelegramMessage(chatId: string | number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body?.message;
    if (!message?.text || !message?.chat?.id) {
      return NextResponse.json({ ok: true });
    }

    const chatId = String(message.chat.id);
    const text: string = message.text;

    // Handle /start command
    if (text.startsWith("/start")) {
      await sendTelegramMessage(chatId, `Hi! I'm the Siteworks scheduling bot. Your chat ID is: ${chatId}\n\nEnter this in your Siteworks settings to receive end-of-day prompts.`);
      return NextResponse.json({ ok: true });
    }

    // Look up user by telegramChatId
    const user = await prisma.user.findFirst({
      where: { telegramChatId: chatId },
    });

    if (!user) {
      await sendTelegramMessage(chatId, "I don't recognize this Telegram account. Please link it in your Siteworks settings.");
      return NextResponse.json({ ok: true });
    }

    // Skip other commands
    if (text.startsWith("/")) {
      return NextResponse.json({ ok: true });
    }

    // Fetch active jobs+phases for this user
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const scheduleEntries = await prisma.scheduleEntry.findMany({
      where: { userId: user.id, date: { gte: today } },
      include: {
        job: { select: { id: true, name: true } },
        phase: { select: { id: true, name: true } },
      },
      take: 20,
    });

    const phases = await prisma.phase.findMany({
      where: {
        job: { status: "ACTIVE" },
        startDate: { lte: new Date() },
        endDate: { gte: today },
      },
      include: { job: { select: { id: true, name: true } } },
      take: 30,
    });

    const phaseContext = phases.map(p => `- Phase ID: ${p.id}, Job: "${p.job.name}", Phase: "${p.name}"`).join("\n");

    let parsedUpdates: { phaseId: string; jobName: string; phaseName: string; notes: string }[] = [];

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a construction scheduling assistant. Parse the user's progress update message and match it to the relevant phases below.

Active phases:
${phaseContext || "No active phases found."}

Return a JSON object with this structure:
{
  "updates": [
    { "phaseId": "<id>", "jobName": "<name>", "phaseName": "<name>", "notes": "<parsed progress note>" }
  ]
}

Only include phases that are clearly mentioned or can be inferred. If nothing matches, return { "updates": [] }.`,
          },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
      });

      const parsed = JSON.parse(completion.choices[0].message.content ?? "{}");
      parsedUpdates = parsed.updates ?? [];
    } catch (err) {
      console.error("OpenAI parse error:", err);
      await sendTelegramMessage(chatId, "Got your message! I had trouble parsing it automatically — please update the schedule manually.");
      return NextResponse.json({ ok: true });
    }

    if (parsedUpdates.length === 0) {
      await sendTelegramMessage(chatId, "Got your message! I couldn't match it to any active phases — please update the schedule manually.");
      return NextResponse.json({ ok: true });
    }

    // Log updates as ProductionLog entries
    const updateSummary: string[] = [];
    for (const update of parsedUpdates) {
      try {
        await prisma.productionLog.create({
          data: {
            date: new Date(),
            metricName: "Progress Update",
            value: 0,
            unit: "note",
            notes: update.notes,
            jobId: phases.find(p => p.id === update.phaseId)?.job.id ?? "",
            phaseId: update.phaseId,
          },
        });
        updateSummary.push(`• ${update.jobName} — ${update.phaseName}: ${update.notes}`);
      } catch (err) {
        console.error("Failed to log update for phase", update.phaseId, err);
      }
    }

    const reply = updateSummary.length > 0
      ? `Got it! Updated:\n${updateSummary.join("\n")}`
      : "Got your message! I had trouble saving the updates — please check the schedule manually.";

    await sendTelegramMessage(chatId, reply);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}
