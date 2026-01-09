import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Send Launch Announcement Emails
 *
 * Trigger from Supabase Dashboard:
 *   Edge Functions → send-launch-emails → Invoke
 *
 * Or via URL:
 *   POST https://dwncravjhkbclbuzijra.supabase.co/functions/v1/send-launch-emails
 *   Header: Authorization: Bearer YOUR_ANON_KEY
 *   Body: { "confirm": true }
 *
 * Dry run (preview only):
 *   Body: { "confirm": false } or {}
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LAUNCH_EMAIL_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1A1917; margin: 0; padding: 0; background-color: #FAFAF9;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

    <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #0D8268 0%, #14a085 100%); border-radius: 16px 16px 0 0;">
      <tr>
        <td style="padding: 40px 32px; text-align: center;">
          <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly" width="64" height="64" style="width: 64px; height: 64px; border-radius: 16px; display: block; margin: 0 auto;">
          <h1 style="font-size: 26px; font-weight: 700; margin: 20px 0 0 0; color: #ffffff; letter-spacing: -0.02em;">Clearly is Live!</h1>
        </td>
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="background: #FFFFFF; border-radius: 0 0 16px 16px; border: 1px solid #E8E7E4; border-top: none;">
      <tr>
        <td style="padding: 32px;">

          <p style="color: #5C5856; margin: 0 0 16px 0; font-size: 16px; line-height: 1.7;">
            The wait is over. <strong style="color: #1A1917;">Clearly is now available to download.</strong>
          </p>

          <p style="color: #5C5856; margin: 0 0 28px 0; font-size: 16px; line-height: 1.7;">
            Thank you for being one of our early supporters. As a waitlist member, you believed in our vision before anyone else — and we built Clearly with you in mind.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
            <tr>
              <td style="text-align: center;">
                <a href="https://apps.apple.com/app/clearly" style="display: inline-block; background: #0D8268; color: #ffffff; padding: 16px 40px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px;">Download Clearly</a>
              </td>
            </tr>
          </table>

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

    <p style="text-align: center; font-size: 13px; color: #8C8780; margin: 24px 0 0 0;">
      You're receiving this because you signed up for the Clearly waitlist.<br>
      <a href="https://getclearly.app" style="color: #0D8268; text-decoration: none;">getclearly.app</a>
    </p>

  </div>
</body>
</html>
`;

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if this is a dry run or real send
    let confirm = false;
    try {
      const body = await req.json();
      confirm = body.confirm === true;
    } catch {
      // No body or invalid JSON = dry run
    }

    // Get subscribers who haven't received the launch email
    const { data: subscribers, error: fetchError } = await supabase
      .from("waitlist")
      .select("email, id")
      .is("launch_email_sent", null)
      .order("created_at", { ascending: true });

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscribers", details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!subscribers || subscribers.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No subscribers to email",
          details: "Everyone has already received the launch email"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Dry run - just return preview
    if (!confirm) {
      return new Response(
        JSON.stringify({
          mode: "dry_run",
          message: `Found ${subscribers.length} subscribers to email`,
          preview: subscribers.slice(0, 10).map(s => s.email),
          total: subscribers.length,
          instruction: "To send emails, POST with body: { \"confirm\": true }"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Actually send emails
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const subscriber of subscribers) {
      try {
        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Clearly <noreply@getclearly.app>",
            to: subscriber.email,
            subject: "Clearly is Live! 🎉",
            html: LAUNCH_EMAIL_HTML,
          }),
        });

        if (emailResponse.ok) {
          // Mark as sent
          await supabase
            .from("waitlist")
            .update({
              launch_email_sent: true,
              launch_email_sent_at: new Date().toISOString()
            })
            .eq("email", subscriber.email);
          sent++;
        } else {
          const err = await emailResponse.json();
          errors.push(`${subscriber.email}: ${JSON.stringify(err)}`);
          failed++;
        }

        // Rate limit: 100ms between emails
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (err) {
        errors.push(`${subscriber.email}: ${err.message}`);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({
        mode: "sent",
        message: `Launch emails sent!`,
        sent,
        failed,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Something went wrong", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
