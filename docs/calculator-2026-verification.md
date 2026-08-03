# Child-Support Calculator — 2026 Guideline Verification Worksheet

**Purpose:** get the state calculators onto verified, current figures **safely**. Every value below must be confirmed against the **official state source** before it goes live. Do **not** accept any number in this file as authoritative — the "current value in code" column is only what the site ships *today*, and the staleness check (`node automation/calculator-staleness.js`) currently flags **all six states as due for review**.

**Who fills this in:** a human who has opened the official source and confirmed the figure. Once confirmed, either edit the files yourself or paste the verified numbers back and they'll be applied precisely.

**What NOT to do:** do not guess, interpolate, or copy figures from unofficial calculators. Wrong figures produce wrong child-support estimates that real families may rely on.

---

## How to apply a verified update (per state)

1. Edit the value(s) in `calculators/calculator-config.js` → `states["<state>"]`.
2. Update that state's `guidelinesEffective`, `lastUpdated`, and `nextReviewDate`.
3. Update the matching **visible** copy on `calculators/support/<state>.html` (the "Guidelines / Effective" rows, any "as of <date>" sentences, and JS schedule values if the state embeds a schedule).
4. Update `dateModified` in that page's JSON-LD to the edit date.
5. Test the result against the **official state calculator**.
6. Re-run `node automation/calculator-staleness.js` — the state should drop off the overdue list.

---

## Per-state worksheet

Legend: ☐ = to verify. Fill the "Verified 2026 value" column only from the official source.

### New York — `states["new-york"]`
Source: NY Domestic Relations Law §240 / [CSSA chart](https://www.nycourts.gov/courthelp/family/childSupport.shtml) · updates every 2 years (Jan/Feb) — **new 2-year period begins March 2026**.

| Field (config key) | Current value in code | Verified 2026 value | ☐ |
|---|---|---|---|
| `incomeCap` | 183000 | | ☐ |
| `selfSupportReserve` | 21128 | | ☐ |
| `povertyGuideline` (federal, single) | 15650 | | ☐ |
| CSSA percentages | 17/25/29/31/35% | | ☐ |
| `guidelinesEffective` | "March 2024 - February 2026" | | ☐ |

### California — `states["california"]`
Source: [CA Family Code §4055](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=4055.&lawCode=FAM) · algebraic formula, rarely changes.

| Field | Current value in code | Verified 2026 value | ☐ |
|---|---|---|---|
| K-factor multipliers | (formula) | | ☐ |
| Any statutory formula change since SB 343 (2024)? | — | | ☐ |
| `guidelinesEffective` | "2024 (SB 343)" | | ☐ |

### Texas — `states["texas"]`
Source: [TX Family Code §154.125](https://statutes.capitol.texas.gov/Docs/FA/htm/FA.154.htm#154.125) · income cap updates **annually in September**.

| Field (config key) | Current value in code | Verified value | ☐ |
|---|---|---|---|
| `incomeCap` (monthly net resources) | 11700 (eff. Sep 2025) | | ☐ |
| Multiple-family adjustment % | (schedule in config) | | ☐ |
| `guidelinesEffective` | "September 2025" | | ☐ |

### Florida — `states["florida"]`
Source: [FL Statute 61.30](https://www.flsenate.gov/Laws/Statutes/61.30).

| Field | Current value in code | Verified value | ☐ |
|---|---|---|---|
| Support schedule values | (2024) | | ☐ |
| Time-sharing thresholds | — | | ☐ |
| `guidelinesEffective` | "2024" | | ☐ |

### Illinois — `states["illinois"]`
Source: [750 ILCS 5/505](https://www.ilga.gov/legislation/ilcs/ilcs4.asp?ActID=2086) + HFS income-shares schedule. *(Note: the config `sourceUrl` was corrupted and has been corrected to the ILGA statute link.)*

| Field (config key) | Current value in code | Verified value | ☐ |
|---|---|---|---|
| `incomeCap` | 30025 | | ☐ |
| `lowIncomeThreshold` | 1295 | | ☐ |
| Income-shares schedule (embedded in `illinois.html`) | 2025 values | | ☐ |
| `guidelinesEffective` | "2025" | | ☐ |

### Pennsylvania — `states["pennsylvania"]`
Source: [231 Pa. Code Rule 1910.16-3](https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/231/chapter1910/s1910.16-3.html) · schedule amended Aug 2025, **effective January 2026** (likely already current).

| Field (config key) | Current value in code | Verified value | ☐ |
|---|---|---|---|
| `incomeCap` | 30000 | | ☐ |
| Shared-custody formula | (config) | | ☐ |
| `guidelinesEffective` | "January 2026" | | ☐ |

---

## Notes captured during the round-1 review

- The page **titles/metadata were made evergreen** (the pinned "2025" was removed) so they can be indexed now without going stale. Visible on-page effective-date facts (e.g. Texas "cap is $11,700/month as of September 2025") were **left intact** because they are accurate to the currently-loaded figures — update them here as part of each state's verification.
- The 6 pages were switched from `noindex` to `index,follow` at the owner's request; getting the figures verified is the natural follow-through now that they're publicly indexable.
