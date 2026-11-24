# Data Plan

## Context provenance
- `给做一个类似于ippure.com的ip纯净度空间` (verbatim user request; the artifact mirrors IPPure's core: current-IP detection, IP 纯净度 score, risk/proxy/VPN/Tor detection, IP type & geo/ISP/ASN info, WebRTC leak check)
- IPPure homepage (browser.open https://ippure.com, crawled 2026-11-23): feature list is IP 定位信息、IP 风险检测、指纹信息分析、IP 出口地图、VPN 泄露检测、WebRTC 检测、DNS 泄露检测 — the build covers 定位/风险/指纹（基础）/WebRTC; DNS leak needs a controlled authoritative DNS server and is not faked.

## Tested sources
### ip-api.com (free JSON API, no key)
**Used by**: checkIp action (server-side fetch, avoids the free tier's HTTP-only mixed-content limit in the browser)
**Test command**: `curl -s 'http://ip-api.com/json/8.8.8.8?fields=status,country,regionName,city,isp,org,as,proxy,hosting,mobile,query'` and a residential IP 24.48.0.1 with full field set
**Sample output**: 8.8.8.8 → country United States, city Ashburn, isp Google LLC, as AS15169, proxy:true, hosting:true; 24.48.0.1 → Videotron (Montreal CA), proxy:false, hosting:false, reverse DNS present. Rate headers X-Rl: 44 / X-Ttl: 60 (≈45 req/min).
**Processing**: geo + ISP/ASN + proxy/hosting/mobile flags feed the info panel and the purity score.

### proxycheck.io v2 (keyless free tier)
**Used by**: checkIp action (server-side fetch)
**Test command**: `curl -s 'https://proxycheck.io/v2/<ip>?vpn=1&asn=1&risk=1'` for 8.8.8.8, 1.1.1.1, 159.65.1.1 (DigitalOcean), 185.220.101.4 (Tor exit)
**Sample output**: 8.8.8.8 → proxy:no, type:Business, risk:0; 159.65.1.1 → proxy:yes, type:VPN, risk:66; 185.220.101.4 → proxy:yes, type:TOR, risk:100. Also returns ASN, provider, geo, range, devices counts.
**Processing**: risk 0–100 and proxy/type are the strongest purity signals; on keyless rate-limit failure the action falls back to ip-api-only scoring and labels the result 数据源受限.

### ipwho.is (free, CORS `Access-Control-Allow-Origin: *` verified via curl -sI)
**Used by**: client-side own-IP detection on page load (the server action cannot see the visitor's real egress IP behind the artifact gateway)
**Test command**: `curl -s 'https://ipwho.is/8.8.8.8'`
**Sample output**: ip, country/city, connection.asn/isp/org, timezone, lat/lon.
**Processing**: client reads its own public IP from ipwho.is, then passes it to checkIp for the full merged report.

## Imagery
Imagery not needed: this is a data/diagnostic tool like its reference ippure.com; all visuals are the live score gauge, signal lists, and data panels generated from real API responses. No photos or illustrations depict any subject.

## Long-term data behavior
- **Refresh policy**: no scheduled refresh; every check is an explicit live query. Results cached per-IP in the DB for 6 hours to respect ip-api (45/min) and proxycheck keyless quotas; a 重新检测 button bypasses cache.
- **Growth**: one history row per distinct check (re-checks update the row), user can delete single rows or clear all; history is the user's own lookup log, seeded empty.
- **Ordering**: history newest first by checked_at.
- **Time semantics**: checked_at stored as UTC instant, rendered viewer-local (Asia/Shanghai).

## Rejected approaches
- **ipapi.is free tier**: probed `https://api.ipapi.is/?q=8.8.8.8` — free response now omits the risk/datacenter/proxy flags (basic geo only), so it adds nothing over ip-api.
- **IPQualityScore / Scamalytics / AbuseIPDB**: accurate risk data but all require API keys the user has not provided; proxycheck keyless covers the same signals.
- **DNS leak test**: a genuine test needs a controlled authoritative DNS resolver; not simulated. WebRTC leak is done for real in the browser via RTCPeerConnection srflx candidates.
- **Server-side own-IP detection**: action requests arrive via the artifact gateway, so the client detects its own IP through CORS-enabled ipwho.is instead.
