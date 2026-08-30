import { unzipSync } from "fflate";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const REPORTING_BASE = "https://reporting.api.bingads.microsoft.com/Reporting/v13";
const SCOPE = "https://ads.microsoft.com/msads.manage offline_access";

export function bingApiConfigured() {
  return !!(
    process.env.BING_REFRESH_TOKEN &&
    process.env.BING_DEVELOPER_TOKEN &&
    process.env.BING_ACCOUNT_ID &&
    process.env.BING_CUSTOMER_ID &&
    process.env.BING_CLIENT_ID &&
    process.env.BING_CLIENT_SECRET
  );
}

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: process.env.BING_CLIENT_ID!,
    client_secret: process.env.BING_CLIENT_SECRET!,
    refresh_token: process.env.BING_REFRESH_TOKEN!,
    grant_type: "refresh_token",
    scope: SCOPE,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const j: any = await res.json().catch(() => ({}));
  if (!j.access_token) {
    throw new Error("token: " + (j.error_description || j.error || "geen access_token"));
  }
  return j.access_token as string;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    DeveloperToken: process.env.BING_DEVELOPER_TOKEN!,
    CustomerId: process.env.BING_CUSTOMER_ID!,
    CustomerAccountId: process.env.BING_ACCOUNT_ID!,
    "Content-Type": "application/json",
  };
}

function ymdParts(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return { Day: d, Month: m, Year: y };
}

async function submitReport(token: string, from: string, to: string): Promise<string> {
  const reqBody = {
    ReportRequest: {
      Type: "AccountPerformanceReportRequest",
      ExcludeColumnHeaders: false,
      ExcludeReportFooter: true,
      ExcludeReportHeader: true,
      Format: "Csv",
      ReportName: "DrivemaxDailySpend",
      ReturnOnlyCompleteData: false,
      Aggregation: "Daily",
      Columns: ["TimePeriod", "Spend", "Revenue"],
      Scope: { AccountIds: [Number(process.env.BING_ACCOUNT_ID)] },
      Time: {
        CustomDateRangeStart: ymdParts(from),
        CustomDateRangeEnd: ymdParts(to),
        ReportTimeZone: "AmsterdamBerlinBernRomeStockholmVienna",
      },
    },
  };
  const res = await fetch(`${REPORTING_BASE}/GenerateReport/Submit`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(reqBody),
    cache: "no-store",
  });
  const txt = await res.text();
  let j: any = {};
  try { j = JSON.parse(txt); } catch {}
  if (!res.ok || !j.ReportRequestId) {
    throw new Error(`submit (${res.status}): ${txt.slice(0, 400)}`);
  }
  return j.ReportRequestId as string;
}

async function pollReport(token: string, reportRequestId: string): Promise<string> {
  // poll tot Success (of Error); max ~2,5 min
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${REPORTING_BASE}/GenerateReport/Poll`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ReportRequestId: reportRequestId }),
      cache: "no-store",
    });
    const txt = await res.text();
    let j: any = {};
    try { j = JSON.parse(txt); } catch {}
    if (!res.ok) throw new Error(`poll (${res.status}): ${txt.slice(0, 400)}`);
    const st = j?.ReportRequestStatus?.Status;
    if (st === "Success") {
      return j.ReportRequestStatus.ReportDownloadUrl || "";
    }
    if (st === "Error") throw new Error("rapport gaf status Error");
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("rapport niet klaar binnen time-out");
}

function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseNum(raw0: string): number {
  const raw = (raw0 || "0").replace(/[^0-9.,-]/g, "");
  if (!raw) return 0;
  const lastComma = raw.lastIndexOf(","), lastDot = raw.lastIndexOf(".");
  const norm = lastComma > lastDot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  return parseFloat(norm) || 0;
}

function parseReportCsv(csv: string): { spend: Record<string, number>; revenue: Record<string, number> } {
  const spend: Record<string, number> = {};
  const revenue: Record<string, number> = {};
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length);
  let timeIdx = -1, spendIdx = -1, revIdx = -1;
  for (const line of lines) {
    const cols = splitCsv(line);
    if (timeIdx === -1) {
      const ti = cols.findIndex((c) => /^gregorian|^timeperiod$/i.test(c) || /timeperiod/i.test(c));
      const si = cols.findIndex((c) => /^spend$/i.test(c));
      if (ti !== -1 && si !== -1) { timeIdx = ti; spendIdx = si; revIdx = cols.findIndex((c) => /^revenue$/i.test(c)); }
      continue;
    }
    const dRaw = cols[timeIdx] || "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dRaw) ? dRaw : null;
    if (!date) continue;
    spend[date] = (spend[date] || 0) + parseNum(cols[spendIdx] || "0");
    if (revIdx !== -1) revenue[date] = (revenue[date] || 0) + parseNum(cols[revIdx] || "0");
  }
  return { spend, revenue };
}

// Volledige flow: token -> submit -> poll -> download ZIP -> unzip -> parse CSV
export async function fetchBingStatsByDay(from: string, to: string): Promise<{ spend: Record<string, number>; revenue: Record<string, number> }> {
  const token = await getAccessToken();
  const reqId = await submitReport(token, from, to);
  const url = await pollReport(token, reqId);
  if (!url) return { spend: {}, revenue: {} }; // geen data in periode
  const dl = await fetch(url, { cache: "no-store" });
  if (!dl.ok) throw new Error(`download (${dl.status})`);
  const buf = new Uint8Array(await dl.arrayBuffer());
  const files = unzipSync(buf);
  const name = Object.keys(files).find((n) => /\.csv$/i.test(n)) || Object.keys(files)[0];
  if (!name) throw new Error("geen bestand in ZIP");
  const csv = new TextDecoder("utf-8").decode(files[name]);
  return parseReportCsv(csv);
}

// Backwards-compat: alleen de spend-map.
export async function fetchBingSpendByDay(from: string, to: string): Promise<Record<string, number>> {
  return (await fetchBingStatsByDay(from, to)).spend;
}
