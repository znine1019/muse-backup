// Actions for the IP 纯净度检测 artifact.
//
// checkIp merges two keyless upstream sources server-side:
//   - ip-api.com      → geo, ISP/ASN, proxy/hosting/mobile flags
//   - proxycheck.io   → proxy/VPN/Tor verdict, connection type, risk 0–100
// and derives a transparent 纯净度 score (100 = cleanest) from those real
// signals. Results are cached per-IP for 6 hours in `ip_checks`, which
// doubles as the user's lookup history.

import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { desc, eq } from "drizzle-orm";
import * as schema from "./schema";

const CACHE_MS = 6 * 60 * 60 * 1000;

const factorSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(["pass", "warn", "fail", "unknown"]),
  detail: z.string(),
});
type Factor = z.infer<typeof factorSchema>;

const reportSchema = z.object({
  ip: z.string(),
  score: z.number(),
  grade: z.string(),
  ipType: z.string(),
  country: z.string(),
  countryCode: z.string(),
  region: z.string(),
  city: z.string(),
  isp: z.string(),
  org: z.string(),
  asn: z.string(),
  timezone: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  reverse: z.string(),
  range: z.string(),
  provider: z.string(),
  proxyRisk: z.number().nullable(),
  limited: z.boolean(),
  cached: z.boolean(),
  factors: z.array(factorSchema),
  checkedAt: z.string(),
});
type Report = z.infer<typeof reportSchema>;

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

interface IpApiData {
  status?: string;
  message?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
  reverse?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
}

interface ProxycheckData {
  asn?: string;
  range?: string;
  provider?: string;
  organisation?: string;
  country?: string;
  region?: string;
  city?: string;
  timezone?: string;
  proxy?: string;
  type?: string;
  risk?: number;
}

async function fetchJson(url: string, ms = 9000): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; IPPureCheck/1.0)" },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return (await res.json()) as unknown;
}

async function fetchIpApi(ip: string): Promise<IpApiData | null> {
  try {
    const fields =
      "status,message,country,countryCode,regionName,city,lat,lon,timezone,isp,org,as,reverse,mobile,proxy,hosting,query";
    const data = (await fetchJson(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`,
    )) as IpApiData;
    if (data.status === "fail") {
      const msg =
        data.message === "reserved range"
          ? "该 IP 是保留/内网地址，无法检测"
          : data.message === "invalid query"
            ? "IP 格式无效"
            : `无法检测该 IP：${data.message ?? "未知原因"}`;
      throw new Error(msg);
    }
    return data;
  } catch (e) {
    if (e instanceof Error && /保留|格式|无法检测/.test(e.message)) throw e;
    return null;
  }
}

async function fetchProxycheck(ip: string): Promise<ProxycheckData | null> {
  try {
    const data = (await fetchJson(
      `https://proxycheck.io/v2/${encodeURIComponent(ip)}?vpn=1&asn=1&risk=1`,
    )) as Record<string, unknown>;
    if (data["status"] !== "ok") return null;
    for (const value of Object.values(data)) {
      if (value && typeof value === "object" && "proxy" in value) {
        return value as ProxycheckData;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function gradeFor(score: number): string {
  if (score >= 90) return "极度纯净";
  if (score >= 75) return "纯净";
  if (score >= 60) return "良好";
  if (score >= 40) return "一般";
  if (score >= 20) return "有风险";
  return "高风险";
}

function buildReport(
  ip: string,
  ipa: IpApiData | null,
  pc: ProxycheckData | null,
): Report {
  const factors: Factor[] = [];
  let score = 100;

  const pcType = (pc?.type ?? "").trim();
  const proxyDetected = pc?.proxy === "yes" || ipa?.proxy === true;
  const hosting = ipa?.hosting === true || pcType === "Hosting";

  // 1) 综合风险系数 (proxycheck risk 0–100)
  if (pc && typeof pc.risk === "number") {
    const deduction = Math.round(pc.risk * 0.5);
    score -= deduction;
    factors.push({
      key: "risk",
      label: "综合风险系数",
      status: pc.risk <= 10 ? "pass" : pc.risk <= 40 ? "warn" : "fail",
      detail:
        pc.risk <= 10
          ? `风险值 ${pc.risk}/100，历史滥用记录很少`
          : `风险值 ${pc.risk}/100，纯净度扣 ${deduction} 分`,
    });
  } else {
    factors.push({
      key: "risk",
      label: "综合风险系数",
      status: "unknown",
      detail: "风险数据源本次未返回，评分仅基于其余信号",
    });
  }

  // 2) 代理检测
  if (proxyDetected) {
    score -= 25;
    factors.push({
      key: "proxy",
      label: "代理检测",
      status: "fail",
      detail: "检测到代理特征，容易被目标站点风控拦截",
    });
  } else if (pc || ipa) {
    factors.push({
      key: "proxy",
      label: "代理检测",
      status: "pass",
      detail: "未检测到代理特征",
    });
  } else {
    factors.push({
      key: "proxy",
      label: "代理检测",
      status: "unknown",
      detail: "数据源未返回",
    });
  }

  // 3) VPN / Tor
  if (pcType === "TOR") {
    score -= 35;
    factors.push({
      key: "vpn",
      label: "VPN / Tor 检测",
      status: "fail",
      detail: "Tor 出口节点，绝大多数站点会直接拦截",
    });
  } else if (pcType === "VPN") {
    score -= 20;
    factors.push({
      key: "vpn",
      label: "VPN / Tor 检测",
      status: "fail",
      detail: "VPN 节点，注册/登录场景容易触发风控",
    });
  } else if (pc) {
    factors.push({
      key: "vpn",
      label: "VPN / Tor 检测",
      status: "pass",
      detail: "未识别为 VPN 或 Tor 出口",
    });
  } else {
    factors.push({
      key: "vpn",
      label: "VPN / Tor 检测",
      status: "unknown",
      detail: "数据源未返回",
    });
  }

  // 4) 机房 / 托管
  if (hosting) {
    score -= 15;
    factors.push({
      key: "hosting",
      label: "网络类型",
      status: "warn",
      detail: "数据中心/托管机房 IP，非家庭宽带出口",
    });
  } else if (ipa || pc) {
    factors.push({
      key: "hosting",
      label: "网络类型",
      status: "pass",
      detail:
        pcType === "Residential" || ipa?.mobile
          ? "真实接入网络出口（住宅/移动）"
          : "未标记为机房托管 IP",
    });
  } else {
    factors.push({
      key: "hosting",
      label: "网络类型",
      status: "unknown",
      detail: "数据源未返回",
    });
  }

  // 5) 住宅加成
  if (pcType === "Residential" && !proxyDetected) {
    score += 5;
    factors.push({
      key: "residential",
      label: "住宅属性",
      status: "pass",
      detail: "住宅宽带 IP，纯净度加 5 分",
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const ipType =
    pcType === "TOR"
      ? "Tor 出口节点"
      : pcType === "VPN"
        ? "VPN 节点"
        : ipa?.mobile
          ? "移动网络"
          : hosting
            ? "数据中心 / 机房"
            : pcType === "Residential"
              ? "住宅宽带"
              : pcType === "Business"
                ? "商用宽带"
                : pcType === "Wireless"
                  ? "无线网络"
                  : ipa
                    ? "普通宽带"
                    : "未知";

  return {
    ip,
    score,
    grade: gradeFor(score),
    ipType,
    country: ipa?.country ?? pc?.country ?? "",
    countryCode: ipa?.countryCode ?? "",
    region: ipa?.regionName ?? pc?.region ?? "",
    city: ipa?.city ?? pc?.city ?? "",
    isp: ipa?.isp ?? pc?.provider ?? "",
    org: ipa?.org ?? pc?.organisation ?? "",
    asn: ipa?.as ?? (pc?.asn ? `${pc.asn} ${pc.provider ?? ""}`.trim() : ""),
    timezone: ipa?.timezone ?? pc?.timezone ?? "",
    lat: typeof ipa?.lat === "number" ? ipa.lat : null,
    lon: typeof ipa?.lon === "number" ? ipa.lon : null,
    reverse: ipa?.reverse ?? "",
    range: pc?.range ?? "",
    provider: pc?.provider ?? "",
    proxyRisk: pc && typeof pc.risk === "number" ? pc.risk : null,
    limited: pc === null,
    cached: false,
    factors,
    checkedAt: new Date().toISOString(),
  };
}

const historyItem = z.object({
  id: z.number(),
  ip: z.string(),
  score: z.number(),
  grade: z.string(),
  ipType: z.string(),
  country: z.string(),
  city: z.string(),
  isp: z.string(),
  checkedAt: z.string(),
});

export const Actions = {
  checkIp: defineAction({
    description:
      "Checks one public IP address for purity: merges ip-api and proxycheck data into a 0–100 cleanliness score with risk factors, and caches the report as history.",
    request: z.object({
      ip: z
        .string()
        .trim()
        .min(1)
        .max(45)
        .refine((v) => IPV4.test(v) || (v.includes(":") && IPV6.test(v)), {
          message: "IP 格式无效",
        }),
      force: z.boolean().default(false),
    }),
    response: reportSchema,
    async handler(ctx, args): Promise<Report> {
      const db = ctx.db<typeof schema>();
      const ip = args.ip;

      if (!args.force) {
        const rows = await db
          .select()
          .from(schema.ipChecks)
          .where(eq(schema.ipChecks.ip, ip))
          .limit(1);
        const row = rows[0];
        if (row && Date.now() - row.checkedAt.getTime() < CACHE_MS) {
          const parsed = reportSchema.safeParse(JSON.parse(row.reportJson));
          if (parsed.success) return { ...parsed.data, cached: true };
        }
      }

      const [ipa, pc] = await Promise.all([
        fetchIpApi(ip),
        fetchProxycheck(ip),
      ]);
      if (!ipa && !pc) {
        throw new Error("检测数据源暂时不可用，请稍后重试");
      }
      const report = buildReport(ip, ipa, pc);

      await db
        .insert(schema.ipChecks)
        .values({
          ip: report.ip,
          score: report.score,
          grade: report.grade,
          ipType: report.ipType,
          country: report.country,
          city: report.city,
          isp: report.isp,
          reportJson: JSON.stringify(report),
          checkedAt: new Date(report.checkedAt),
        })
        .onConflictDoUpdate({
          target: schema.ipChecks.ip,
          set: {
            score: report.score,
            grade: report.grade,
            ipType: report.ipType,
            country: report.country,
            city: report.city,
            isp: report.isp,
            reportJson: JSON.stringify(report),
            checkedAt: new Date(report.checkedAt),
          },
        });
      ctx.invalidateQueries();
      return report;
    },
  }),

  listHistory: defineAction({
    description: "Lists the most recent IP checks, newest first.",
    request: z.object({
      limit: z.number().int().positive().max(100).default(30),
    }),
    response: z.object({ items: z.array(historyItem) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.ipChecks)
        .orderBy(desc(schema.ipChecks.checkedAt))
        .limit(args.limit);
      return {
        items: rows.map((row) => ({
          id: row.id,
          ip: row.ip,
          score: row.score,
          grade: row.grade,
          ipType: row.ipType,
          country: row.country,
          city: row.city,
          isp: row.isp,
          checkedAt: row.checkedAt.toISOString(),
        })),
      };
    },
  }),

  deleteCheck: defineAction({
    description: "Deletes one saved IP check from the history by id.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.ipChecks)
        .where(eq(schema.ipChecks.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  clearHistory: defineAction({
    description: "Deletes every saved IP check from the history.",
    request: z.object({}),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.ipChecks);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;
