import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64url } from "https://deno.land/std@0.168.0/encoding/base64url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GA4_PROPERTY_ID = "518443289";
const SEARCH_CONSOLE_SITE = "sc-domain:getclearly.app";
const REPORT_RECIPIENT = "todd@toddbracher.com";
const LOGO_URL = "https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/default.png";
const FUNCTION_URL = "https://dwncravjhkbclbuzijra.supabase.co/functions/v1/weekly-analytics-report";
const GA4_DASHBOARD_URL = "https://analytics.google.com/analytics/web/#/a319075165p518443289/reports/reportinghub";

// ── Google Auth ──────────────────────────────────────────────────────────────

async function getAccessToken(scopes: string): Promise<string> {
  const keyJson = Deno.env.get("GA4_SERVICE_ACCOUNT_KEY");
  if (!keyJson) throw new Error("GA4_SERVICE_ACCOUNT_KEY not set");
  const key = JSON.parse(keyJson);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: key.client_email,
    scope: scopes,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const pemContents = key.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c: string) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, enc.encode(unsignedToken));
  const jwt = `${unsignedToken}.${base64url(new Uint8Array(signature))}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
  return (await tokenRes.json()).access_token;
}

// ── GA4 Data API ─────────────────────────────────────────────────────────────

async function runGA4Report(token: string, request: any): Promise<any> {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(request) }
  );
  if (!res.ok) throw new Error(`GA4 API error: ${await res.text()}`);
  return res.json();
}

// ── Search Console API ───────────────────────────────────────────────────────

async function runSearchConsoleQuery(token: string, startDate: string, endDate: string): Promise<any> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SEARCH_CONSOLE_SITE)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate, endDate,
        dimensions: ["query"],
        rowLimit: 15,
        type: "web",
      }),
    }
  );
  if (!res.ok) {
    console.error("Search Console API error:", await res.text());
    return { rows: [] };
  }
  return res.json();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dateRange(daysAgo: number, length: number) {
  const end = new Date(); end.setDate(end.getDate() - daysAgo);
  const start = new Date(end); start.setDate(start.getDate() - length + 1);
  return { startDate: fmt(start), endDate: fmt(end) };
}
function fmt(d: Date) { return d.toISOString().split("T")[0]; }

function extractRows(report: any) {
  return (report.rows || []).map((row: any) => ({
    dims: (row.dimensionValues || []).map((d: any) => d.value),
    vals: (row.metricValues || []).map((m: any) => parseFloat(m.value) || 0),
  }));
}

function pct(cur: number, prev: number): string {
  if (prev === 0) return cur > 0 ? "new" : "—";
  const c = ((cur - prev) / prev) * 100;
  return `${c >= 0 ? "+" : ""}${c.toFixed(0)}%`;
}
function arrow(cur: number, prev: number) { return cur > prev ? "↑" : cur < prev ? "↓" : "→"; }
function color(cur: number, prev: number) { return cur > prev ? "#0D8268" : cur < prev ? "#C53030" : "#5C5856"; }
function posColor(cur: number, prev: number) { return cur < prev ? "#0D8268" : cur > prev ? "#C53030" : "#5C5856"; } // lower position = better

// ── Insights Engine ──────────────────────────────────────────────────────────

function generateInsights(d: any): string[] {
  const insights: string[] = [];
  const { tw, lw, tm, lm, ly, queries, queriesLastWeek } = d;

  // 1. Overall traffic
  const userWoW = ((tw.users - lw.users) / Math.max(lw.users, 1)) * 100;
  if (tw.users === 0 && lw.users === 0) {
    insights.push("Your site had no visitors this week or last week. Focus on publishing new blog content targeting long-tail co-parenting keywords to start building organic traffic.");
  } else if (Math.abs(userWoW) > 15) {
    insights.push(userWoW > 0
      ? `Great news — traffic grew ${userWoW.toFixed(0)}% this week (${tw.users} visitors vs ${lw.users} last week). Look at which pages drove the increase and consider writing follow-up content on the same topics.`
      : `Traffic dipped ${Math.abs(userWoW).toFixed(0)}% this week (${tw.users} vs ${lw.users}). This could be seasonal, or a ranking change. Check your top keywords below for position changes.`
    );
  } else {
    insights.push(`Traffic is steady at ${tw.users} visitors this week (${userWoW >= 0 ? "up" : "down"} ${Math.abs(userWoW).toFixed(0)}% from last week).`);
  }

  // 2. Year over year
  if (ly && ly.users > 0) {
    const yoyChange = ((tm.users - ly.users) / ly.users) * 100;
    insights.push(`Compared to the same period last year, you're ${yoyChange >= 0 ? "up" : "down"} ${Math.abs(yoyChange).toFixed(0)}% in visitors (${tm.users} vs ${ly.users}).${yoyChange > 50 ? " Strong year-over-year growth." : yoyChange < -20 ? " Worth investigating what changed." : ""}`);
  }

  // 3. Conversion (App Store clicks)
  if (tw.appStoreClicks > 0 || lw.appStoreClicks > 0) {
    const rate = ((tw.appStoreClicks / Math.max(tw.users, 1)) * 100).toFixed(1);
    insights.push(`${tw.appStoreClicks} people clicked "Download on the App Store" this week — that's ${rate}% of all visitors converting. ${
      tw.appStoreClicks > lw.appStoreClicks ? "Conversion rate is improving — your CTAs are working." :
      tw.appStoreClicks < lw.appStoreClicks ? "Fewer clicks than last week. Consider making the download button more prominent on your top-traffic pages." : ""
    }`);
  } else {
    insights.push("No App Store download clicks yet. As traffic grows, watch this metric — it's your most important conversion signal.");
  }

  // 4. Engagement quality
  if (tw.engagedSessions > 0) {
    const engRate = ((tw.engagedSessions / Math.max(tw.sessions, 1)) * 100).toFixed(0);
    insights.push(`${engRate}% of visits were meaningful (people who stayed 10+ seconds or viewed multiple pages). ${
      parseInt(engRate) > 60 ? "That's strong engagement — your content is resonating." :
      parseInt(engRate) < 40 ? "Many visitors are bouncing quickly. Consider improving page load speed or making your above-the-fold content more compelling." :
      "Solid engagement rate."
    }`);
  }

  // 5. Organic search insight
  const organicPct = ((tw.organicSessions / Math.max(tw.sessions, 1)) * 100).toFixed(0);
  if (tw.organicSessions > 0) {
    insights.push(`${organicPct}% of your traffic comes from Google search (${tw.organicSessions} sessions). ${
      parseInt(organicPct) > 50 ? "Organic is your strongest channel — keep investing in SEO content." :
      "Growing your organic share should be the priority. Publishing 2-3 blog posts per week on high-intent keywords will compound over time."
    }`);
  }

  // 6. Top keyword movement
  if (queries.length > 0 && queriesLastWeek.length > 0) {
    const lwMap = new Map(queriesLastWeek.map((q: any) => [q.query, q.position]));
    const improved = queries
      .filter((q: any) => lwMap.has(q.query) && q.position < (lwMap.get(q.query) as number) - 2)
      .sort((a: any, b: any) => a.position - b.position);
    const declined = queries
      .filter((q: any) => lwMap.has(q.query) && q.position > (lwMap.get(q.query) as number) + 2)
      .sort((a: any, b: any) => a.position - b.position);

    if (improved.length > 0) {
      const best = improved[0];
      insights.push(`Your ranking for "${best.query}" improved to position ${best.position.toFixed(0)} (was ${(lwMap.get(best.query) as number).toFixed(0)}). ${best.position < 20 ? "It's close to page 1 — a few backlinks or content updates could push it into the top 10." : "Keep building content around this topic."}`);
    }
    if (declined.length > 0) {
      const worst = declined[0];
      insights.push(`Watch out — "${worst.query}" dropped to position ${worst.position.toFixed(0)} (was ${(lwMap.get(worst.query) as number).toFixed(0)}). Consider refreshing the content on the ranking page.`);
    }
  }

  // 7. Top page recommendation
  if (tw.topPages.length > 0) {
    const blogPages = tw.topPages.filter((p: any) => p.path.includes("/blog/"));
    if (blogPages.length > 0) {
      insights.push(`Your top blog post "${blogPages[0].path.split("/").pop()?.replace(/-/g, " ").replace(".html", "")}" brought ${blogPages[0].sessions} sessions. Consider adding an inline App Store CTA midway through this post — visitors who read far enough are warm leads.`);
    }
  }

  return insights.slice(0, 7);
}

// ── Email Template ───────────────────────────────────────────────────────────

function buildEmail(d: any): string {
  const { tw, lw, tm, lm, ly, queries, dates } = d;

  const card = (label: string, cur: number, prev: number, fmt = "num") => {
    const val = fmt === "time" ? `${(cur / 60).toFixed(1)}m` : fmt === "pct" ? `${cur.toFixed(0)}%` : cur.toString();
    return `<td style="padding: 16px 8px; text-align: center;">
      <p style="color: #5C5856; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 4px;">${label}</p>
      <p style="color: #1A1917; font-size: 24px; font-weight: 700; margin: 0;">${val}</p>
      <p style="color: ${color(cur, prev)}; font-size: 12px; margin: 4px 0 0;">${arrow(cur, prev)} ${pct(cur, prev)} vs last wk</p>
    </td>`;
  };

  const insightsBullets = generateInsights(d)
    .map(i => `<li style="color: #1A1917; font-size: 14px; line-height: 1.7; margin-bottom: 14px; padding-left: 4px;">${i}</li>`)
    .join("");

  const topPagesRows = tw.topPages.slice(0, 10).map((p: any, i: number) => `
    <tr style="border-bottom: 1px solid #F0EEEC;">
      <td style="padding: 8px 12px; color: #5C5856; font-size: 12px;">${i + 1}</td>
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.path}</td>
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; text-align: right;">${p.sessions}</td>
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; text-align: right;">${p.engagedRate}%</td>
    </tr>`).join("");

  const sourceRows = tw.sources.slice(0, 5).map((s: any) => `
    <tr style="border-bottom: 1px solid #F0EEEC;">
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px;">${s.source}</td>
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; text-align: right;">${s.sessions}</td>
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; text-align: right;">${s.users}</td>
    </tr>`).join("");

  const queryRows = queries.slice(0, 10).map((q: any) => {
    const prevQ = d.queriesLastWeek.find((p: any) => p.query === q.query);
    const posChange = prevQ ? q.position - prevQ.position : 0;
    const posText = prevQ ? (posChange < -1 ? `↑ ${Math.abs(posChange).toFixed(0)}` : posChange > 1 ? `↓ ${posChange.toFixed(0)}` : "→") : "new";
    const pc = prevQ ? posColor(q.position, prevQ.position) : "#5C5856";
    return `<tr style="border-bottom: 1px solid #F0EEEC;">
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${q.query}</td>
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; text-align: right;">${q.clicks}</td>
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; text-align: right;">${q.impressions}</td>
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; text-align: right;">${q.position.toFixed(0)}</td>
      <td style="padding: 8px 12px; color: ${pc}; font-size: 12px; text-align: right;">${posText}</td>
    </tr>`;
  }).join("");

  const engagedRate = tw.sessions > 0 ? ((tw.engagedSessions / tw.sessions) * 100).toFixed(0) : "0";
  const momUsers = pct(tm.users, lm.users);
  const momSessions = pct(tm.sessions, lm.sessions);
  const yoyText = ly && ly.users > 0
    ? `Year-over-Year: <strong>${tm.users}</strong> users (${pct(tm.users, ly.users)} vs same period last year)`
    : "Year-over-Year: Not enough historical data yet";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"></head>
<body style="margin: 0; padding: 0; background-color: #FAFAF9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
<div style="max-width: 620px; margin: 0 auto; padding: 40px 20px;">

  <!-- Header -->
  <div style="text-align: center; margin-bottom: 32px;">
    <img src="${LOGO_URL}" alt="Clearly." width="40" height="40" style="border-radius: 10px;">
    <h1 style="font-size: 20px; color: #1A1917; margin: 16px 0 4px;">Weekly Analytics Report</h1>
    <p style="color: #5C5856; font-size: 13px; margin: 0;">${dates.tw.startDate} — ${dates.tw.endDate}</p>
  </div>

  <!-- Summary Cards -->
  <div style="background: white; border: 1px solid #E8E6E4; border-radius: 12px; margin-bottom: 20px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      ${card("Visitors", tw.users, lw.users)}
      ${card("Sessions", tw.sessions, lw.sessions)}
      ${card("Downloads", tw.appStoreClicks, lw.appStoreClicks)}
      ${card("Engaged", parseInt(engagedRate), parseInt(((lw.engagedSessions / Math.max(lw.sessions, 1)) * 100).toFixed(0)), "pct")}
    </tr></table>
  </div>

  <!-- Comparisons -->
  <div style="background: #E6F5F1; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px;">
    <p style="color: #0D8268; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 6px; font-weight: 600;">Period Comparisons</p>
    <p style="color: #1A1917; font-size: 13px; margin: 0 0 4px;">Month-over-Month: <strong>${tm.users}</strong> users (${momUsers}) · <strong>${tm.sessions}</strong> sessions (${momSessions})</p>
    <p style="color: #1A1917; font-size: 13px; margin: 0;">${yoyText}</p>
  </div>

  <!-- Insights -->
  <div style="background: white; border: 1px solid #E8E6E4; border-radius: 12px; padding: 24px; margin-bottom: 20px;">
    <h2 style="font-size: 16px; color: #0D8268; margin: 0 0 16px;">What This Means & What To Do</h2>
    <ul style="padding-left: 20px; margin: 0;">${insightsBullets}</ul>
  </div>

  <!-- Search Keywords -->
  ${queries.length > 0 ? `
  <div style="background: white; border: 1px solid #E8E6E4; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
    <h2 style="font-size: 16px; color: #1A1917; margin: 0 0 4px;">Google Search Keywords</h2>
    <p style="color: #5C5856; font-size: 12px; margin: 0 0 16px;">What people search to find your site</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr style="border-bottom: 2px solid #E8E6E4;">
        <th style="padding: 6px 12px; text-align: left; color: #5C5856; font-size: 10px; text-transform: uppercase;">Keyword</th>
        <th style="padding: 6px 12px; text-align: right; color: #5C5856; font-size: 10px; text-transform: uppercase;">Clicks</th>
        <th style="padding: 6px 12px; text-align: right; color: #5C5856; font-size: 10px; text-transform: uppercase;">Seen</th>
        <th style="padding: 6px 12px; text-align: right; color: #5C5856; font-size: 10px; text-transform: uppercase;">Rank</th>
        <th style="padding: 6px 12px; text-align: right; color: #5C5856; font-size: 10px; text-transform: uppercase;">Chg</th>
      </tr>
      ${queryRows}
    </table>
  </div>` : ""}

  <!-- Top Pages -->
  <div style="background: white; border: 1px solid #E8E6E4; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
    <h2 style="font-size: 16px; color: #1A1917; margin: 0 0 16px;">Top Pages</h2>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr style="border-bottom: 2px solid #E8E6E4;">
        <th style="padding: 6px 12px; text-align: left; color: #5C5856; font-size: 10px; text-transform: uppercase;">#</th>
        <th style="padding: 6px 12px; text-align: left; color: #5C5856; font-size: 10px; text-transform: uppercase;">Page</th>
        <th style="padding: 6px 12px; text-align: right; color: #5C5856; font-size: 10px; text-transform: uppercase;">Sessions</th>
        <th style="padding: 6px 12px; text-align: right; color: #5C5856; font-size: 10px; text-transform: uppercase;">Engaged</th>
      </tr>
      ${topPagesRows}
    </table>
  </div>

  <!-- Traffic Sources -->
  <div style="background: white; border: 1px solid #E8E6E4; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
    <h2 style="font-size: 16px; color: #1A1917; margin: 0 0 16px;">Traffic Sources</h2>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr style="border-bottom: 2px solid #E8E6E4;">
        <th style="padding: 6px 12px; text-align: left; color: #5C5856; font-size: 10px; text-transform: uppercase;">Source</th>
        <th style="padding: 6px 12px; text-align: right; color: #5C5856; font-size: 10px; text-transform: uppercase;">Sessions</th>
        <th style="padding: 6px 12px; text-align: right; color: #5C5856; font-size: 10px; text-transform: uppercase;">Users</th>
      </tr>
      ${sourceRows}
    </table>
  </div>

  <!-- Footer -->
  <div style="border-top: 1px solid #E8E6E4; padding-top: 20px; text-align: center;">
    <p style="margin: 0 0 8px;">
      <a href="${GA4_DASHBOARD_URL}" style="color: #0D8268; font-size: 13px; text-decoration: none;">View GA4 Dashboard →</a>
      &nbsp;&nbsp;·&nbsp;&nbsp;
      <a href="https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(SEARCH_CONSOLE_SITE)}" style="color: #0D8268; font-size: 13px; text-decoration: none;">Search Console →</a>
    </p>
    <p style="margin: 0 0 8px;">
      <a href="${FUNCTION_URL}" style="color: #5C5856; font-size: 12px; text-decoration: none;">Send report now</a>
      &nbsp;&nbsp;·&nbsp;&nbsp;
      <a href="https://supabase.com/dashboard/project/dwncravjhkbclbuzijra/integrations/cron" style="color: #5C5856; font-size: 12px; text-decoration: none;">Edit schedule</a>
      &nbsp;&nbsp;·&nbsp;&nbsp;
      <a href="https://supabase.com/dashboard/project/dwncravjhkbclbuzijra/functions/weekly-analytics-report" style="color: #5C5856; font-size: 12px; text-decoration: none;">Edit report</a>
    </p>
    <p style="color: #9A9896; font-size: 11px; margin: 12px 0 0;">© 2026 Clearly · <a href="https://getclearly.app" style="color: #9A9896;">getclearly.app</a></p>
  </div>
</div></body></html>`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    console.log("Starting weekly analytics report v2...");

    // Date ranges
    const twRange = dateRange(1, 7);
    const lwRange = dateRange(8, 7);
    const tmRange = dateRange(1, 30);
    const lmRange = dateRange(31, 30);
    // Year-over-year: same 30-day window but last year
    const lyEnd = new Date(); lyEnd.setDate(lyEnd.getDate() - 1); lyEnd.setFullYear(lyEnd.getFullYear() - 1);
    const lyStart = new Date(lyEnd); lyStart.setDate(lyStart.getDate() - 29);
    const lyRange = { startDate: fmt(lyStart), endDate: fmt(lyEnd) };

    // Get tokens for both APIs
    const [ga4Token, gscToken] = await Promise.all([
      getAccessToken("https://www.googleapis.com/auth/analytics.readonly"),
      getAccessToken("https://www.googleapis.com/auth/webmasters.readonly"),
    ]);
    console.log("Got access tokens");

    // Fetch all data in parallel
    const [
      ovTW, ovLW, ovTM, ovLM, ovLY,
      pagesTW, sourcesTW,
      eventsTW, eventsLW,
      scTW, scLW,
    ] = await Promise.all([
      // GA4 overview — this week
      runGA4Report(ga4Token, {
        dateRanges: [twRange],
        metrics: [
          { name: "activeUsers" }, { name: "newUsers" }, { name: "sessions" },
          { name: "userEngagementDuration" }, { name: "engagedSessions" },
          { name: "screenPageViewsPerSession" },
        ],
      }),
      // GA4 overview — last week
      runGA4Report(ga4Token, {
        dateRanges: [lwRange],
        metrics: [
          { name: "activeUsers" }, { name: "newUsers" }, { name: "sessions" },
          { name: "userEngagementDuration" }, { name: "engagedSessions" },
          { name: "screenPageViewsPerSession" },
        ],
      }),
      // GA4 overview — this month
      runGA4Report(ga4Token, { dateRanges: [tmRange], metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "engagedSessions" }] }),
      // GA4 overview — last month
      runGA4Report(ga4Token, { dateRanges: [lmRange], metrics: [{ name: "activeUsers" }, { name: "sessions" }] }),
      // GA4 overview — last year same period
      runGA4Report(ga4Token, { dateRanges: [lyRange], metrics: [{ name: "activeUsers" }, { name: "sessions" }] }),
      // Top pages with engaged sessions
      runGA4Report(ga4Token, {
        dateRanges: [twRange],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "engagedSessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      // Traffic sources
      runGA4Report(ga4Token, {
        dateRanges: [twRange],
        dimensions: [{ name: "sessionSourceMedium" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 8,
      }),
      // Events this week
      runGA4Report(ga4Token, {
        dateRanges: [twRange],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        limit: 20,
      }),
      // Events last week
      runGA4Report(ga4Token, {
        dateRanges: [lwRange],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        limit: 20,
      }),
      // Search Console — this week
      runSearchConsoleQuery(gscToken, twRange.startDate, twRange.endDate),
      // Search Console — last week
      runSearchConsoleQuery(gscToken, lwRange.startDate, lwRange.endDate),
    ]);
    console.log("All data fetched");

    // Parse GA4 data
    const parseOv = (r: any) => {
      const row = r.rows?.[0];
      if (!row) return { users: 0, newUsers: 0, sessions: 0, engagement: 0, engagedSessions: 0, pagesPerSession: 0 };
      return {
        users: parseInt(row.metricValues?.[0]?.value) || 0,
        newUsers: parseInt(row.metricValues?.[1]?.value) || 0,
        sessions: parseInt(row.metricValues?.[2]?.value) || 0,
        engagement: parseFloat(row.metricValues?.[3]?.value) || 0,
        engagedSessions: parseInt(row.metricValues?.[4]?.value) || 0,
        pagesPerSession: parseFloat(row.metricValues?.[5]?.value) || 0,
      };
    };
    const parseSimple = (r: any) => {
      const row = r.rows?.[0];
      return { users: parseInt(row?.metricValues?.[0]?.value) || 0, sessions: parseInt(row?.metricValues?.[1]?.value) || 0, engagedSessions: parseInt(row?.metricValues?.[2]?.value) || 0 };
    };
    const parseSimple2 = (r: any) => {
      const row = r.rows?.[0];
      return { users: parseInt(row?.metricValues?.[0]?.value) || 0, sessions: parseInt(row?.metricValues?.[1]?.value) || 0 };
    };

    const twData = parseOv(ovTW);
    const lwData = parseOv(ovLW);
    if (twData.users > 0) twData.engagement /= twData.users;
    if (lwData.users > 0) lwData.engagement /= lwData.users;

    const tmData = parseSimple(ovTM);
    const lmData = parseSimple2(ovLM);
    const lyData = parseSimple2(ovLY);

    const topPages = extractRows(pagesTW).map(r => ({
      path: r.dims[0] || "/",
      sessions: r.vals[0],
      users: r.vals[1],
      engagedRate: r.vals[0] > 0 ? ((r.vals[2] / r.vals[0]) * 100).toFixed(0) : "0",
    }));

    const sources = extractRows(sourcesTW).map(r => ({
      source: r.dims[0] || "(unknown)", sessions: r.vals[0], users: r.vals[1],
    }));

    const findEvent = (report: any, name: string) => {
      const row = extractRows(report).find(r => r.dims[0] === name);
      return row ? row.vals[0] : 0;
    };

    const organicSessions = sources.filter(s => s.source.includes("organic")).reduce((sum, s) => sum + s.sessions, 0);
    // Get last week organic too
    const lwSources = extractRows(await runGA4Report(ga4Token, {
      dateRanges: [lwRange],
      dimensions: [{ name: "sessionSourceMedium" }],
      metrics: [{ name: "sessions" }],
      limit: 8,
    }));
    const lwOrganic = lwSources.filter(r => r.dims[0]?.includes("organic")).reduce((sum, r) => sum + r.vals[0], 0);

    // Parse Search Console
    const parseQueries = (sc: any) => (sc.rows || []).map((r: any) => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: (r.ctr * 100).toFixed(1),
      position: r.position,
    }));

    const queries = parseQueries(scTW);
    const queriesLastWeek = parseQueries(scLW);

    const reportData = {
      tw: { ...twData, topPages, sources, organicSessions, appStoreClicks: findEvent(eventsTW, "app_store_click"), formSubmits: findEvent(eventsTW, "form_submit") },
      lw: { ...lwData, organicSessions: lwOrganic, appStoreClicks: findEvent(eventsLW, "app_store_click"), engagedSessions: lwData.engagedSessions },
      tm: tmData, lm: lmData, ly: lyData,
      queries, queriesLastWeek,
      dates: { tw: twRange, lw: lwRange },
    };

    console.log("Building email...");
    const emailHtml = buildEmail(reportData);

    // Send email
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(JSON.stringify({ success: true, message: "Report generated, no RESEND_API_KEY", data: reportData }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Clearly <hello@getclearly.app>",
        to: REPORT_RECIPIENT,
        subject: `Clearly Weekly Report — ${twRange.startDate} to ${twRange.endDate}`,
        headers: { "List-Unsubscribe": "<mailto:hello@getclearly.app?subject=Unsubscribe>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        html: emailHtml,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      console.error("Resend error:", err);
      return new Response(JSON.stringify({ success: false, error: "Email failed", details: err }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log("Weekly analytics report v2 sent!");
    return new Response(JSON.stringify({ success: true, message: "Weekly analytics report sent" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Report error:", error);
    return new Response(JSON.stringify({ error: "Failed to generate report", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
