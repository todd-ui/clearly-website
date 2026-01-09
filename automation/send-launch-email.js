/**
 * Send Launch Announcement Email to All Waitlist Subscribers
 *
 * Usage:
 *   SUPABASE_URL=your_url SUPABASE_SERVICE_KEY=your_key RESEND_API_KEY=your_key node send-launch-email.js
 *
 * Or set these in a .env file and use dotenv
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dwncravjhkbclbuzijra.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!SUPABASE_SERVICE_KEY || !RESEND_API_KEY) {
  console.error('Missing required environment variables:');
  console.error('  SUPABASE_SERVICE_KEY - Your Supabase service role key');
  console.error('  RESEND_API_KEY - Your Resend API key');
  process.exit(1);
}

async function getSubscribers() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/waitlist?select=email,id&order=created_at.asc`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch subscribers: ${response.statusText}`);
  }

  return response.json();
}

async function sendEmail(to, subject, html) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Clearly <hello@getclearly.app>',
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
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly" style="width: 64px; height: 64px; border-radius: 16px;">
  </div>

  <h1 style="font-size: 28px; font-weight: 700; margin-bottom: 16px; text-align: center; color: #0D8268;">Clearly is Live!</h1>

  <p style="color: #4a5568; margin-bottom: 24px; font-size: 18px; text-align: center;">
    The wait is over. Clearly is now available to download.
  </p>

  <div style="text-align: center; margin: 32px 0;">
    <a href="https://apps.apple.com/app/clearly" style="display: inline-block; background: #0D8268; color: white; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px;">Download Clearly</a>
  </div>

  <p style="color: #4a5568; margin-bottom: 24px;">
    Thank you for being one of our early supporters. As a waitlist member, you believed in our vision before anyone else — and we built Clearly with you in mind.
  </p>

  <div style="background: #f7fafc; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
    <h3 style="margin: 0 0 12px 0; color: #1a1a1a;">What you can do with Clearly:</h3>
    <ul style="margin: 0; padding-left: 20px; color: #4a5568;">
      <li>Share custody schedules that stay in sync</li>
      <li>Track and split shared expenses</li>
      <li>Communicate with less conflict</li>
      <li>Request and manage schedule swaps</li>
    </ul>
  </div>

  <p style="color: #4a5568; margin-bottom: 32px;">
    We'd love to hear what you think. Reply to this email anytime — we read every message.
  </p>

  <p style="color: #4a5568; margin-bottom: 0;">
    Here's to co-parenting made clear,<br>
    — The Clearly Team
  </p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 40px 0 24px;">

  <p style="font-size: 12px; color: #a0aec0; text-align: center;">
    You're receiving this because you signed up for the Clearly waitlist.<br>
    <a href="https://getclearly.app" style="color: #a0aec0;">getclearly.app</a>
  </p>
</body>
</html>
`;

async function main() {
  console.log('Fetching subscribers...');
  const subscribers = await getSubscribers();
  console.log(`Found ${subscribers.length} subscribers`);

  if (subscribers.length === 0) {
    console.log('No subscribers to email.');
    return;
  }

  // Confirm before sending
  console.log('\\nFirst 5 subscribers:');
  subscribers.slice(0, 5).forEach(s => console.log(`  - ${s.email}`));
  console.log(`\\nThis will send ${subscribers.length} emails.`);
  console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');

  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('\\nSending emails...');

  let sent = 0;
  let failed = 0;

  for (const subscriber of subscribers) {
    try {
      await sendEmail(subscriber.email, "Clearly is Live! 🎉", LAUNCH_EMAIL_HTML);
      sent++;
      console.log(`✓ Sent to ${subscriber.email}`);

      // Rate limit: wait 100ms between emails
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      failed++;
      console.error(`✗ Failed for ${subscriber.email}: ${error.message}`);
    }
  }

  console.log(`\\nDone! Sent: ${sent}, Failed: ${failed}`);
}

main().catch(console.error);
