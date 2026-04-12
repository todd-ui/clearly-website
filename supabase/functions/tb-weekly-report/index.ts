import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64url } from "https://deno.land/std@0.168.0/encoding/base64url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GA4_PROPERTY_ID = "447147286";
const SEARCH_CONSOLE_SITE = "sc-domain:toddbracher.com";
const REPORT_RECIPIENT = "todd@toddbracher.com";
const FUNCTION_URL = "https://dwncravjhkbclbuzijra.supabase.co/functions/v1/tb-weekly-report";
const GA4_DASHBOARD = "https://analytics.google.com/analytics/web/#/a319075165p447147286/reports/reportinghub";

// ── Google Auth ──────────────────────────────────────────────────────────────

async function getAccessToken(scopes: string): Promise<string> {
  const keyJson = Deno.env.get("GA4_SERVICE_ACCOUNT_KEY");
  if (!keyJson) throw new Error("GA4_SERVICE_ACCOUNT_KEY not set");
  const key = JSON.parse(keyJson);

  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(enc.encode(JSON.stringify({
    iss: key.client_email,
    scope: scopes,
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  })));

  const pemContents = key.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c: string) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("pkcs8", binaryDer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, enc.encode(`${header}.${payload}`));
  const jwt = `${header}.${payload}.${base64url(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`Token failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

// ── API Calls ────────────────────────────────────────────────────────────────

async function ga4Report(token: string, req: any): Promise<any> {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`GA4 error: ${await res.text()}`);
  return res.json();
}

async function gscQuery(token: string, start: string, end: string): Promise<any> {
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SEARCH_CONSOLE_SITE)}/searchAnalytics/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: start, endDate: end, dimensions: ["query"], rowLimit: 15, type: "web" }),
  });
  if (!res.ok) { console.error("GSC error:", await res.text()); return { rows: [] }; }
  return res.json();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dr(daysAgo: number, len: number) {
  const e = new Date(); e.setDate(e.getDate() - daysAgo);
  const s = new Date(e); s.setDate(s.getDate() - len + 1);
  return { startDate: f(s), endDate: f(e) };
}
function f(d: Date) { return d.toISOString().split("T")[0]; }
function rows(r: any) { return (r.rows || []).map((row: any) => ({ dims: (row.dimensionValues || []).map((d: any) => d.value), vals: (row.metricValues || []).map((m: any) => parseFloat(m.value) || 0) })); }
function pct(c: number, p: number) { if (p === 0) return c > 0 ? "new" : "—"; const v = ((c - p) / p) * 100; return `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`; }
function arr(c: number, p: number) { return c > p ? "↑" : c < p ? "↓" : "→"; }
function clr(c: number, p: number) { return c > p ? "#1A1917" : c < p ? "#C53030" : "#888"; }
function posClr(c: number, p: number) { return c < p ? "#1A1917" : c > p ? "#C53030" : "#888"; }

// ── Insights ─────────────────────────────────────────────────────────────────

function generateInsights(d: any): string[] {
  const ins: string[] = [];
  const { tw, lw, tm, lm, ly, queries, queriesLW } = d;

  // Traffic
  const wowPct = ((tw.users - lw.users) / Math.max(lw.users, 1)) * 100;
  if (tw.users === 0 && lw.users === 0) {
    ins.push("No visitors this week or last. Consider sharing recent work on LinkedIn or publishing a case study to drive traffic.");
  } else if (Math.abs(wowPct) > 15) {
    ins.push(wowPct > 0
      ? `Site traffic grew ${wowPct.toFixed(0)}% this week — ${tw.users} visitors vs ${lw.users} last week. Something is working. Look at which pages and sources drove the increase.`
      : `Traffic dipped ${Math.abs(wowPct).toFixed(0)}% — ${tw.users} visitors vs ${lw.users} last week. Check if any key pages dropped in rankings.`);
  } else {
    ins.push(`Steady week with ${tw.users} visitors (${wowPct >= 0 ? "up" : "down"} ${Math.abs(wowPct).toFixed(0)}% from last week).`);
  }

  // YoY
  if (ly && ly.users > 0) {
    const yoy = ((tm.users - ly.users) / ly.users) * 100;
    ins.push(`Year-over-year, you're ${yoy >= 0 ? "up" : "down"} ${Math.abs(yoy).toFixed(0)}% (${tm.users} visitors this month vs ${ly.users} same period last year).${yoy > 30 ? " Strong growth." : yoy < -20 ? " Worth investigating." : ""}`);
  }

  // Engagement
  if (tw.engagedSessions > 0) {
    const rate = ((tw.engagedSessions / Math.max(tw.sessions, 1)) * 100).toFixed(0);
    ins.push(`${rate}% of visits were engaged (stayed 10+ seconds or viewed multiple pages). ${parseInt(rate) > 60 ? "People are genuinely exploring your work." : parseInt(rate) < 40 ? "Many visitors leave quickly — the homepage may need a stronger first impression." : "Solid engagement."}`);
  }

  // Top content
  if (tw.topPages.length > 0) {
    const top = tw.topPages[0];
    const isProject = top.path !== "/" && !top.path.includes("field-notes");
    ins.push(`Most visited page: "${top.path}" with ${top.sessions} sessions.${isProject ? " This work is getting attention — consider featuring it in your next Field Notes or LinkedIn post." : ""}`);
  }

  // Organic
  const orgPct = ((tw.organicSessions / Math.max(tw.sessions, 1)) * 100).toFixed(0);
  if (tw.organicSessions > 0) {
    ins.push(`${orgPct}% of traffic comes from Google (${tw.organicSessions} organic sessions). ${parseInt(orgPct) > 40 ? "Your SEO presence is healthy." : "Publishing more written content (case studies, process insights) would grow organic traffic."}`);
  }

  // Keyword movements
  if (queries.length > 0 && queriesLW.length > 0) {
    const lwMap = new Map(queriesLW.map((q: any) => [q.query, q.position]));
    const improved = queries.filter((q: any) => lwMap.has(q.query) && q.position < (lwMap.get(q.query) as number) - 2).sort((a: any, b: any) => a.position - b.position);
    if (improved.length > 0) {
      const best = improved[0];
      ins.push(`Your ranking for "${best.query}" improved to position ${best.position.toFixed(0)} (was ${(lwMap.get(best.query) as number).toFixed(0)}). ${best.position < 15 ? "Close to page 1 — could reach top results with a targeted blog post." : ""}`);
    }
  }

  // Referral insight
  const referrals = tw.sources.filter((s: any) => s.source.includes("referral") || s.source.includes("linkedin") || s.source.includes("instagram"));
  if (referrals.length > 0) {
    const top = referrals[0];
    ins.push(`${top.source} sent you ${top.sessions} sessions this week. ${top.source.includes("linkedin") ? "LinkedIn is working — keep posting." : "Worth nurturing this referral source."}`);
  }

  // Contact form
  if (tw.formStarts > 0) {
    ins.push(`${tw.formStarts} people started filling out your contact form this week. ${tw.formSubmits > 0 ? `${tw.formSubmits} completed it — potential new leads.` : "None completed it — the form might be too long or asking for too much upfront."}`);
  }

  return ins.slice(0, 7);
}

// ── Email Template ───────────────────────────────────────────────────────────

function buildEmail(d: any): string {
  const { tw, lw, tm, lm, ly, queries, queriesLW, dates } = d;

  const card = (label: string, cur: number, prev: number, fmt = "num") => {
    const val = fmt === "time" ? `${(cur / 60).toFixed(1)}m` : fmt === "pct" ? `${cur.toFixed(0)}%` : cur.toString();
    return `<td style="padding: 16px 8px; text-align: center;">
      <p style="color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 6px;">${label}</p>
      <p style="color: #1A1917; font-size: 24px; font-weight: 300; margin: 0; letter-spacing: -0.02em;">${val}</p>
      <p style="color: ${clr(cur, prev)}; font-size: 11px; margin: 6px 0 0;">${arr(cur, prev)} ${pct(cur, prev)}</p>
    </td>`;
  };

  const insights = generateInsights(d).map(i => `<li style="color: #333; font-size: 14px; line-height: 1.8; margin-bottom: 14px;">${i}</li>`).join("");

  // Categorize pages
  const fieldNotesPages = tw.topPages.filter((p: any) => p.path.includes("field-notes") || p.path.includes("fieldnotes") || p.path.includes("/fn/"));
  const servicePages = tw.topPages.filter((p: any) => p.path.includes("service") || p.path.includes("design-in-context"));
  const keyPages = tw.topPages.filter((p: any) => !fieldNotesPages.includes(p) && !servicePages.includes(p));

  const makePageRows = (pages: any[]) => pages.slice(0, 5).map((p: any, i: number) => `
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 6px 12px; color: #888; font-size: 12px;">${i + 1}</td>
      <td style="padding: 6px 12px; color: #1A1917; font-size: 12px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.path}</td>
      <td style="padding: 6px 12px; color: #1A1917; font-size: 12px; text-align: right;">${p.sessions}</td>
      <td style="padding: 6px 12px; color: #1A1917; font-size: 12px; text-align: right;">${p.engRate}%</td>
    </tr>`).join("");

  const pageTableHeader = `<table width="100%" cellpadding="0" cellspacing="0">
    <tr style="border-bottom: 2px solid #e0e0d8;">
      <th style="padding: 6px 12px; text-align: left; color: #888; font-size: 10px; text-transform: uppercase;">#</th>
      <th style="padding: 6px 12px; text-align: left; color: #888; font-size: 10px; text-transform: uppercase;">Page</th>
      <th style="padding: 6px 12px; text-align: right; color: #888; font-size: 10px; text-transform: uppercase;">Sessions</th>
      <th style="padding: 6px 12px; text-align: right; color: #888; font-size: 10px; text-transform: uppercase;">Engaged</th>
    </tr>`;

  // Traffic category summary
  const catRows = (tw.trafficByCategory || []).map((c: any) => `
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; font-weight: 500;">${c.category}</td>
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; text-align: right;">${c.sessions}</td>
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; text-align: right;">${tw.sessions > 0 ? ((c.sessions / tw.sessions) * 100).toFixed(0) : 0}%</td>
    </tr>`).join("");

  // Referring sites detail
  const refRows = (tw.referralSites || []).slice(0, 8).map((r: any) => `
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 6px 12px; color: #1A1917; font-size: 12px;">${r.source}</td>
      <td style="padding: 6px 12px; color: #888; font-size: 11px;">${r.category}</td>
      <td style="padding: 6px 12px; color: #1A1917; font-size: 12px; text-align: right;">${r.sessions}</td>
      <td style="padding: 6px 12px; color: #1A1917; font-size: 12px; text-align: right;">${r.engRate}%</td>
    </tr>`).join("");

  const kwRows = queries.slice(0, 10).map((q: any) => {
    const prev = queriesLW.find((p: any) => p.query === q.query);
    const chg = prev ? q.position - prev.position : 0;
    const chgText = prev ? (chg < -1 ? `↑${Math.abs(chg).toFixed(0)}` : chg > 1 ? `↓${chg.toFixed(0)}` : "—") : "new";
    const pc = prev ? posClr(q.position, prev.position) : "#888";
    return `<tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${q.query}</td>
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; text-align: right;">${q.clicks}</td>
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; text-align: right;">${q.impressions}</td>
      <td style="padding: 8px 12px; color: #1A1917; font-size: 12px; text-align: right;">${q.position.toFixed(0)}</td>
      <td style="padding: 8px 12px; color: ${pc}; font-size: 12px; text-align: right;">${chgText}</td>
    </tr>`;
  }).join("");

  const engRate = tw.sessions > 0 ? ((tw.engagedSessions / tw.sessions) * 100).toFixed(0) : "0";
  const lwEngRate = lw.sessions > 0 ? ((lw.engagedSessions / lw.sessions) * 100).toFixed(0) : "0";
  const momU = pct(tm.users, lm.users);
  const momS = pct(tm.sessions, lm.sessions);
  const yoyText = ly && ly.users > 0 ? `Year-over-Year: <strong>${tm.users}</strong> visitors (${pct(tm.users, ly.users)})` : "Year-over-Year: Building baseline data";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #FAFAF5; font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, sans-serif;">
<div style="max-width: 620px; margin: 0 auto; padding: 48px 24px;">

  <!-- Header -->
  <div style="text-align: center; margin-bottom: 40px; border-bottom: 1px solid #e0e0d8; padding-bottom: 32px;">
    <div style="font-size: 36px; font-weight: 200; color: #1A1917; margin-bottom: 8px;">+</div>
    <h1 style="font-size: 18px; color: #1A1917; margin: 0 0 4px; font-weight: 400; letter-spacing: 0.05em;">WEEKLY STUDIO REPORT</h1>
    <p style="color: #888; font-size: 12px; margin: 0; letter-spacing: 0.05em;">${dates.tw.startDate} — ${dates.tw.endDate}</p>
  </div>

  <!-- Summary -->
  <div style="background: white; border: 1px solid #e0e0d8; margin-bottom: 24px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      ${card("Visitors", tw.users, lw.users)}
      ${card("Sessions", tw.sessions, lw.sessions)}
      ${card("Engaged", parseInt(engRate), parseInt(lwEngRate), "pct")}
      ${card("Avg Time", tw.engagement, lw.engagement, "time")}
    </tr></table>
  </div>

  <!-- Comparisons -->
  <div style="background: #f0f0ea; padding: 16px 20px; margin-bottom: 24px;">
    <p style="color: #1A1917; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 6px; font-weight: 500;">Period Comparisons</p>
    <p style="color: #333; font-size: 13px; margin: 0 0 4px;">Month: <strong>${tm.users}</strong> visitors (${momU}) · <strong>${tm.sessions}</strong> sessions (${momS})</p>
    <p style="color: #333; font-size: 13px; margin: 0;">${yoyText}</p>
  </div>

  <!-- Insights -->
  <div style="background: white; border: 1px solid #e0e0d8; padding: 28px; margin-bottom: 24px;">
    <h2 style="font-size: 14px; color: #1A1917; margin: 0 0 20px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 500;">Insights & Recommendations</h2>
    <ul style="padding-left: 20px; margin: 0;">${insights}</ul>
  </div>

  <!-- Keywords -->
  ${queries.length > 0 ? `
  <div style="background: white; border: 1px solid #e0e0d8; padding: 24px; margin-bottom: 24px;">
    <h2 style="font-size: 14px; color: #1A1917; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 500;">Search Keywords</h2>
    <p style="color: #888; font-size: 12px; margin: 0 0 16px;">How people find you on Google</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr style="border-bottom: 2px solid #e0e0d8;">
        <th style="padding: 6px 12px; text-align: left; color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;">Keyword</th>
        <th style="padding: 6px 12px; text-align: right; color: #888; font-size: 10px; text-transform: uppercase;">Clicks</th>
        <th style="padding: 6px 12px; text-align: right; color: #888; font-size: 10px; text-transform: uppercase;">Seen</th>
        <th style="padding: 6px 12px; text-align: right; color: #888; font-size: 10px; text-transform: uppercase;">Rank</th>
        <th style="padding: 6px 12px; text-align: right; color: #888; font-size: 10px; text-transform: uppercase;">Chg</th>
      </tr>${kwRows}
    </table>
  </div>` : ""}

  <!-- Field Notes & Contact -->
  <div style="background: white; border: 1px solid #e0e0d8; margin-bottom: 24px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="padding: 16px 8px; text-align: center; border-right: 1px solid #e0e0d8;">
        <p style="color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 6px;">Field Notes Views</p>
        <p style="color: #1A1917; font-size: 24px; font-weight: 300; margin: 0;">${fieldNotesPages.reduce((s: number, p: any) => s + p.sessions, 0)}</p>
      </td>
      <td style="padding: 16px 8px; text-align: center; border-right: 1px solid #e0e0d8;">
        <p style="color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 6px;">Form Starts</p>
        <p style="color: #1A1917; font-size: 24px; font-weight: 300; margin: 0;">${tw.formStarts}</p>
      </td>
      <td style="padding: 16px 8px; text-align: center;">
        <p style="color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 6px;">Form Submits</p>
        <p style="color: #1A1917; font-size: 24px; font-weight: 300; margin: 0;">${tw.formSubmits}</p>
      </td>
    </tr></table>
  </div>

  <!-- Field Notes Articles -->
  ${fieldNotesPages.length > 0 ? `
  <div style="background: white; border: 1px solid #e0e0d8; padding: 24px; margin-bottom: 24px;">
    <h2 style="font-size: 14px; color: #1A1917; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 500;">Field Notes — Top Articles</h2>
    ${pageTableHeader}${makePageRows(fieldNotesPages)}</table>
  </div>` : ""}

  <!-- Services -->
  ${servicePages.length > 0 ? `
  <div style="background: white; border: 1px solid #e0e0d8; padding: 24px; margin-bottom: 24px;">
    <h2 style="font-size: 14px; color: #1A1917; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 500;">Services — Most Viewed</h2>
    ${pageTableHeader}${makePageRows(servicePages)}</table>
  </div>` : ""}

  <!-- Key Pages -->
  ${keyPages.length > 0 ? `
  <div style="background: white; border: 1px solid #e0e0d8; padding: 24px; margin-bottom: 24px;">
    <h2 style="font-size: 14px; color: #1A1917; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 500;">Key Pages</h2>
    ${pageTableHeader}${makePageRows(keyPages)}</table>
  </div>` : ""}

  <!-- How People Found You -->
  <div style="background: white; border: 1px solid #e0e0d8; padding: 24px; margin-bottom: 24px;">
    <h2 style="font-size: 14px; color: #1A1917; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 500;">How People Found You</h2>
    <p style="color: #888; font-size: 12px; margin: 0 0 16px;">Traffic breakdown by channel</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr style="border-bottom: 2px solid #e0e0d8;">
        <th style="padding: 6px 12px; text-align: left; color: #888; font-size: 10px; text-transform: uppercase;">Channel</th>
        <th style="padding: 6px 12px; text-align: right; color: #888; font-size: 10px; text-transform: uppercase;">Sessions</th>
        <th style="padding: 6px 12px; text-align: right; color: #888; font-size: 10px; text-transform: uppercase;">Share</th>
      </tr>${catRows}
    </table>
  </div>

  <!-- Referring Sites -->
  ${(tw.referralSites || []).length > 0 ? `
  <div style="background: white; border: 1px solid #e0e0d8; padding: 24px; margin-bottom: 24px;">
    <h2 style="font-size: 14px; color: #1A1917; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 500;">Referring Sites & Social</h2>
    <p style="color: #888; font-size: 12px; margin: 0 0 16px;">Specific sites and platforms sending you visitors</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr style="border-bottom: 2px solid #e0e0d8;">
        <th style="padding: 6px 12px; text-align: left; color: #888; font-size: 10px; text-transform: uppercase;">Site</th>
        <th style="padding: 6px 12px; text-align: left; color: #888; font-size: 10px; text-transform: uppercase;">Type</th>
        <th style="padding: 6px 12px; text-align: right; color: #888; font-size: 10px; text-transform: uppercase;">Sessions</th>
        <th style="padding: 6px 12px; text-align: right; color: #888; font-size: 10px; text-transform: uppercase;">Engaged</th>
      </tr>${refRows}
    </table>
  </div>` : ""}

  <!-- Footer -->
  <div style="border-top: 1px solid #e0e0d8; padding-top: 24px; text-align: center;">
    <p style="margin: 0 0 8px;">
      <a href="${GA4_DASHBOARD}" style="color: #1A1917; font-size: 12px; text-decoration: none;">GA4 Dashboard →</a>
      &nbsp;&nbsp;·&nbsp;&nbsp;
      <a href="https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(SEARCH_CONSOLE_SITE)}" style="color: #1A1917; font-size: 12px; text-decoration: none;">Search Console →</a>
    </p>
    <p style="margin: 0 0 8px;">
      <a href="${FUNCTION_URL}" style="color: #888; font-size: 11px; text-decoration: none;">Send report now</a>
      &nbsp;·&nbsp;
      <a href="https://supabase.com/dashboard/project/dwncravjhkbclbuzijra/integrations/cron" style="color: #888; font-size: 11px; text-decoration: none;">Edit schedule</a>
      &nbsp;·&nbsp;
      <a href="https://supabase.com/dashboard/project/dwncravjhkbclbuzijra/functions/tb-weekly-report" style="color: #888; font-size: 11px; text-decoration: none;">Edit report</a>
    </p>
    <p style="color: #aaa; font-size: 11px; margin: 16px 0 0;">Todd Bracher Studio · <a href="https://toddbracher.com" style="color: #aaa;">toddbracher.com</a></p>
  </div>
</div></body></html>`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    console.log("Starting TB Studio weekly report...");

    const twR = dr(1, 7), lwR = dr(8, 7), tmR = dr(1, 30), lmR = dr(31, 30);
    const lyEnd = new Date(); lyEnd.setDate(lyEnd.getDate() - 1); lyEnd.setFullYear(lyEnd.getFullYear() - 1);
    const lyStart = new Date(lyEnd); lyStart.setDate(lyStart.getDate() - 29);
    const lyR = { startDate: f(lyStart), endDate: f(lyEnd) };

    const [ga4T, gscT] = await Promise.all([
      getAccessToken("https://www.googleapis.com/auth/analytics.readonly"),
      getAccessToken("https://www.googleapis.com/auth/webmasters.readonly"),
    ]);

    const [ovTW, ovLW, ovTM, ovLM, ovLY, pgTW, srcTW, refTW, evTW, evLW, scTW, scLW] = await Promise.all([
      ga4Report(ga4T, { dateRanges: [twR], metrics: [{ name: "activeUsers" }, { name: "newUsers" }, { name: "sessions" }, { name: "userEngagementDuration" }, { name: "engagedSessions" }] }),
      ga4Report(ga4T, { dateRanges: [lwR], metrics: [{ name: "activeUsers" }, { name: "newUsers" }, { name: "sessions" }, { name: "userEngagementDuration" }, { name: "engagedSessions" }] }),
      ga4Report(ga4T, { dateRanges: [tmR], metrics: [{ name: "activeUsers" }, { name: "sessions" }] }),
      ga4Report(ga4T, { dateRanges: [lmR], metrics: [{ name: "activeUsers" }, { name: "sessions" }] }),
      ga4Report(ga4T, { dateRanges: [lyR], metrics: [{ name: "activeUsers" }, { name: "sessions" }] }),
      ga4Report(ga4T, { dateRanges: [twR], dimensions: [{ name: "pagePath" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "engagedSessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 25 }),
      ga4Report(ga4T, { dateRanges: [twR], dimensions: [{ name: "sessionSourceMedium" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 12 }),
      // Referring sites (just the source, not medium)
      ga4Report(ga4T, { dateRanges: [twR], dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "engagedSessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 15 }),
      ga4Report(ga4T, { dateRanges: [twR], dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], limit: 20 }),
      ga4Report(ga4T, { dateRanges: [lwR], dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], limit: 20 }),
      gscQuery(gscT, twR.startDate, twR.endDate),
      gscQuery(gscT, lwR.startDate, lwR.endDate),
    ]);

    // Parse
    const parseOv = (r: any) => {
      const row = r.rows?.[0];
      if (!row) return { users: 0, newUsers: 0, sessions: 0, engagement: 0, engagedSessions: 0 };
      const v = row.metricValues;
      return { users: parseInt(v?.[0]?.value) || 0, newUsers: parseInt(v?.[1]?.value) || 0, sessions: parseInt(v?.[2]?.value) || 0, engagement: parseFloat(v?.[3]?.value) || 0, engagedSessions: parseInt(v?.[4]?.value) || 0 };
    };
    const parseS = (r: any) => { const row = r.rows?.[0]; return { users: parseInt(row?.metricValues?.[0]?.value) || 0, sessions: parseInt(row?.metricValues?.[1]?.value) || 0 }; };

    const tw = parseOv(ovTW), lw = parseOv(ovLW);
    if (tw.users > 0) tw.engagement /= tw.users;
    if (lw.users > 0) lw.engagement /= lw.users;

    const topPages = rows(pgTW).map(r => ({ path: r.dims[0] || "/", sessions: r.vals[0], users: r.vals[1], engRate: r.vals[0] > 0 ? ((r.vals[2] / r.vals[0]) * 100).toFixed(0) : "0" }));
    const sources = rows(srcTW).map(r => ({ source: r.dims[0] || "unknown", sessions: r.vals[0], users: r.vals[1] }));
    const organicSessions = sources.filter(s => s.source.includes("organic")).reduce((sum, s) => sum + s.sessions, 0);

    // Detailed referrers with categories
    const referrers = rows(refTW).map(r => {
      const source = r.dims[0] || "unknown";
      const medium = r.dims[1] || "none";
      let category = "Other";
      if (medium === "organic") category = "Search";
      else if (medium === "(none)" && source === "(direct)") category = "Direct";
      else if (medium === "referral") category = "Referral";
      else if (medium === "social" || ["linkedin", "linkedin.com", "l.linkedin.com", "lnkd.in", "instagram", "instagram.com", "facebook", "facebook.com", "twitter", "t.co", "x.com"].some(s => source.includes(s))) category = "Social";
      else if (medium === "email" || source.includes("newsletter") || source.includes("buttondown")) category = "Email";
      return { source, medium, category, sessions: r.vals[0], users: r.vals[1], engRate: r.vals[0] > 0 ? ((r.vals[2] / r.vals[0]) * 100).toFixed(0) : "0" };
    });

    const trafficByCategory = ["Search", "Direct", "Social", "Referral", "Email", "Other"]
      .map(cat => ({ category: cat, sessions: referrers.filter(r => r.category === cat).reduce((s, r) => s + r.sessions, 0), users: referrers.filter(r => r.category === cat).reduce((s, r) => s + r.users, 0) }))
      .filter(c => c.sessions > 0);

    const referralSites = referrers.filter(r => r.category === "Referral" || r.category === "Social").sort((a, b) => b.sessions - a.sessions);

    const findEv = (report: any, name: string) => { const r = rows(report).find(r => r.dims[0] === name); return r ? r.vals[0] : 0; };
    const formStarts = findEv(evTW, "form_start");
    const formSubmits = findEv(evTW, "form_submit");

    const parseQ = (sc: any) => (sc.rows || []).map((r: any) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position }));

    const data = {
      tw: { ...tw, topPages, sources, organicSessions, formStarts, formSubmits, trafficByCategory, referralSites },
      lw: { ...lw, engagedSessions: lw.engagedSessions },
      tm: parseS(ovTM), lm: parseS(ovLM), ly: parseS(ovLY),
      queries: parseQ(scTW), queriesLW: parseQ(scLW),
      dates: { tw: twR },
    };

    const emailHtml = buildEmail(data);
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(JSON.stringify({ success: true, message: "No RESEND_API_KEY", data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // TODO: Switch to studio@toddbracher.com once domain is verified in Resend
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Todd Bracher Studio <hello@getclearly.app>",
        to: REPORT_RECIPIENT,
        subject: `Studio Weekly Report — ${twR.startDate} to ${twR.endDate}`,
        headers: { "List-Unsubscribe": "<mailto:hello@getclearly.app?subject=Unsubscribe>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        html: emailHtml,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      console.error("Resend error:", err);
      return new Response(JSON.stringify({ success: false, error: err }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log("TB Studio weekly report sent!");
    return new Response(JSON.stringify({ success: true, message: "Studio report sent" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
