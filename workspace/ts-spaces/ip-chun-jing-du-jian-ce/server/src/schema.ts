// Drizzle schema for this space: cached IP purity-check reports.
//
// One row per distinct IP ever checked. Rows double as the 6-hour result
// cache and the user's lookup history (newest check first in the UI).
// `reportJson` holds the full merged report so history entries render
// instantly without re-querying the upstream APIs.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ipChecks = sqliteTable("ip_checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ip: text("ip").notNull().unique(),
  score: integer("score").notNull(),
  grade: text("grade").notNull(),
  ipType: text("ip_type").notNull(),
  country: text("country").notNull().default(""),
  city: text("city").notNull().default(""),
  isp: text("isp").notNull().default(""),
  reportJson: text("report_json").notNull(),
  checkedAt: integer("checked_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
