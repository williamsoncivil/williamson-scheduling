# Williamson Scheduling — Coding Agent Brief

> **Read this first.** This document contains everything you need to work on this app without re-exploring the codebase. Keep it updated as you add features.

---

## What This App Is

A construction project scheduling tool for **Williamson Civil Construction**.  
Live URL: **https://williamson-scheduling.vercel.app**  
GitHub: **williamsoncivil/williamson-scheduling** (branch: `main`)  
Owner: **Tom** — he reviews and approves changes.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router, `src/app/`) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Auth | NextAuth.js (credentials provider, bcrypt passwords) |
| ORM | Prisma |
| Database | PostgreSQL via **Neon** |
| File Storage | Vercel Blob |
| Deployment | Vercel |
| Email | Resend (for @mention notifications) |

---

## Environment Variables (`.env.local`)

```
DATABASE_URL=postgresql://neondb_owner:$DB_PASSWORD@ep-dark-term-ad68a6vn-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
DIRECT_URL=postgresql://neondb_owner:$DB_PASSWORD@ep-dark-term-ad68a6vn.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
NEXTAUTH_URL=http://localhost:3000
BLOB_READ_WRITE_TOKEN=<long token — already in .env.local>
RESEND_API_KEY=<already set in Vercel env — for email notifications>
```

Vercel has all these set as environment variables for production. The `NEXTAUTH_URL` is overridden in Vercel to `https://williamson-scheduling.vercel.app`.

---

## Deployment Process

### ⚠️ Critical: Vercel auto-deploy is BROKEN for this project.

Pushing to `main` on GitHub does NOT automatically update the live site. You must manually trigger + promote the deployment:

**Step 1 — Push your code:**
```bash
git add -A && git commit -m "your message" && git push
```

**Step 2 — Trigger Vercel build (correct repoId is `1178033501`):**
```bash
curl -s -X POST "https://api.vercel.com/v13/deployments?projectId=prj_CXrP3GsxdHYwRgF1nW28P3tqYfod" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"williamson-scheduling","gitSource":{"type":"github","repoId":"1178033501","ref":"main"}}'
```

**Step 3 — Wait ~60 seconds, then check status:**
```bash
curl -s "https://api.vercel.com/v6/deployments?projectId=prj_CXrP3GsxdHYwRgF1nW28P3tqYfod&limit=1" \
  -H "Authorization: Bearer $VERCEL_TOKEN" | python3 -c "import json,sys; d=json.load(sys.stdin); dep=d['deployments'][0]; print(dep['uid'], dep['state'])"
```

**Step 4 — Promote to production (replace DPL_ID with the id from step 3):**
```bash
curl -s -X POST "https://api.vercel.com/v10/deployments/DPL_ID/aliases" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"alias":"williamson-scheduling.vercel.app"}'
```

**Tokens/IDs:**
- Vercel token: `$VERCEL_TOKEN`
- Vercel project ID: `prj_CXrP3GsxdHYwRgF1nW28P3tqYfod`
- GitHub repo ID: `1178033501`
- Production alias: `williamson-scheduling.vercel.app`

---

## Project Structure

```
src/
  app/
    api/
      jobs/[id]/phases/[phaseId]/move/   # cascade preview + commit (old system)
      jobs/[id]/phases/                  # CRUD phases
      jobs/[id]/                         # CRUD job
      phases/[id]/                       # PATCH phase dates → triggers cascade
      phases/[id]/dependencies/          # GET/POST/DELETE PhaseDependency records
      schedule/                          # schedule entries CRUD
      messages/                          # messages + @mentions
      production/                        # production logs
      people/                            # user management
      documents/                         # file metadata
      upload/                            # Vercel Blob upload
    jobs/[id]/page.tsx                   # ← Main job detail page (HUGE — all tabs)
    jobs/[id]/gantt/page.tsx             # Gantt chart view
    jobs/new/page.tsx                    # Create job form
    schedule/page.tsx                    # Company-wide schedule
    schedule/gantt/page.tsx              # Company-wide Gantt
    schedule/timeline/page.tsx           # People timeline
  lib/
    cascade.ts                           # BFS cascade logic for phase dependencies
    prisma.ts                            # Prisma client singleton
    auth.ts                              # NextAuth config
    email.ts                             # Resend email sender
  components/
    Layout.tsx                           # Sidebar + main layout
    CopyJobModal.tsx                     # Copy a job with phases
```

---

## Database Schema (key models)

### User
- `id`, `name`, `email`, `passwordHash`, `role` (ADMIN/EMPLOYEE/SUBCONTRACTOR)
- `emailNotifications: Boolean` — toggle for @mention emails
- Default admin: `tom@williamsoncivil.com` / `admin123`

### Job
- `id`, `name`, `address`, `description`, `status` (ACTIVE/COMPLETED/ARCHIVED), `color`

### Phase
- `id`, `name`, `description`, `orderIndex`, `jobId`
- `startDate`, `endDate` (DateTime?)
- `dependsOnId` — **OLD** simple one-to-one predecessor (legacy, still used)
- `predecessorDeps`, `successorDeps` — **NEW** PhaseDependency relation

### PhaseDependency (NEW system)
- `predecessorId`, `successorId`, `type` (FINISH_TO_START|START_TO_START|FINISH_TO_FINISH|START_TO_FINISH), `lagDays`
- Unique on `(predecessorId, successorId)`
- POST endpoint uses `upsert` — so re-POSTing with same predecessorId updates type/lagDays

### ScheduleEntry
- `jobId`, `phaseId?`, `userId` (worker), `supervisorId?`, `date`, `startTime`, `endTime`, `notes`

### Message / MessageMention
- Messages support `@name` mentions — creates MessageMention records + sends email via Resend

---

## Key Business Logic

### Business Days (skip weekends)
Duration is measured in **working days** (Mon–Fri only). Implemented in:

**Client-side (`jobs/[id]/page.tsx`):**
```typescript
function endFromDuration(start: string, days: number): string
function durationFromDates(start: string, end: string): number | null
function nextBusinessDayAfter(dateStr: string): string
```

**Server-side (`lib/cascade.ts`):**
- Uses `.getUTCDay()` for weekend checks (Prisma dates are UTC)
- `addBusinessDaysUTC()`, `countBusinessDaysUTC()`, `snapToWeekdayUTC()`

### Cascade System
When a phase's dates change, all successor phases cascade forward (BFS, never backward):
1. **Old system** (`/api/jobs/[id]/phases/[phaseId]/move`) — uses `dependsOnId`, used for preview modal
2. **New system** (`lib/cascade.ts` called from `/api/phases/[id]` PATCH) — uses PhaseDependency, supports all 4 dep types + lag days

Both systems are called when saving phase dates (old for preview, new for actual cascade).

### Phase Date Editing Flow
In `jobs/[id]/page.tsx`:
1. User clicks "Edit Dates" → inline editor appears
2. User changes dates or selects "Depends On" → start date auto-fills from predecessor end + 1 business day
3. Save → preview cascade (old system) → if dependents exist, show confirmation modal
4. Confirm → commit via both systems

### Predecessor Auto-Fill
- **Add Phase form**: predecessor dropdown → auto-fills start date, auto-creates PhaseDependency on save
- **Edit Dates panel**: "Depends On" dropdown → auto-fills start date when predecessor selected
- **Add Predecessor modal**: shows "Suggested start: [date]" hint for FINISH_TO_START
- **Edit Predecessor**: "Edit" button on each predecessor → modal to change type/lagDays (upsert via POST)

---

## Features Built (complete list as of Mar 12, 2026)

- [x] Job CRUD (create, edit, archive, delete, copy)
- [x] Phase CRUD with drag-to-reorder
- [x] Phase date editing with duration (working days)
- [x] Business day math — weekends skipped in all duration calculations
- [x] Predecessor/dependency system (PhaseDependency model) with 4 types + lag
- [x] Edit predecessors after creation (type + lag days)
- [x] Auto-fill start date from predecessor end date
- [x] Cascade — moving a phase shifts all successors forward (BFS)
- [x] Cascade preview modal (shows what will shift + scheduling conflicts)
- [x] Cascade toast notification (shows what was auto-shifted)
- [x] Gantt chart — per-job and company-wide (week/month/wholejob views)
- [x] People timeline view
- [x] Schedule entries (assign workers to dates/phases, conflict detection)
- [x] Company-wide schedule calendar
- [x] Messages per job/phase with @mention autocomplete
- [x] @mention email notifications (Resend, toggle per-user in Settings)
- [x] File upload per job/phase (Vercel Blob, auto-categorizes photos vs documents)
- [x] Production logs per job/phase with metrics aggregation
- [x] People management (users/roles)
- [x] Copy job (copies structure + phases with offset dates)
- [x] Job status (ACTIVE/COMPLETED/ARCHIVED)
- [x] Color-coded jobs
- [x] Blocked phase indicators (🔒 when predecessor hasn't finished)
- [x] Dependency indicators (🔗 icon on phases with deps)
- [x] Import from Buildertrend (via scripts/)
- [x] Role-based access (ADMIN sees extra controls)
- [x] Resend email integration for @mentions

---

## Coding Conventions

- **No `any` types** — TypeScript strict
- **All API routes** return `NextResponse.json()`, use `getServerSession` for auth
- **Client components** marked `"use client"` at top
- **date-fns** for all date math — already imported everywhere
- **Tailwind only** — no external CSS files
- **`fetchJob()`** pattern — after any mutation, call `fetchJob()` to refresh state
- **Modal pattern** — modals are fixed-position overlays at bottom of JSX, state controls visibility
- **Form pattern** — `onSubmit` handlers call API then reset state then `fetchJob()`
- **Prisma** — always use `prisma` singleton from `lib/prisma.ts`
- **`format(parseISO(date.split("T")[0]), "MMM d")`** — standard date display pattern

---

## Known Issues / Watch-Outs

1. **Vercel auto-deploy broken** — always manually trigger + promote (see Deployment section)
2. **Two dependency systems** — `dependsOnId` (old/legacy) and `PhaseDependency` (new). Both must stay in sync when updating phase dates
3. **50 phases in 392 West Alder** — makes 50 concurrent dep-fetch calls on page load; acceptable for now but could be batched
4. **Weekend snapping** — if a user manually sets a start date on a weekend, cascade will snap it to Monday. Deliberate behavior.
5. **Cascade only goes forward** — never pulls successor dates earlier, only pushes them later

---

## When You Finish a Task

1. Run `npm run build` to confirm no TypeScript/build errors
2. `git add -A && git commit -m "feat/fix: description"`
3. `git push`
4. Trigger Vercel deployment (Step 2–4 in Deployment section above)
5. Run the notify command:
   ```bash
   openclaw system event --text "Done: [what was built/fixed]" --mode now
   ```

---

## Credentials Location

All actual tokens/passwords are stored in:
- `.env.local` (local dev, gitignored)  
- Vercel project environment variables (production)
- Rook's `MEMORY.md` in the OpenClaw workspace (for the coding agent context)

Never commit real credentials to this repo.
