/**
 * Send Launch Announcement Email to All Waitlist Subscribers
 *
 * Usage:
 *   # Dry run (preview without sending)
 *   SUPABASE_SERVICE_KEY=your_key RESEND_API_KEY=your_key node send-launch-email.js --dry-run
 *
 *   # Actually send emails
 *   SUPABASE_SERVICE_KEY=your_key RESEND_API_KEY=your_key node send-launch-email.js
 *
 * The script:
 *   - Fetches all subscribers who haven't received the launch email
 *   - Shows a preview and waits for confirmation
 *   - Sends emails with rate limiting (10/second to stay under Resend limits)
 *   - Marks each subscriber as having received the launch email
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dwncravjhkbclbuzijra.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!SUPABASE_SERVICE_KEY || !RESEND_API_KEY) {
  console.error('Missing required environment variables:');
  console.error('  SUPABASE_SERVICE_KEY - Your Supabase service role key');
  console.error('  RESEND_API_KEY - Your Resend API key');
  process.exit(1);
}

async function getSubscribers() {
  // Only get subscribers who haven't received the launch email yet
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/waitlist?select=email,id&launch_email_sent=is.null&order=created_at.asc`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch subscribers: ${response.statusText}`);
  }

  return response.json();
}

async function markLaunchEmailSent(email) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/waitlist?email=eq.${encodeURIComponent(email)}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        launch_email_sent: true,
        launch_email_sent_at: new Date().toISOString(),
      }),
    }
  );

  if (!response.ok) {
    console.warn(`Warning: Could not mark launch email sent for ${email}`);
  }
}

async function sendEmail(to, subject, html) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Clearly <noreply@getclearly.app>',
      to,
      subject,
      html,
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to send email: ${JSON.stringify(error)}`);
  }

  return response.json();
}

const LAUNCH_EMAIL_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1A1917; margin: 0; padding: 0; background-color: #FAFAF9;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

    <!-- Header with Logo and Title -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #0D8268 0%, #14a085 100%); border-radius: 16px 16px 0 0;">
      <tr>
        <td style="padding: 40px 32px; text-align: center;">
          <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly" width="64" height="64" style="width: 64px; height: 64px; border-radius: 16px; display: block; margin: 0 auto;">
          <h1 style="font-size: 26px; font-weight: 700; margin: 20px 0 0 0; color: #ffffff; letter-spacing: -0.02em;">Clearly is Live!</h1>
        </td>
      </tr>
    </table>

    <!-- Body -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background: #FFFFFF; border-radius: 0 0 16px 16px; border: 1px solid #E8E7E4; border-top: none;">
      <tr>
        <td style="padding: 32px;">

          <p style="color: #5C5856; margin: 0 0 16px 0; font-size: 16px; line-height: 1.7;">
            The wait is over. <strong style="color: #1A1917;">Clearly is now available to download.</strong>
          </p>

          <p style="color: #5C5856; margin: 0 0 28px 0; font-size: 16px; line-height: 1.7;">
            Thank you for being one of our early supporters. As a waitlist member, you believed in our vision before anyone else — and we built Clearly with you in mind.
          </p>

          <!-- Download Button -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
            <tr>
              <td style="text-align: center;">
                <a href="https://apps.apple.com/app/clearly" style="display: inline-block; background: #0D8268; color: #ffffff; padding: 16px 40px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px;">Download Clearly</a>
              </td>
            </tr>
          </table>

          <!-- Features Card -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
            <tr>
              <td style="padding: 20px 24px; background: #E6F5F1; border-radius: 12px; border: 1px solid #A8DFD0;">
                <p style="color: #0a6b56; font-weight: 600; font-size: 15px; margin: 0 0 12px 0;">What you can do with Clearly:</p>
                <p style="color: #5C5856; font-size: 14px; margin: 0; line-height: 1.8;">
                  • Share custody schedules that stay in sync<br>
                  • Track and split shared expenses<br>
                  • Communicate with less conflict<br>
                  • Request and manage schedule swaps
                </p>
              </td>
            </tr>
          </table>

          <p style="color: #5C5856; margin: 0 0 16px 0; font-size: 16px; line-height: 1.7;">
            We'd love to hear what you think. Reply to this email anytime — we read every message.
          </p>

          <p style="color: #5C5856; margin: 0 0 4px 0; font-size: 16px;">
            Here's to co-parenting made clear,
          </p>
          <p style="color: #1A1917; margin: 8px 0 0 0; font-weight: 600; font-size: 16px;">
            — The Clearly Team
          </p>

        </td>
      </tr>
    </table>

    <!-- Footer -->
    <p style="text-align: center; font-size: 13px; color: #8C8780; margin: 24px 0 0 0;">
      You're receiving this because you signed up for the Clearly waitlist.<br>
      <a href="https://getclearly.app" style="color: #0D8268; text-decoration: none;">getclearly.app</a>
    </p>

  </div>
</body>
</html>
`;

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN MODE - No emails will be sent\n' : '');

  console.log('Fetching subscribers...');
  const subscribers = await getSubscribers();
  console.log(`Found ${subscribers.length} subscribers who haven't received the launch email\n`);

  if (subscribers.length === 0) {
    console.log('No subscribers to email. Everyone has already received the launch email.');
    return;
  }

  // Preview
  console.log('First 10 subscribers:');
  subscribers.slice(0, 10).forEach(s => console.log(`  • ${s.email}`));
  if (subscribers.length > 10) {
    console.log(`  ... and ${subscribers.length - 10} more`);
  }

  console.log(`\n📧 This will send ${subscribers.length} emails.`);

  if (DRY_RUN) {
    console.log('\n✅ Dry run complete. Run without --dry-run to actually send.');
    return;
  }

  console.log('Press Ctrl+C to cancel, or wait 10 seconds to continue...\n');
  await new Promise(resolve => setTimeout(resolve, 10000));

  console.log('Sending emails...\n');

  let sent = 0;
  let failed = 0;
  const startTime = Date.now();

  for (const subscriber of subscribers) {
    try {
      await sendEmail(subscriber.email, "Clearly is Live! 🎉", LAUNCH_EMAIL_HTML);
      await markLaunchEmailSent(subscriber.email);
      sent++;
      console.log(`✓ ${sent}/${subscribers.length} Sent to ${subscriber.email}`);

      // Rate limit: 100ms between emails (10/sec, well under Resend's limits)
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      failed++;
      console.error(`✗ Failed for ${subscriber.email}: ${error.message}`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Done in ${duration}s`);
  console.log(`   Sent: ${sent}`);
  console.log(`   Failed: ${failed}`);
}

main().catch(console.error);
