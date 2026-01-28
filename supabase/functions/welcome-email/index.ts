import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface WelcomeEmailRequest {
  email: string;
  displayName: string;
  joinCode: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Only allow POST
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request body
    const { email, displayName, joinCode }: WelcomeEmailRequest = await req.json();

    // Validate required fields
    if (!email || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Valid email required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!joinCode) {
      return new Response(JSON.stringify({ error: "Join code required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send welcome email via Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.warn("RESEND_API_KEY not configured, skipping email");
      return new Response(
        JSON.stringify({ success: true, message: "Email skipped (no API key)" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const firstName = displayName?.split(" ")[0] || "there";

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Clearly <hello@getclearly.app>",
        to: email,
        subject: "Welcome to Clearly — Here's your family code",
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1A1917; margin: 0; padding: 0; background-color: #FAFAF9;">
  <div style="max-width: 560px; margin: 0 auto; padding: 48px 24px;">

    <!-- Logo -->
    <div style="text-align: center; margin-bottom: 40px;">
      <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly" width="56" height="56" style="width: 56px; height: 56px; border-radius: 14px;">
    </div>

    <!-- Main Card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background: #FFFFFF; border-radius: 20px; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
      <tr>
        <td style="padding: 48px 40px;">

          <h1 style="font-size: 28px; font-weight: 700; margin: 0 0 24px 0; color: #1A1917; letter-spacing: -0.02em; text-align: center;">
            Welcome to Clearly, ${firstName}!
          </h1>

          <p style="color: #5C5856; margin: 0 0 32px 0; font-size: 16px; line-height: 1.8; text-align: center;">
            You're all set up. Here's your family code to share with your co-parent:
          </p>

          <!-- Family Code Box -->
          <div style="background: #E6F5F1; border: 2px solid #0D8268; border-radius: 12px; padding: 24px; margin: 0 0 32px 0; text-align: center;">
            <p style="color: #0A6B55; margin: 0 0 8px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; font-weight: 500;">
              Your Family Code
            </p>
            <p style="color: #0D8268; margin: 0; font-size: 36px; font-weight: 700; letter-spacing: 4px; font-family: 'SF Mono', Monaco, 'Courier New', monospace;">
              ${joinCode}
            </p>
          </div>

          <p style="color: #5C5856; margin: 0 0 32px 0; font-size: 15px; line-height: 1.8; text-align: center;">
            When your co-parent downloads Clearly, they can enter this code to join your family and start coordinating together.
          </p>

          <!-- Divider -->
          <div style="height: 1px; background: #E8E7E4; margin: 0 0 32px 0;"></div>

          <!-- What's Next -->
          <p style="color: #8C8780; margin: 0 0 16px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; text-align: center; font-weight: 500;">
            What's next
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #F0F0EE;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width: 32px; vertical-align: top;">
                      <span style="display: inline-block; width: 24px; height: 24px; background: #E6F5F1; border-radius: 50%; text-align: center; line-height: 24px; font-size: 12px; color: #0D8268; font-weight: 600;">1</span>
                    </td>
                    <td style="color: #5C5856; font-size: 15px;">
                      Share the code above with your co-parent
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #F0F0EE;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width: 32px; vertical-align: top;">
                      <span style="display: inline-block; width: 24px; height: 24px; background: #E6F5F1; border-radius: 50%; text-align: center; line-height: 24px; font-size: 12px; color: #0D8268; font-weight: 600;">2</span>
                    </td>
                    <td style="color: #5C5856; font-size: 15px;">
                      Add your children's names
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 0;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width: 32px; vertical-align: top;">
                      <span style="display: inline-block; width: 24px; height: 24px; background: #E6F5F1; border-radius: 50%; text-align: center; line-height: 24px; font-size: 12px; color: #0D8268; font-weight: 600;">3</span>
                    </td>
                    <td style="color: #5C5856; font-size: 15px;">
                      Set up your custody schedule
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>

    <!-- Footer -->
    <p style="text-align: center; font-size: 14px; color: #5C5856; margin: 32px 0 0 0;">
      Questions? We're here to help.
    </p>
    <p style="text-align: center; font-size: 13px; color: #8C8780; margin: 8px 0 0 0;">
      <a href="mailto:support@clearly.app" style="color: #0D8268; text-decoration: none; font-weight: 500;">support@clearly.app</a>
    </p>
    <p style="text-align: center; font-size: 12px; color: #8C8780; margin: 24px 0 0 0;">
      <a href="https://getclearly.app" style="color: #8C8780; text-decoration: none;">getclearly.app</a>
    </p>

  </div>
</body>
</html>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error("Resend API error:", errorText);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to send email" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Welcome email sent" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
