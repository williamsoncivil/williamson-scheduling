/**
 * Import script: 392 West Alder schedule from Buildertrend
 * Reads buildertrend-392-west-alder.json and populates the database.
 *
 * Run with: npx tsx scripts/import-392-west-alder.ts
 */

import { PrismaClient, DependencyType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as path from 'path';

const prisma = new PrismaClient();

// ─── Types ──────────────────────────────────────────────────────────────────

interface BtAssignee {
  id: number;
  name: string;
}

interface BtPredecessor {
  id: number;
  predecessorItemId: number;
  predecessorItemName: string;
  type: string;
  lagDays: number;
}

interface BtItem {
  id: number;
  title: string;
  jobId: number;
  jobName: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  phase: string | null;
  percentComplete: number;
  isCompleted: boolean;
  completedDate: string | null;
  assignees: BtAssignee[];
  predecessors: BtPredecessor[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapDependencyType(btType: string): DependencyType {
  switch (btType) {
    case 'Finish-to-Start (FS)': return DependencyType.FINISH_TO_START;
    case 'Start-to-Start (SS)':  return DependencyType.START_TO_START;
    case 'Finish-to-Finish (FF)': return DependencyType.FINISH_TO_FINISH;
    case 'Start-to-Finish (SF)': return DependencyType.START_TO_FINISH;
    default:
      console.warn(`  ⚠ Unknown dependency type "${btType}", defaulting to FINISH_TO_START`);
      return DependencyType.FINISH_TO_START;
  }
}

function emailFromName(name: string): string {
  // "Tom Williamson" → "tom.williamson@williamsoncivil.com"
  return name.toLowerCase().replace(/\s+/g, '.') + '@williamsoncivil.com';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting import: 392 West Alder\n');

  // Load data
  const dataPath = path.join(__dirname, '..', 'buildertrend-392-west-alder.json');
  const items: BtItem[] = require(dataPath);
  console.log(`📋 Loaded ${items.length} Buildertrend items`);

  // ── 1. Create/find the Job ────────────────────────────────────────────────
  const jobName = '392 West Alder';
  const firstItem = items[0];
  const lastItem = items[items.length - 1];

  let job = await prisma.job.findFirst({ where: { name: jobName } });
  if (job) {
    console.log(`\n✅ Job already exists: "${jobName}" (id: ${job.id})`);
  } else {
    job = await prisma.job.create({
      data: {
        name: jobName,
        address: '392 West Alder',
        status: 'ACTIVE',
      },
    });
    console.log(`\n✅ Created Job: "${jobName}" (id: ${job.id})`);
  }

  // ── 2. Create/find Users ──────────────────────────────────────────────────
  const assigneeNames = new Set<string>();
  for (const item of items) {
    for (const a of item.assignees) assigneeNames.add(a.name);
  }
  console.log(`\n👤 Unique assignees: ${Array.from(assigneeNames).join(', ')}`);

  const passwordHash = await bcrypt.hash('changeme123', 10);
  const userMap = new Map<string, string>(); // name → prisma user id

  for (const name of assigneeNames) {
    const email = emailFromName(name);
    let user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      console.log(`  ✅ Found existing user: ${name} (${email})`);
    } else {
      user = await prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
          role: 'USER',
        },
      });
      console.log(`  ➕ Created user: ${name} (${email})`);
    }
    userMap.set(name, user.id);
  }

  // ── 3. Create Phases ──────────────────────────────────────────────────────
  console.log(`\n📦 Creating ${items.length} phases...`);

  // btItemId (number) → prisma Phase id (string)
  const phaseIdMap = new Map<number, string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Check if a phase with this name already exists for this job
    const existing = await prisma.phase.findFirst({
      where: { jobId: job.id, name: item.title },
    });

    let phaseId: string;
    if (existing) {
      phaseId = existing.id;
      console.log(`  ✅ Phase already exists: "${item.title}"`);
    } else {
      const phase = await prisma.phase.create({
        data: {
          name: item.title,
          jobId: job.id,
          startDate: new Date(item.startDate),
          endDate: new Date(item.endDate),
          orderIndex: i,
        },
      });
      phaseId = phase.id;
      console.log(`  ➕ Created phase [${i}]: "${item.title}"`);
    }

    phaseIdMap.set(item.id, phaseId);
  }

  // ── 4. Create ScheduleEntries ─────────────────────────────────────────────
  console.log(`\n📅 Creating schedule entries...`);

  for (const item of items) {
    if (item.assignees.length === 0) continue;

    const phaseId = phaseIdMap.get(item.id);
    if (!phaseId) continue;

    for (const assignee of item.assignees) {
      const userId = userMap.get(assignee.name);
      if (!userId) {
        console.warn(`  ⚠ No user found for assignee "${assignee.name}", skipping`);
        continue;
      }

      // Check if entry already exists
      const existing = await prisma.scheduleEntry.findFirst({
        where: { jobId: job.id, phaseId, userId },
      });
      if (existing) {
        console.log(`  ✅ Schedule entry already exists for "${assignee.name}" → "${item.title}"`);
        continue;
      }

      await prisma.scheduleEntry.create({
        data: {
          jobId: job.id,
          phaseId,
          userId,
          date: new Date(item.startDate),
          startTime: '08:00',
          endTime: '17:00',
          notes: item.endDate !== item.startDate
            ? `Phase spans ${item.durationDays} day(s), ends ${item.endDate.split('T')[0]}`
            : undefined,
        },
      });
      console.log(`  ➕ Schedule entry: "${assignee.name}" → "${item.title}"`);
    }
  }

  // ── 5. Create PhaseDependencies ───────────────────────────────────────────
  console.log(`\n🔗 Creating phase dependencies...`);

  let depCount = 0;
  let skipCount = 0;

  for (const item of items) {
    if (item.predecessors.length === 0) continue;

    const successorId = phaseIdMap.get(item.id);
    if (!successorId) {
      console.warn(`  ⚠ No phase found for successor item "${item.title}" (id: ${item.id})`);
      continue;
    }

    for (const pred of item.predecessors) {
      const predecessorId = phaseIdMap.get(pred.predecessorItemId);
      if (!predecessorId) {
        console.warn(`  ⚠ No phase found for predecessor "${pred.predecessorItemName}" (id: ${pred.predecessorItemId}) — skipping`);
        skipCount++;
        continue;
      }

      const depType = mapDependencyType(pred.type);

      try {
        await prisma.phaseDependency.create({
          data: {
            predecessorId,
            successorId,
            type: depType,
            lagDays: pred.lagDays,
          },
        });
        console.log(`  ➕ Dep: "${pred.predecessorItemName}" → "${item.title}" [${pred.type}, lag: ${pred.lagDays}d]`);
        depCount++;
      } catch (err: any) {
        if (err?.code === 'P2002') {
          // Unique constraint: already exists
          console.log(`  ✅ Dep already exists: "${pred.predecessorItemName}" → "${item.title}"`);
        } else {
          throw err;
        }
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────');
  console.log('✅ Import complete!');
  console.log(`   Job:          ${jobName} (${job.id})`);
  console.log(`   Phases:       ${phaseIdMap.size}`);
  console.log(`   Users:        ${userMap.size}`);
  console.log(`   Dependencies: ${depCount} created, ${skipCount} skipped`);
  console.log('─────────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
