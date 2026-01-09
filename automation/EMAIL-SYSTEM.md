# Clearly Email Waitlist System

## Overview

This system captures email signups and sends automated welcome emails using:
- **Supabase** - Database + Edge Functions (free tier)
- **Resend** - Email delivery (3,000 emails/month free)

## Setup Instructions

### 1. Create a Resend Account

1. Go to [resend.com](https://resend.com) and sign up
2. Verify your domain (getclearly.app) or use their test domain
3. Get your API key from the dashboard

### 2. Deploy the Database Migration

```bash
# Link to your Supabase project
npx supabase link --project-ref dwncravjhkbclbuzijra

# Push the migration
npx supabase db push
```

### 3. Deploy the Edge Function

```bash
# Deploy the waitlist signup function
npx supabase functions deploy waitlist-signup

# Set the Resend API key as a secret
npx supabase secrets set RESEND_API_KEY=re_your_api_key_here
```

### 4. Verify Email Sending Domain (Required for Production)

In Resend dashboard:
1. Go to Domains → Add Domain
2. Add `getclearly.app`
3. Add the DNS records they provide
4. Wait for verification

Until verified, you can only send to your own email address.

## How It Works

### Email Capture Flow

1. User enters email on website
2. JavaScript POSTs to Supabase Edge Function
3. Function saves email to `waitlist` table
4. Function sends welcome email via Resend
5. User sees success message

### Database Schema

```sql
waitlist (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  source TEXT,          -- 'homepage-hero', 'faq', 'professionals', etc.
  created_at TIMESTAMPTZ,
  welcome_email_sent BOOLEAN,
  welcome_email_sent_at TIMESTAMPTZ
)
```

## Viewing Subscribers

### Option 1: Supabase Dashboard
1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to Table Editor → waitlist

### Option 2: SQL Query
```sql
SELECT email, source, created_at
FROM waitlist
ORDER BY created_at DESC;
```

### Option 3: Export to CSV
```sql
COPY (SELECT * FROM waitlist) TO '/tmp/waitlist.csv' CSV HEADER;
```

## Sending Launch Announcement

When ready to launch, run:

```bash
cd automation
SUPABASE_SERVICE_KEY=your_key RESEND_API_KEY=your_key node send-launch-email.js
```

The script will:
1. Fetch all subscribers
2. Show you how many will receive emails
3. Wait 5 seconds (cancel with Ctrl+C)
4. Send emails with rate limiting

## Costs

| Service | Free Tier | Your Usage |
|---------|-----------|------------|
| Supabase | 50,000 rows, 500MB | Minimal |
| Resend | 3,000 emails/month | Depends on signups |

**Total cost: $0** until you exceed free tiers.

## Troubleshooting

### Emails not sending
- Check Resend dashboard for errors
- Verify domain is set up correctly
- Check Edge Function logs: `npx supabase functions logs waitlist-signup`

### Form not submitting
- Check browser console for errors
- Verify Edge Function is deployed
- Test endpoint directly with curl:
  ```bash
  curl -X POST https://dwncravjhkbclbuzijra.supabase.co/functions/v1/waitlist-signup \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","source":"test"}'
  ```

### Duplicate emails
- The system uses `upsert` with `ignoreDuplicates: true`
- Duplicate submissions are silently ignored
- User still sees success message

## Files

```
/supabase
  /migrations
    20250109000000_create_waitlist.sql  # Database schema
  /functions
    /waitlist-signup
      index.ts                           # Edge function

/automation
  send-launch-email.js                   # Launch announcement script
  EMAIL-SYSTEM.md                        # This file
```
