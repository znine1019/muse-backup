import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  version: text("version").notNull().default(""),
  status: text("status", { enum: ["paused", "in_progress", "done"] }).notNull().default("paused"),
  note: text("note").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const milestones = sqliteTable("milestones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull(),
  title: text("title").notNull(),
  status: text("status", { enum: ["done", "blocked", "partial", "in_progress", "not_started"] }).notNull().default("not_started"),
  note: text("note").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  milestoneCode: text("milestone_code").notNull().default(""),
  status: text("status", { enum: ["done", "blocked", "in_progress", "todo"] }).notNull().default("todo"),
  priority: text("priority").notNull().default("normal"),
  note: text("note").notNull().default(""),
  dueDate: text("due_date"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
