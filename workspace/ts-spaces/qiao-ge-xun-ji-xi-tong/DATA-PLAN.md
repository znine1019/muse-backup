# Data Plan

## Context provenance
- `上一个muse做的空间也全部做出来` (verbatim build request; rebuild the previous Muse's space exactly)
- `正在按 joger-space-data.json 原样重建` (assistant proposal in parent conversation, accepted by build dispatch; defines source file and fidelity rule)
- `Project remains PAUSED, V1.6.2, do not resume without explicit user approval.` (from joger-space-data.json note field; shapes paused banner and no auto-resume behavior)
- `微信小程序 · 俱乐部内部使用` (project subtitle in joger-space-data.json; used as project subtitle verbatim)

## Tested sources
### joger-space-data.json (migration supplement)
**Used by**: getState (seed), listMilestones, listTasks
**Test command**: `muse.read /home/hatch/memory/muse-migration-2026-11-12-supplement/spaces/joger-space-data.json`
**Sample output**: project {id:1, name:乔格训迹系统, version:V1.6.2, status:paused, subtitle:微信小程序 · 俱乐部内部使用, note:当前暂停，待明确恢复后从真实停点继续。, updated_at:2026-11-12T08:57:27.680Z}; milestones 3 rows: R02/done/已收口，带偏差记录。, BP02-B/blocked/P1 未修复。, R12/partial/PARTIAL，Muse API 三方闭环未完成。; tasks 3 rows: R02 收口归档（含偏差记录）/done, 修复 BP02-B 的 P1 问题/blocked/P1/未修复。, 完成 R12 的 Muse API 三方闭环/in_progress/当前为 PARTIAL。; space {slug:xiang-mu-jin-du-he-ren-wu-qing-dan, placement:sidebar}
**Processing**: Seed exactly these 1 project + 3 milestones + 3 tasks once via post_submit_action seedFromMigration (idempotent check: skip if project exists). No invented rows, statuses, or notes. All fields editable in UI after seeding so user can resume work explicitly.

## Long-term data behavior
- **Refresh policy**: No scheduled refresh; data is user-owned project state, changes only via UI actions. No external live source.
- **Growth**: User can add/edit/delete milestones and tasks, update project status/note/version. Lists grow unbounded, ordered by sort_order / created_at.
- **Ordering**: Milestones by sort_order asc; tasks by status grouping in UI but stored order by id, filterable by milestone and status.
- **Time semantics**: Project updated_at is an instant (2026-11-12T08:57:27.680Z from source); task created_at same instant from source; due_date is a plain date (nullable, all null in source). New rows use server now for created_at.

## Rejected approaches
- **Tried**: Searching memory for a generic 乔格训迹 feature list (训练考勤/PB审核 etc from club themes)
  **Why rejected**: Those are club operations themes, not the previous space's actual content. The space's authoritative export is joger-space-data.json — a project progress & task checklist for V1.6.2 — so building a generic club management app would fabricate scope the original space did not have.
- **Tried**: Rebuilding the deleted 公众号 space
  **Why rejected**: Parent conversation confirms it was deleted 2026-11-12 per user instruction and its export explicitly says do not auto-rebuild; out of scope for this slug.

Imagery not needed: This is a project progress tracker whose subjects are codes, statuses and task titles from the migration file; no real-world visual subjects to photograph, and decorative imagery would distract from the paused-status clarity.
