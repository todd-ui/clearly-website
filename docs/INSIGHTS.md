# Insight Capture Documentation

This document describes the data we collect from website visitors and how to use it for product decisions.

## Data Collection Points

### 1. Access Requests (via Modal)

**Source**: `js/access-modal.js` → Supabase `access_requests` table

**Fields collected:**
| Field | Type | Description |
|-------|------|-------------|
| `email` | string | User's email address (required) |
| `reason` | string | Why they're interested (optional, predefined) |
| `notes` | string | Free-text additional context (optional) |
| `page_url` | string | Page they requested from |
| `referrer` | string | How they arrived (previous URL) |
| `submitted_at` | timestamp | When request was submitted |

**Reason categories:**
- `communication` — Communication breakdown
- `scheduling` — Scheduling conflicts
- `mediation` — Preparing for mediation or legal discussions
- `court-order` — Court order not working
- `exploring` — Exploring options

### 2. Plan Builder Sessions (Non-invasive tracking)

**Source**: `js/plan-builder-tracking.js` → Supabase `plan_builder_sessions` table

**Fields collected:**
| Field | Type | Description |
|-------|------|-------------|
| `session_id` | uuid | Anonymous session identifier |
| `step_reached` | number | Highest step completed |
| `pathway` | string | explore or agreement |
| `completed` | boolean | Whether plan was completed |
| `started_at` | timestamp | Session start |
| `updated_at` | timestamp | Last activity |

**Note**: No PII collected. Sessions are anonymous.

---

## Weekly Review Process

### What to review

1. **Access request volume by source page**
   - Which pages drive most requests?
   - Are blog posts converting?
   - Is professionals page generating referrals?

2. **Reason distribution**
   - What brings people here?
   - Any emerging patterns?

3. **Free-text notes themes**
   - Common pain points mentioned
   - Feature requests
   - Specific situations not covered by reasons

4. **Plan Builder completion rates**
   - Drop-off by step
   - Pathway preferences (explore vs agreement)

### How to categorize responses

**Interest level:**
- `High intent` — Mentions specific situation, urgency, or timeline
- `Professional referral` — Attorney/mediator looking to recommend
- `Exploring` — General interest, no urgency

**Situation type:**
- `High conflict` — Mentions tense communication, legal involvement
- `Newly separated` — Early stage, setting up structure
- `Established` — Existing agreement not working
- `Preventive` — Trying to avoid escalation

---

## Decision Rules for New Pages/Features

### Add a new page when:
- 10+ access requests mention same specific situation not addressed
- Clear SEO opportunity with existing search volume
- Professional referrals cite missing resource

### Add a blog post when:
- 5+ notes mention same question/topic
- Reason category shows strong clustering
- Topic supports existing page content

### Prioritize feature work when:
- Plan Builder drop-off at same step consistently
- Access requests mention specific missing capability
- Professional feedback identifies gap

---

## Data Access

### Supabase Views

Available in Supabase dashboard:

- `access_requests_summary` — Aggregated by reason, page, week
- `plan_builder_funnel` — Step-by-step completion rates
- `weekly_insights` — Combined weekly summary

### Manual Query Examples

```sql
-- Access requests by page this week
SELECT page_url, COUNT(*)
FROM access_requests
WHERE submitted_at > NOW() - INTERVAL '7 days'
GROUP BY page_url ORDER BY COUNT(*) DESC;

-- Most common reasons
SELECT reason, COUNT(*)
FROM access_requests
WHERE reason IS NOT NULL
GROUP BY reason ORDER BY COUNT(*) DESC;

-- Plan Builder completion rate
SELECT
  COUNT(*) FILTER (WHERE completed) as completed,
  COUNT(*) as total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE completed) / COUNT(*), 1) as rate
FROM plan_builder_sessions;
```

---

## Privacy Notes

- No third-party analytics beyond Google Analytics (existing)
- Email addresses used only for beta access communication
- Plan Builder sessions are anonymous (no login required)
- No personal data shared externally
