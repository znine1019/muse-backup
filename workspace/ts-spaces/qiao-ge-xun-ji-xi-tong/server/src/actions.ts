import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { asc, eq } from "drizzle-orm";
import * as schema from "./schema";

const projectStatus = z.enum(["paused", "in_progress", "done"]);
const milestoneStatus = z.enum(["done", "blocked", "partial", "in_progress", "not_started"]);
const taskStatus = z.enum(["done", "blocked", "in_progress", "todo"]);

const projectObj = z.object({
  id: z.number(),
  name: z.string(),
  subtitle: z.string(),
  version: z.string(),
  status: projectStatus,
  note: z.string(),
  updated_at: z.string(),
});
const milestoneObj = z.object({
  id: z.number(),
  code: z.string(),
  title: z.string(),
  status: milestoneStatus,
  note: z.string(),
  sort_order: z.number(),
});
const taskObj = z.object({
  id: z.number(),
  title: z.string(),
  milestone_code: z.string(),
  status: taskStatus,
  priority: z.string(),
  note: z.string(),
  due_date: z.string().nullable(),
  created_at: z.string(),
});

const okRes = z.object({ ok: z.literal(true) });

export const Actions = {
  getState: defineAction({
    description: "Returns the project, its milestones and tasks exactly as stored.",
    request: z.object({}),
    response: z.object({
      project: projectObj.nullable(),
      milestones: z.array(milestoneObj),
      tasks: z.array(taskObj),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const projs = await db.select().from(schema.projects).limit(1);
      const ms = await db.select().from(schema.milestones).orderBy(asc(schema.milestones.sortOrder), asc(schema.milestones.id));
      const ts = await db.select().from(schema.tasks).orderBy(asc(schema.tasks.id));
      const p = projs[0];
      return {
        project: p ? { id: p.id, name: p.name, subtitle: p.subtitle, version: p.version, status: p.status, note: p.note, updated_at: p.updatedAt.toISOString() } : null,
        milestones: ms.map(m => ({ id: m.id, code: m.code, title: m.title, status: m.status, note: m.note, sort_order: m.sortOrder })),
        tasks: ts.map(t => ({ id: t.id, title: t.title, milestone_code: t.milestoneCode, status: t.status, priority: t.priority, note: t.note, due_date: t.dueDate, created_at: t.createdAt.toISOString() })),
      };
    },
  }),

  seedFromMigration: defineAction({
    description: "Seeds the original 乔格训迹系统 space data from joger-space-data.json once; no-op if already seeded.",
    request: z.object({}),
    response: z.object({ seeded: z.boolean(), already: z.boolean() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.projects).limit(1);
      if (existing.length > 0) return { seeded: false, already: true };
      const ts = new Date("2026-11-12T08:57:27.680Z");
      await db.insert(schema.projects).values({
        id: 1, name: "乔格训迹系统", subtitle: "微信小程序 · 俱乐部内部使用", version: "V1.6.2", status: "paused", note: "当前暂停，待明确恢复后从真实停点继续。", updatedAt: ts,
      });
      await db.insert(schema.milestones).values([
        { id: 1, code: "R02", title: "R02 收口", status: "done", note: "已收口，带偏差记录。", sortOrder: 1 },
        { id: 2, code: "BP02-B", title: "BP02-B 问题修复", status: "blocked", note: "P1 未修复。", sortOrder: 2 },
        { id: 3, code: "R12", title: "R12 · Muse API 三方闭环", status: "partial", note: "PARTIAL，Muse API 三方闭环未完成。", sortOrder: 3 },
      ]);
      await db.insert(schema.tasks).values([
        { id: 1, title: "R02 收口归档（含偏差记录）", milestoneCode: "R02", status: "done", priority: "normal", note: "", dueDate: null, createdAt: ts },
        { id: 2, title: "修复 BP02-B 的 P1 问题", milestoneCode: "BP02-B", status: "blocked", priority: "P1", note: "未修复。", dueDate: null, createdAt: ts },
        { id: 3, title: "完成 R12 的 Muse API 三方闭环", milestoneCode: "R12", status: "in_progress", priority: "normal", note: "当前为 PARTIAL。", dueDate: null, createdAt: ts },
      ]);
      ctx.invalidateQueries();
      return { seeded: true, already: false };
    },
  }),

  updateProject: defineAction({
    description: "Updates project name, subtitle, version, status or note.",
    request: z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      subtitle: z.string().optional(),
      version: z.string().optional(),
      status: projectStatus.optional(),
      note: z.string().optional(),
    }),
    response: okRes,
    async handler(ctx, args): Promise<z.infer<typeof okRes>> {
      const db = ctx.db<typeof schema>();
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (args.name !== undefined) patch.name = args.name;
      if (args.subtitle !== undefined) patch.subtitle = args.subtitle;
      if (args.version !== undefined) patch.version = args.version;
      if (args.status !== undefined) patch.status = args.status;
      if (args.note !== undefined) patch.note = args.note;
      await db.update(schema.projects).set(patch).where(eq(schema.projects.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  createMilestone: defineAction({
    description: "Creates a new milestone.",
    request: z.object({ code: z.string().min(1), title: z.string().min(1), status: milestoneStatus.default("not_started"), note: z.string().default(""), sort_order: z.number().int().default(99) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const r = await db.insert(schema.milestones).values({ code: args.code, title: args.title, status: args.status, note: args.note, sortOrder: args.sort_order }).returning({ id: schema.milestones.id });
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  updateMilestone: defineAction({
    description: "Updates a milestone's fields or status.",
    request: z.object({ id: z.number(), code: z.string().min(1).optional(), title: z.string().min(1).optional(), status: milestoneStatus.optional(), note: z.string().optional(), sort_order: z.number().int().optional() }),
    response: okRes,
    async handler(ctx, args): Promise<z.infer<typeof okRes>> {
      const db = ctx.db<typeof schema>();
      const patch: Record<string, unknown> = {};
      if (args.code !== undefined) patch.code = args.code;
      if (args.title !== undefined) patch.title = args.title;
      if (args.status !== undefined) patch.status = args.status;
      if (args.note !== undefined) patch.note = args.note;
      if (args.sort_order !== undefined) patch.sortOrder = args.sort_order;
      if (Object.keys(patch).length) await db.update(schema.milestones).set(patch).where(eq(schema.milestones.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteMilestone: defineAction({
    description: "Deletes a milestone by id.",
    request: z.object({ id: z.number() }),
    response: okRes,
    async handler(ctx, args): Promise<z.infer<typeof okRes>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.milestones).where(eq(schema.milestones.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  createTask: defineAction({
    description: "Creates a new task, optionally linked to a milestone code.",
    request: z.object({ title: z.string().min(1), milestone_code: z.string().default(""), status: taskStatus.default("todo"), priority: z.string().default("normal"), note: z.string().default(""), due_date: z.string().nullable().default(null) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const r = await db.insert(schema.tasks).values({ title: args.title, milestoneCode: args.milestone_code, status: args.status, priority: args.priority, note: args.note, dueDate: args.due_date }).returning({ id: schema.tasks.id });
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  updateTask: defineAction({
    description: "Updates a task's title, milestone, status, priority, note or due date.",
    request: z.object({ id: z.number(), title: z.string().min(1).optional(), milestone_code: z.string().optional(), status: taskStatus.optional(), priority: z.string().optional(), note: z.string().optional(), due_date: z.string().nullable().optional() }),
    response: okRes,
    async handler(ctx, args): Promise<z.infer<typeof okRes>> {
      const db = ctx.db<typeof schema>();
      const patch: Record<string, unknown> = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.milestone_code !== undefined) patch.milestoneCode = args.milestone_code;
      if (args.status !== undefined) patch.status = args.status;
      if (args.priority !== undefined) patch.priority = args.priority;
      if (args.note !== undefined) patch.note = args.note;
      if (args.due_date !== undefined) patch.dueDate = args.due_date;
      if (Object.keys(patch).length) await db.update(schema.tasks).set(patch).where(eq(schema.tasks.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteTask: defineAction({
    description: "Deletes a task by id.",
    request: z.object({ id: z.number() }),
    response: okRes,
    async handler(ctx, args): Promise<z.infer<typeof okRes>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.tasks).where(eq(schema.tasks.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),
} satisfies ActionsModule;
