import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { api, type ApiResponse } from "./api";

const FIELDS = actionFields<typeof Actions>();

type Report = ApiResponse<typeof api, "checkIp">;
type HistoryItem = ApiResponse<typeof api, "listHistory">["items"][number];
type FactorStatus = Report["factors"][number]["status"];

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function looksLikeIp(v: string): boolean {
  return IPV4.test(v) || (v.includes(":") && /^[0-9a-fA-F:]+$/.test(v));
}

function scoreColor(score: number): string {
  if (score >= 75) return "var(--good)";
  if (score >= 40) return "var(--warn)";
  return "var(--bad)";
}

function statusMeta(status: FactorStatus): { glyph: string; color: string } {
  switch (status) {
    case "pass":
      return { glyph: "✓", color: "var(--good)" };
    case "warn":
      return { glyph: "!", color: "var(--warn)" };
    case "fail":
      return { glyph: "✕", color: "var(--bad)" };
    default:
      return { glyph: "?", color: "var(--dim)" };
  }
}

function isPrivateIp(ip: string): boolean {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    ip === "::1" ||
    /^f[cd]/i.test(ip) ||
    /^fe80/i.test(ip)
  );
}

function collectWebRtcIps(timeoutMs = 6000): Promise<string[]> {
  return new Promise((resolve) => {
    const found = new Set<string>();
    let pc: RTCPeerConnection | null = null;
    try {
      pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
    } catch {
      resolve([]);
      return;
    }
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      try {
        pc?.close();
      } catch {
        /* already closed */
      }
      resolve([...found]);
    };
    const timer = setTimeout(done, timeoutMs);
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) {
        clearTimeout(timer);
        done();
        return;
      }
      const cand = ev.candidate.candidate;
      const m = cand.match(
        /([0-9]{1,3}(?:\.[0-9]{1,3}){3}|[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,})/,
      );
      const ip = m?.[1];
      if (ip && !ip.endsWith(".local")) found.add(ip);
    };
    pc.createDataChannel("probe");
    pc.createOffer()
      .then((offer) => pc?.setLocalDescription(offer))
      .catch(() => {
        clearTimeout(timer);
        done();
      });
  });
}

function ScoreGauge({ report }: { report: Report }) {
  const r = 64;
  const c = 2 * Math.PI * r;
  const offset = c - (report.score / 100) * c;
  const color = scoreColor(report.score);
  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0">
        <svg width="152" height="152" viewBox="0 0 152 152" role="img" aria-label={`纯净度 ${report.score} 分，${report.grade}`}>
          <circle cx="76" cy="76" r={r} fill="none" stroke="var(--border)" strokeWidth="10" />
          <circle
            cx="76"
            cy="76"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            transform="rotate(-90 76 76)"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-4xl font-bold" style={{ color }}>
            {report.score}
          </span>
          <span className="text-xs text-[var(--dim)]">纯净度 / 100</span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold" style={{ color }}>
          {report.grade}
        </p>
        <p className="mt-1 font-mono text-base break-all">{report.ip}</p>
        <p className="mt-1 text-sm text-[var(--dim)]">
          {report.ipType}
          {report.country ? ` · ${report.country}` : ""}
          {report.city ? ` ${report.city}` : ""}
        </p>
        {report.limited && (
          <p className="mt-2 inline-block rounded-md border border-[var(--warn)] px-2 py-0.5 text-xs text-[var(--warn)]">
            风险数据源本次受限，评分基于部分信号
          </p>
        )}
        {report.cached && (
          <p className="mt-2 text-xs text-[var(--dim)]">
            缓存结果 ·{" "}
            {new Date(report.checkedAt).toLocaleString("zh-CN", {
              hour12: false,
            })}
          </p>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] py-2 last:border-b-0">
      <span className="shrink-0 text-sm text-[var(--dim)]">{label}</span>
      <span className={`text-right text-sm break-all ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [ownIp, setOwnIp] = useState<string | null>(null);
  const [detectFailed, setDetectFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [queryError, setQueryError] = useState("");
  const [checkError, setCheckError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const [rtcState, setRtcState] = useState<"idle" | "running" | "done">("idle");
  const [rtcIps, setRtcIps] = useState<string[]>([]);

  const [confirmClear, setConfirmClear] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const check = useMutation({
    mutationFn: async (args: { ip: string; force: boolean }) =>
      await api.checkIp(args),
    onSuccess: (data) => {
      setReport(data);
      setCheckError("");
    },
    onError: (e) => {
      setCheckError(e instanceof Error ? e.message : "检测失败，请稍后重试");
    },
  });
  const checkRef = useRef(check.mutate);
  checkRef.current = check.mutate;

  // Detect the visitor's own public IP in the browser (the server only sees
  // the gateway), then run the full purity check on it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("https://ipwho.is/");
        const data = (await res.json()) as { ip?: unknown; success?: unknown };
        if (cancelled) return;
        if (typeof data.ip === "string" && data.success !== false) {
          setOwnIp(data.ip);
          checkRef.current({ ip: data.ip, force: false });
        } else {
          setDetectFailed(true);
        }
      } catch {
        if (!cancelled) setDetectFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const history = useQuery({
    queryKey: ["history"],
    queryFn: () => api.listHistory({ limit: 30 }),
  });

  const deleteCheck = useMutation({
    mutationFn: async (id: number) => await api.deleteCheck({ id }),
    onSuccess: () => {
      setHistoryError("");
      void queryClient.invalidateQueries({ queryKey: ["history"] });
    },
    onError: (e) =>
      setHistoryError(e instanceof Error ? e.message : "删除失败，请重试"),
  });

  const clearHistory = useMutation({
    mutationFn: async () => await api.clearHistory({}),
    onSuccess: () => {
      setHistoryError("");
      setConfirmClear(false);
      void queryClient.invalidateQueries({ queryKey: ["history"] });
    },
    onError: (e) =>
      setHistoryError(e instanceof Error ? e.message : "清空失败，请重试"),
  });

  const fingerprint = useMemo(() => {
    if (typeof navigator === "undefined") return [];
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const nav = navigator as Navigator & { deviceMemory?: number };
    return [
      { label: "浏览器 UA", value: nav.userAgent },
      { label: "语言", value: nav.languages?.join(", ") || nav.language },
      { label: "系统时区", value: tz },
      {
        label: "屏幕",
        value: `${window.screen.width} × ${window.screen.height} · ${window.screen.colorDepth} 位色`,
      },
      { label: "CPU 线程", value: String(nav.hardwareConcurrency ?? "—") },
      {
        label: "设备内存",
        value: nav.deviceMemory ? `约 ${nav.deviceMemory} GB` : "浏览器未提供",
      },
      {
        label: "触控",
        value: nav.maxTouchPoints > 0 ? `支持（${nav.maxTouchPoints} 点）` : "不支持",
      },
    ];
  }, []);

  const submitQuery = () => {
    const v = query.trim();
    if (!v) {
      setQueryError("先输入一个要检测的 IP 地址");
      return;
    }
    if (!looksLikeIp(v)) {
      setQueryError("IP 格式不对，请输入公网 IPv4 或 IPv6 地址");
      return;
    }
    setQueryError("");
    check.mutate({ ip: v, force: false });
  };

  const runWebRtc = async () => {
    setRtcState("running");
    const ips = await collectWebRtcIps();
    setRtcIps(ips);
    setRtcState("done");
  };

  const rtcPublic = rtcIps.filter((ip) => !isPrivateIp(ip));
  const rtcVerdict = (() => {
    if (rtcState !== "done") return null;
    if (rtcIps.length === 0)
      return {
        color: "var(--dim)",
        text: "没有收集到任何候选地址，浏览器可能已屏蔽 WebRTC 泄露（这是好事），或当前网络不支持 STUN。",
      };
    const baseline = report?.ip ?? ownIp;
    if (baseline && rtcPublic.length > 0 && rtcPublic.every((ip) => ip === baseline))
      return {
        color: "var(--good)",
        text: "WebRTC 暴露的公网 IP 与当前出口 IP 一致，没有泄露其他地址。",
      };
    if (rtcPublic.length > 0)
      return {
        color: "var(--warn)",
        text: "WebRTC 暴露了公网地址（见下）。如果你在用 VPN/代理且其中有不属于代理出口的地址，真实 IP 可能已泄露。",
      };
    return {
      color: "var(--good)",
      text: "只收集到内网地址，公网 IP 未通过 WebRTC 暴露。",
    };
  })();

  const openHistoryItem = (item: HistoryItem) => {
    check.mutate({ ip: item.ip, force: false });
    reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main className="mx-auto w-full max-w-3xl px-4 pb-10">
        {/* 当前出口 */}
        <section className="pt-5">
          <p className="text-xs tracking-widest text-[var(--dim)]">当前网络出口</p>
          {ownIp ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-3xl font-bold break-all">{ownIp}</span>
              <span className="text-sm text-[var(--dim)]">你的公网 IP</span>
            </div>
          ) : detectFailed ? (
            <p className="mt-2 text-sm text-[var(--warn)]">
              自动获取本机 IP 失败（网络或浏览器限制），可以在下面手动输入 IP 检测。
            </p>
          ) : (
            <p className="mt-2 font-mono text-sm text-[var(--dim)]">正在获取本机 IP…</p>
          )}
        </section>

        {/* 查询任意 IP */}
        <section className="mt-5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <label htmlFor="ip-query" className="text-sm font-medium">
            检测任意 IP
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="ip-query"
              {...FIELDS.checkIp.ip}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitQuery();
              }}
              placeholder="例如 8.8.8.8 或 2606:4700:4700::1111"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 font-mono text-sm outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={submitQuery}
              disabled={check.isPending}
              className="min-h-11 shrink-0 rounded-lg bg-[var(--accent)] px-5 text-sm font-bold text-[#04222b] disabled:opacity-50"
            >
              {check.isPending ? "检测中…" : "检测"}
            </button>
          </div>
          {queryError && <p className="mt-2 text-sm text-[var(--bad)]">{queryError}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-xs text-[var(--dim)]">试试：</span>
            {["8.8.8.8", "1.1.1.1", "9.9.9.9"].map((sample) => (
              <button
                key={sample}
                type="button"
                aria-label={`检测示例 IP ${sample}`}
                onClick={() => {
                  setQuery(sample);
                  setQueryError("");
                  check.mutate({ ip: sample, force: false });
                }}
                className="rounded-md border border-[var(--border)] px-2 py-1 font-mono text-xs text-[var(--accent)]"
              >
                {sample}
              </button>
            ))}
          </div>
        </section>

        {checkError && (
          <p className="mt-4 rounded-[var(--radius)] border border-[var(--bad)] bg-[var(--surface)] p-3 text-sm text-[var(--bad)]">
            {checkError}
          </p>
        )}

        {/* 报告 */}
        <div ref={reportRef} className="scroll-mt-4">
          {report && (
            <section className="mt-5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
              <ScoreGauge report={report} />
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => check.mutate({ ip: report.ip, force: true })}
                  disabled={check.isPending}
                  className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--accent)] disabled:opacity-50"
                >
                  重新检测（不用缓存）
                </button>
                {report.proxyRisk !== null && (
                  <span className="inline-flex min-h-9 items-center rounded-lg border border-[var(--border)] px-3 font-mono text-sm text-[var(--dim)]">
                    风险系数 {report.proxyRisk}/100
                  </span>
                )}
              </div>

              <h2 className="mt-6 text-base font-bold">风险因子</h2>
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {report.factors.map((f) => {
                  const meta = statusMeta(f.status);
                  return (
                    <li key={f.key} className="flex items-start gap-3 py-2.5">
                      <span
                        aria-hidden
                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-bold"
                        style={{ color: meta.color, borderColor: meta.color }}
                      >
                        {meta.glyph}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{f.label}</p>
                        <p className="text-sm text-[var(--dim)]">{f.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <h2 className="mt-6 text-base font-bold">IP 信息</h2>
              <div className="mt-1">
                <InfoRow label="国家/地区" value={report.country ? `${report.country}${report.countryCode ? ` (${report.countryCode})` : ""}` : ""} mono={false} />
                <InfoRow label="省/州" value={report.region} mono={false} />
                <InfoRow label="城市" value={report.city} mono={false} />
                <InfoRow label="ISP" value={report.isp} mono={false} />
                <InfoRow label="组织" value={report.org} mono={false} />
                <InfoRow label="ASN" value={report.asn} />
                <InfoRow label="IP 类型" value={report.ipType} mono={false} />
                <InfoRow label="所属网段" value={report.range} />
                <InfoRow label="反向 DNS" value={report.reverse} />
                <InfoRow label="时区" value={report.timezone} />
                <InfoRow
                  label="经纬度"
                  value={
                    report.lat !== null && report.lon !== null
                      ? `${report.lat.toFixed(4)}, ${report.lon.toFixed(4)}`
                      : ""
                  }
                />
                <InfoRow
                  label="检测时间"
                  value={new Date(report.checkedAt).toLocaleString("zh-CN", { hour12: false })}
                />
              </div>
              <p className="mt-3 text-xs text-[var(--dim)]">
                数据来源：ip-api.com（地理与网络属性）· proxycheck.io（代理/VPN/Tor 与风险系数）。纯净度为本站按上述信号计算的参考分。
              </p>
            </section>
          )}
          {!report && !checkError && (
            <p className="mt-5 rounded-[var(--radius)] border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--dim)]">
              {check.isPending
                ? "正在检测，合并多个数据源…"
                : "检测结果会显示在这里：纯净度评分、风险因子和完整的 IP 信息。"}
            </p>
          )}
        </div>

        {/* WebRTC + 指纹 */}
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="text-base font-bold">WebRTC 泄露检测</h2>
            <p className="mt-1 text-sm text-[var(--dim)]">
              通过 RTCPeerConnection 收集浏览器暴露的候选地址，看真实 IP 会不会绕过代理/VPN 泄露。
            </p>
            <button
              type="button"
              onClick={runWebRtc}
              disabled={rtcState === "running"}
              className="mt-3 min-h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-bold text-[#04222b] disabled:opacity-50"
            >
              {rtcState === "running" ? "检测中…" : "开始检测"}
            </button>
            {rtcVerdict && (
              <p className="mt-3 text-sm" style={{ color: rtcVerdict.color }}>
                {rtcVerdict.text}
              </p>
            )}
            {rtcState === "done" && rtcIps.length > 0 && (
              <ul className="mt-2 space-y-1">
                {rtcIps.map((ip) => (
                  <li key={ip} className="font-mono text-sm break-all">
                    {ip}
                    <span className="ml-2 text-xs text-[var(--dim)]">
                      {isPrivateIp(ip) ? "内网" : "公网"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="text-base font-bold">浏览器指纹（本机）</h2>
            <div className="mt-1">
              {fingerprint.map((f) => (
                <InfoRow key={f.label} label={f.label} value={f.value} mono={f.label !== "浏览器 UA"} />
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--dim)]">
              IP 干净但指纹对不上（时区、语言与 IP 归属地不一致）同样容易触发风控。
            </p>
          </section>
        </div>

        {/* 历史 */}
        <section className="mt-5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold">检测历史</h2>
            {history.data && history.data.items.length > 0 &&
              (confirmClear ? (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => clearHistory.mutate()}
                    disabled={clearHistory.isPending}
                    className="min-h-9 rounded-lg border border-[var(--bad)] px-3 text-sm text-[var(--bad)]"
                  >
                    确认清空
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-sm"
                  >
                    取消
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--dim)]"
                >
                  清空历史
                </button>
              ))}
          </div>
          {historyError && <p className="mt-2 text-sm text-[var(--bad)]">{historyError}</p>}
          {history.isPending && <p className="mt-3 text-sm text-[var(--dim)]">加载中…</p>}
          {history.data && history.data.items.length === 0 && (
            <p className="mt-3 text-sm text-[var(--dim)]">
              还没有检测记录。上面查过的 IP 会自动留在这里，方便对比不同节点的纯净度。
            </p>
          )}
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {history.data?.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-2.5">
                <button
                  type="button"
                  onClick={() => openHistoryItem(item)}
                  aria-label={`查看 ${item.ip} 的检测报告`}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-sm font-bold break-all">{item.ip}</span>
                    <span
                      className="font-mono text-sm font-bold"
                      style={{ color: scoreColor(item.score) }}
                    >
                      {item.score} · {item.grade}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--dim)]">
                    {item.ipType}
                    {item.country ? ` · ${item.country} ${item.city}` : ""} ·{" "}
                    {new Date(item.checkedAt).toLocaleString("zh-CN", { hour12: false })}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`删除 ${item.ip} 的检测记录`}
                  onClick={() => deleteCheck.mutate(item.id)}
                  disabled={deleteCheck.isPending}
                  className="shrink-0 rounded-lg border border-[var(--border)] px-2.5 text-sm text-[var(--dim)]"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
