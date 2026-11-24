import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";

type State = ApiResponse<typeof api, "getState">;
type Milestone = State["milestones"][number];
type Task = State["tasks"][number];

const MS_LABEL: Record<string, string> = { done: "已完成", blocked: "受阻", partial: "部分完成", in_progress: "进行中", not_started: "未开始" };
const TASK_LABEL: Record<string, string> = { done: "已完成", blocked: "受阻", in_progress: "进行中", todo: "待办" };
const PROJ_LABEL: Record<string, string> = { paused: "已暂停 PAUSED", in_progress: "进行中", done: "已完成" };

function statusColor(s: string) {
  if (s === "done") return "var(--done)";
  if (s === "blocked") return "var(--blocked)";
  if (s === "partial" || s === "in_progress") return "var(--partial)";
  return "var(--dim)";
}
function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" }); } catch { return iso; }
}

export function App() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["state"], queryFn: () => api.getState({}) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["state"] });

  const [filterMs, setFilterMs] = useState<string>("all");
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddMs, setShowAddMs] = useState(false);
  const [editingTask, setEditingTask] = useState<number | null>(null);
  const [editingMs, setEditingMs] = useState<number | null>(null);
  const [confirmResume, setConfirmResume] = useState(false);
  const [confirmDeleteTask, setConfirmDeleteTask] = useState<number | null>(null);
  const [confirmDeleteMs, setConfirmDeleteMs] = useState<number | null>(null);

  const updateProject = useMutation({ mutationFn: (a: Parameters<typeof api.updateProject>[0]) => api.updateProject(a), onSuccess: invalidate });
  const createTask = useMutation({ mutationFn: (a: Parameters<typeof api.createTask>[0]) => api.createTask(a), onSuccess: () => { invalidate(); setShowAddTask(false); } });
  const updateTask = useMutation({ mutationFn: (a: Parameters<typeof api.updateTask>[0]) => api.updateTask(a), onSuccess: () => { invalidate(); setEditingTask(null); } });
  const deleteTask = useMutation({ mutationFn: (a: { id: number }) => api.deleteTask(a), onSuccess: () => { invalidate(); setConfirmDeleteTask(null); } });
  const createMs = useMutation({ mutationFn: (a: Parameters<typeof api.createMilestone>[0]) => api.createMilestone(a), onSuccess: () => { invalidate(); setShowAddMs(false); } });
  const updateMs = useMutation({ mutationFn: (a: Parameters<typeof api.updateMilestone>[0]) => api.updateMilestone(a), onSuccess: () => { invalidate(); setEditingMs(null); } });
  const deleteMs = useMutation({ mutationFn: (a: { id: number }) => api.deleteMilestone(a), onSuccess: () => { invalidate(); setConfirmDeleteMs(null); } });
  const seed = useMutation({ mutationFn: () => api.seedFromMigration({}), onSuccess: invalidate });

  if (state.isPending) return <div className="min-h-screen bg-[var(--bg)] px-4 py-16 text-center text-sm text-[var(--dim)]">加载中…</div>;
  if (state.error) return <div className="min-h-screen bg-[var(--bg)] px-4 py-16 text-center"><p className="text-sm text-[var(--blocked)]">加载失败</p><button aria-label="重试加载" onClick={() => state.refetch()} className="mt-4 rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white">重试</button></div>;

  const project = state.data.project;
  const milestones = state.data.milestones;
  const tasks = state.data.tasks;

  if (!project) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <main className="mx-auto max-w-2xl px-4 py-16 text-center">
          <p className="mono text-xs tracking-widest text-[var(--dim)]">QIÁOGÉ · TRACK</p>
          <h1 className="mt-3 text-2xl font-bold">乔格训迹系统</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--dim)]">还没有项目数据。导入上一个 Muse 导出的原始记录（V1.6.2、3 个里程碑、3 个任务）后，这里就是原来的进度看板。</p>
          <button aria-label="导入原始记录" onClick={() => seed.mutate()} disabled={seed.isPending} className="mt-6 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white disabled:opacity-50">{seed.isPending ? "导入中…" : "导入原始记录"}</button>
          {seed.error ? <p className="mt-3 text-sm text-[var(--blocked)]">导入失败，请重试</p> : null}
        </main>
      </div>
    );
  }

  const doneCount = milestones.filter(m => m.status === "done").length;
  const filteredTasks = filterMs === "all" ? tasks : tasks.filter(t => t.milestone_code === filterMs);
  const isPaused = project.status === "paused";

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-5 sm:px-6">

        {/* Hero: paused board */}
        <section aria-label="项目状态">
          <div className="flex items-center gap-2">
            <span className="mono text-[11px] font-bold tracking-[0.18em] text-[var(--accent)]">乔格体育 · 内部</span>
            <span className="h-px flex-1 bg-[var(--border)]" />
            <span className="mono text-[11px] text-[var(--dim)]">{fmtDate(project.updated_at)} 更新</span>
          </div>
          <h1 className="mt-3 text-[32px] font-black leading-tight tracking-tight">{project.name}</h1>
          <p className="mt-1 text-sm text-[var(--dim)]">{project.subtitle}</p>

          <div className="mt-5 overflow-hidden rounded-[var(--radius)] bg-[#1A1815] text-[#FAF7F2] dark:bg-[#000]">
            <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
              <div>
                <p className="mono text-[11px] tracking-[0.2em] text-white/50">当前版本</p>
                <p className="mono mt-1 text-4xl font-black">{project.version}</p>
              </div>
              <span className={`rounded-md px-3 py-2 mono text-sm font-black tracking-wider ${isPaused ? "bg-[var(--accent)] text-white" : "bg-emerald-600 text-white"}`}>{PROJ_LABEL[project.status] ?? project.status}</span>
            </div>
            <p className="px-5 pt-3 text-sm leading-6 text-white/80">{project.note}</p>

            {/* progress track */}
            <div className="px-5 pb-2 pt-5" role="img" aria-label={`里程碑进度：${milestones.length} 个中 ${doneCount} 个已完成`}>
              <div className="flex gap-1.5">
                {milestones.map(m => (
                  <div key={m.id} className="h-2.5 flex-1 rounded-full" style={{ background: statusColor(m.status), opacity: m.status === "not_started" ? 0.3 : 1 }} />
                ))}
                {milestones.length === 0 ? <div className="h-2.5 flex-1 rounded-full bg-white/20" /> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pb-3">
                {milestones.map(m => (
                  <span key={m.id} className="mono text-[11px] text-white/70">{m.code} · {MS_LABEL[m.status]}</span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-white/10 px-5 py-4">
              {isPaused && !confirmResume && (
                <button aria-label="恢复项目" onClick={() => setConfirmResume(true)} className="rounded-full bg-white px-4 py-2 text-sm font-bold text-black">恢复项目</button>
              )}
              {isPaused && confirmResume && (
                <>
                  <span className="w-full text-xs text-white/70">确认恢复？恢复后状态改为「进行中」，原停点记录不变。</span>
                  <button aria-label="确认恢复项目" onClick={() => { updateProject.mutate({ id: project.id, status: "in_progress" }); setConfirmResume(false); }} className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white">确认恢复</button>
                  <button aria-label="取消恢复项目" onClick={() => setConfirmResume(false)} className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white">取消</button>
                </>
              )}
              {!isPaused && project.status !== "done" && (
                <button aria-label="暂停项目" onClick={() => updateProject.mutate({ id: project.id, status: "paused" })} className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white">暂停项目</button>
              )}
              <ProjectEdit project={project} onSave={(patch) => updateProject.mutate({ id: project.id, ...patch })} />
            </div>
          </div>
          {isPaused && <p className="mt-3 text-xs leading-5 text-[var(--dim)]">项目保持暂停。没有你的明确操作，不会启动开发、补测或部署；下面的状态和备注按原记录保留，可随时编辑。</p>}
        </section>

        {/* Milestones */}
        <section aria-label="里程碑" className="mt-10">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-black">里程碑 <span className="mono text-sm font-normal text-[var(--dim)]">{milestones.length}</span></h2>
            <button aria-label="新增里程碑" onClick={() => setShowAddMs(v => !v)} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold">{showAddMs ? "收起" : "+ 新增"}</button>
          </div>

          {showAddMs && (
            <MilestoneForm
              submitLabel="添加里程碑"
              onSubmit={(v) => createMs.mutate({ code: v.code, title: v.title, status: v.status as Milestone["status"], note: v.note, sort_order: v.sort_order })}
            />
          )}

          <div className="mt-4 space-y-3">
            {milestones.map((m, idx) => (
              <article key={m.id} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start gap-3">
                  <span className="mono mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface2)] text-xs font-black">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono text-sm font-black">{m.code}</span>
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: statusColor(m.status) }}>{MS_LABEL[m.status]}</span>
                      {tasks.filter(t => t.milestone_code === m.code).length > 0 && <span className="text-[11px] text-[var(--dim)]">{tasks.filter(t => t.milestone_code === m.code && t.status === "done").length}/{tasks.filter(t => t.milestone_code === m.code).length} 任务完成</span>}
                    </div>
                    <h3 className="mt-1 font-bold leading-snug">{m.title}</h3>
                    {m.note ? <p className="mt-1 text-sm leading-6 text-[var(--dim)]">{m.note}</p> : null}
                  </div>
                </div>
                {editingMs === m.id ? (
                  <MilestoneForm initial={m} submitLabel="保存里程碑" onSubmit={(v) => updateMs.mutate({ id: m.id, code: v.code, title: v.title, status: v.status as Milestone["status"], note: v.note, sort_order: v.sort_order })} onCancel={() => setEditingMs(null)} />
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2 pl-12">
                    <label className="sr-only" htmlFor={`ms-status-${m.id}`}>里程碑 {m.code} 状态</label>
                    <select id={`ms-status-${m.id}`} aria-label={`里程碑 ${m.code} 状态`} value={m.status} onChange={e => updateMs.mutate({ id: m.id, status: e.target.value as Milestone["status"] })} className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 text-sm">
                      {Object.entries(MS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <button aria-label={`编辑里程碑 ${m.code}`} onClick={() => setEditingMs(m.id)} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm font-semibold">编辑</button>
                    {confirmDeleteMs === m.id ? (
                      <>
                        <button aria-label={`确认删除里程碑 ${m.code}`} onClick={() => deleteMs.mutate({ id: m.id })} className="rounded-full bg-[var(--blocked)] px-3 py-1.5 text-sm font-bold text-white">确认删除</button>
                        <button aria-label="取消删除里程碑" onClick={() => setConfirmDeleteMs(null)} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm">取消</button>
                      </>
                    ) : (
                      <button aria-label={`删除里程碑 ${m.code}`} onClick={() => setConfirmDeleteMs(m.id)} className="rounded-full px-3 py-1.5 text-sm text-[var(--blocked)]">删除</button>
                    )}
                  </div>
                )}
              </article>
            ))}
            {milestones.length === 0 && <p className="rounded-[var(--radius)] border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--dim)]">暂无里程碑，点「新增」添加第一个。</p>}
          </div>
        </section>

        {/* Tasks */}
        <section aria-label="任务清单" className="mt-10">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-black">任务清单 <span className="mono text-sm font-normal text-[var(--dim)]">{tasks.length}</span></h2>
            <button aria-label="新增任务" onClick={() => setShowAddTask(v => !v)} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold">{showAddTask ? "收起" : "+ 新增"}</button>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="按里程碑筛选任务">
            {["all", ...milestones.map(m => m.code)].map(code => (
              <button key={code} aria-label={code === "all" ? "显示全部任务" : `只看 ${code} 的任务`} aria-pressed={filterMs === code} onClick={() => setFilterMs(code)} className={`mono shrink-0 rounded-full px-3.5 py-2 text-sm font-bold ${filterMs === code ? "bg-[var(--text)] text-[var(--bg)]" : "border border-[var(--border)] bg-[var(--surface)]"}`}>{code === "all" ? "全部" : code}</button>
            ))}
          </div>

          {showAddTask && <TaskForm milestones={milestones} submitLabel="添加任务" onSubmit={(v) => createTask.mutate({ title: v.title, milestone_code: v.milestone_code, status: v.status as Task["status"], priority: v.priority, note: v.note, due_date: v.due_date })} />}

          <div className="mt-3 space-y-2.5">
            {filteredTasks.map(t => (
              <article key={t.id} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start gap-3">
                  <button
                    aria-label={t.status === "done" ? `将任务「${t.title}」标记为待办` : `将任务「${t.title}」标记为已完成`}
                    onClick={() => updateTask.mutate({ id: t.id, status: t.status === "done" ? "todo" : "done" })}
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-black ${t.status === "done" ? "border-[var(--done)] bg-[var(--done)] text-white" : "border-[var(--border)] text-transparent"}`}
                  >✓</button>
                  <div className="min-w-0 flex-1">
                    <h3 className={`font-bold leading-snug ${t.status === "done" ? "text-[var(--dim)] line-through decoration-2" : ""}`}>{t.title}</h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {t.milestone_code && <span className="mono rounded bg-[var(--surface2)] px-1.5 py-0.5 text-[11px] font-bold">{t.milestone_code}</span>}
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: statusColor(t.status) }}>{TASK_LABEL[t.status]}</span>
                      {t.priority !== "normal" && <span className="rounded-full bg-[var(--blocked)] px-2 py-0.5 text-[11px] font-bold text-white">{t.priority}</span>}
                      {t.due_date && <span className="text-[11px] text-[var(--dim)]">截止 {t.due_date}</span>}
                    </div>
                    {t.note ? <p className="mt-1.5 text-sm leading-6 text-[var(--dim)]">{t.note}</p> : null}
                  </div>
                </div>
                {editingTask === t.id ? (
                  <TaskForm milestones={milestones} initial={t} submitLabel="保存任务" onSubmit={(v) => updateTask.mutate({ id: t.id, title: v.title, milestone_code: v.milestone_code, status: v.status as Task["status"], priority: v.priority, note: v.note, due_date: v.due_date })} onCancel={() => setEditingTask(null)} />
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2 pl-10">
                    <label className="sr-only" htmlFor={`task-status-${t.id}`}>任务状态</label>
                    <select id={`task-status-${t.id}`} aria-label={`任务「${t.title}」状态`} value={t.status} onChange={e => updateTask.mutate({ id: t.id, status: e.target.value as Task["status"] })} className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 text-sm">
                      {Object.entries(TASK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <button aria-label={`编辑任务 ${t.title}`} onClick={() => setEditingTask(t.id)} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm font-semibold">编辑</button>
                    {confirmDeleteTask === t.id ? (
                      <>
                        <button aria-label={`确认删除任务 ${t.title}`} onClick={() => deleteTask.mutate({ id: t.id })} className="rounded-full bg-[var(--blocked)] px-3 py-1.5 text-sm font-bold text-white">确认删除</button>
                        <button aria-label="取消删除任务" onClick={() => setConfirmDeleteTask(null)} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm">取消</button>
                      </>
                    ) : (
                      <button aria-label={`删除任务 ${t.title}`} onClick={() => setConfirmDeleteTask(t.id)} className="rounded-full px-3 py-1.5 text-sm text-[var(--blocked)]">删除</button>
                    )}
                  </div>
                )}
              </article>
            ))}
            {filteredTasks.length === 0 && <p className="rounded-[var(--radius)] border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--dim)]">{filterMs === "all" ? "暂无任务，点「新增」添加第一个。" : `${filterMs} 下暂无任务。`}</p>}
          </div>

          <footer className="mt-10 border-t border-[var(--border)] pt-4 text-xs leading-5 text-[var(--dim)]">
            原始记录来源：上一个 Muse 导出 <span className="mono">joger-space-data.json</span>（2026-11-12）。项目、里程碑与任务的状态和备注按原样录入，此后修改以你在这里的操作为准。
          </footer>
        </section>
      </main>
    </div>
  );
}

function ProjectEdit({ project, onSave }: { project: NonNullable<State["project"]>; onSave: (p: { name?: string; subtitle?: string; version?: string; note?: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [subtitle, setSubtitle] = useState(project.subtitle);
  const [version, setVersion] = useState(project.version);
  const [note, setNote] = useState(project.note);
  if (!open) return <button aria-label="编辑项目信息" onClick={() => { setName(project.name); setSubtitle(project.subtitle); setVersion(project.version); setNote(project.note); setOpen(true); }} className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white">编辑项目信息</button>;
  return (
    <form aria-label="编辑项目信息表单" className="w-full space-y-2 rounded-xl bg-white/10 p-3" onSubmit={(e: FormEvent) => { e.preventDefault(); onSave({ name, subtitle, version, note }); setOpen(false); }}>
      <div><label htmlFor="pe-name" className="text-xs text-white/60">项目名称</label><input id="pe-name" aria-label="项目名称" value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-lg bg-white px-3 py-2 text-sm text-black" required /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label htmlFor="pe-sub" className="text-xs text-white/60">副标题</label><input id="pe-sub" aria-label="项目副标题" value={subtitle} onChange={e => setSubtitle(e.target.value)} className="mt-1 w-full rounded-lg bg-white px-3 py-2 text-sm text-black" /></div>
        <div><label htmlFor="pe-ver" className="text-xs text-white/60">版本</label><input id="pe-ver" aria-label="项目版本" value={version} onChange={e => setVersion(e.target.value)} className="mono mt-1 w-full rounded-lg bg-white px-3 py-2 text-sm text-black" /></div>
      </div>
      <div><label htmlFor="pe-note" className="text-xs text-white/60">备注</label><textarea id="pe-note" aria-label="项目备注" value={note} onChange={e => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg bg-white px-3 py-2 text-sm text-black" /></div>
      <div className="flex gap-2"><button type="submit" aria-label="保存项目信息" className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white">保存</button><button type="button" aria-label="取消编辑项目信息" onClick={() => setOpen(false)} className="rounded-full bg-white/15 px-4 py-2 text-sm text-white">取消</button></div>
    </form>
  );
}

type MsFormVal = { code: string; title: string; status: string; note: string; sort_order: number };
function MilestoneForm({ initial, submitLabel, onSubmit, onCancel }: { initial?: Milestone; submitLabel: string; onSubmit: (v: MsFormVal) => void; onCancel?: () => void }) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [status, setStatus] = useState<string>(initial?.status ?? "not_started");
  const [note, setNote] = useState(initial?.note ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 99));
  const idp = initial ? `msf-${initial.id}` : "msf-new";
  return (
    <form aria-label={submitLabel} className="mt-3 space-y-2.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit({ code: code.trim(), title: title.trim(), status, note: note.trim(), sort_order: parseInt(sortOrder, 10) || 99 }); }}>
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <div><label htmlFor={`${idp}-code`} className="text-xs font-semibold text-[var(--dim)]">编号</label><input id={`${idp}-code`} aria-label="里程碑编号" value={code} onChange={e => setCode(e.target.value)} placeholder="如 R13" className="mono mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm" required /></div>
        <div><label htmlFor={`${idp}-title`} className="text-xs font-semibold text-[var(--dim)]">标题</label><input id={`${idp}-title`} aria-label="里程碑标题" value={title} onChange={e => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm" required /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label htmlFor={`${idp}-status`} className="text-xs font-semibold text-[var(--dim)]">状态</label><select id={`${idp}-status`} aria-label="里程碑状态" value={status} onChange={e => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm">{Object.entries(MS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label htmlFor={`${idp}-sort`} className="text-xs font-semibold text-[var(--dim)]">排序</label><input id={`${idp}-sort`} aria-label="里程碑排序" type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm" /></div>
      </div>
      <div><label htmlFor={`${idp}-note`} className="text-xs font-semibold text-[var(--dim)]">备注</label><textarea id={`${idp}-note`} aria-label="里程碑备注" value={note} onChange={e => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm" /></div>
      <div className="flex gap-2"><button type="submit" aria-label={submitLabel} className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white">{submitLabel}</button>{onCancel && <button type="button" aria-label="取消" onClick={onCancel} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm">取消</button>}</div>
    </form>
  );
}

type TaskFormVal = { title: string; milestone_code: string; status: string; priority: string; note: string; due_date: string | null };
function TaskForm({ initial, milestones, submitLabel, onSubmit, onCancel }: { initial?: Task; milestones: Milestone[]; submitLabel: string; onSubmit: (v: TaskFormVal) => void; onCancel?: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [msCode, setMsCode] = useState(initial?.milestone_code ?? "");
  const [status, setStatus] = useState<string>(initial?.status ?? "todo");
  const [priority, setPriority] = useState(initial?.priority ?? "normal");
  const [note, setNote] = useState(initial?.note ?? "");
  const [due, setDue] = useState(initial?.due_date ?? "");
  const idp = initial ? `tf-${initial.id}` : "tf-new";
  return (
    <form aria-label={submitLabel} className="mt-3 space-y-2.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit({ title: title.trim(), milestone_code: msCode, status, priority, note: note.trim(), due_date: due ? due : null }); }}>
      <div><label htmlFor={`${idp}-title`} className="text-xs font-semibold text-[var(--dim)]">任务标题</label><input id={`${idp}-title`} aria-label="任务标题" value={title} onChange={e => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm" required /></div>
      <div className="grid grid-cols-3 gap-2">
        <div><label htmlFor={`${idp}-ms`} className="text-xs font-semibold text-[var(--dim)]">里程碑</label><select id={`${idp}-ms`} aria-label="任务所属里程碑" value={msCode} onChange={e => setMsCode(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm"><option value="">无</option>{milestones.map(m => <option key={m.id} value={m.code}>{m.code}</option>)}</select></div>
        <div><label htmlFor={`${idp}-status`} className="text-xs font-semibold text-[var(--dim)]">状态</label><select id={`${idp}-status`} aria-label="任务状态" value={status} onChange={e => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm">{Object.entries(TASK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label htmlFor={`${idp}-pri`} className="text-xs font-semibold text-[var(--dim)]">优先级</label><select id={`${idp}-pri`} aria-label="任务优先级" value={priority} onChange={e => setPriority(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm"><option value="normal">普通</option><option value="P1">P1</option><option value="P2">P2</option><option value="high">高</option><option value="low">低</option></select></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label htmlFor={`${idp}-due`} className="text-xs font-semibold text-[var(--dim)]">截止日期（可选）</label><input id={`${idp}-due`} aria-label="任务截止日期" type="date" value={due} onChange={e => setDue(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm" /></div>
        <div><label htmlFor={`${idp}-note`} className="text-xs font-semibold text-[var(--dim)]">备注</label><input id={`${idp}-note`} aria-label="任务备注" value={note} onChange={e => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm" /></div>
      </div>
      <div className="flex gap-2"><button type="submit" aria-label={submitLabel} className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white">{submitLabel}</button>{onCancel && <button type="button" aria-label="取消" onClick={onCancel} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm">取消</button>}</div>
    </form>
  );
}
