import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface WaitlistRequest {
  email: string;
  source?: string;
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
    const { email, source = "website" }: WaitlistRequest = await req.json();

    // Validate email
    if (!email || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Valid email required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Insert into waitlist
    const { data, error: dbError } = await supabase
      .from("waitlist")
      .insert({ email: email.toLowerCase().trim(), source })
      .select()
      .single();

    // Handle duplicate emails gracefully
    if (dbError) {
      if (dbError.code === "23505") {
        // Duplicate email - that's fine, they're already on the list
        console.log("Duplicate email:", email);
      } else {
        console.error("Database error:", dbError);
        return new Response(JSON.stringify({ error: "Failed to save email", details: dbError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Send welcome email via Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey && data) {
      try {
        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Clearly <hello@getclearly.app>",
            to: email,
            subject: "Welcome to Clearly — You're in!",
            html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1A1917; margin: 0; padding: 0; background-color: #0a0a0a;">
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
            You're in.
          </h1>

          <p style="color: #5C5856; margin: 0 0 20px 0; font-size: 16px; line-height: 1.8; text-align: center;">
            Thanks for joining the Clearly waitlist. We're building something different — a co-parenting app designed to <strong style="color: #0D8268;">reduce conflict</strong>, not just document it.
          </p>

          <p style="color: #5C5856; margin: 0 0 32px 0; font-size: 16px; line-height: 1.8; text-align: center;">
            Launching Spring 2026. We'll be in touch.
          </p>

          <!-- Divider -->
          <div style="height: 1px; background: #E8E7E4; margin: 0 0 32px 0;"></div>

          <!-- Blog CTA -->
          <p style="color: #8C8780; margin: 0 0 16px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; text-align: center; font-weight: 500;">
            In the meantime
          </p>

          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="text-align: center;">
                <a href="https://getclearly.app/blog.html" style="display: inline-block; background: #0D8268; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
                  Read Our Blog
                </a>
              </td>
            </tr>
          </table>

          <p style="color: #8C8780; margin: 20px 0 0 0; font-size: 14px; text-align: center;">
            Practical advice for navigating co-parenting
          </p>

        </td>
      </tr>
    </table>

    <!-- Footer -->
    <p style="text-align: center; font-size: 13px; color: #5C5856; margin: 32px 0 0 0;">
      <a href="https://getclearly.app" style="color: #0D8268; text-decoration: none; font-weight: 500;">getclearly.app</a>
    </p>

  </div>
</body>
</html>
            `,
          }),
        });

        if (emailResponse.ok) {
          // Update record to mark email as sent
          await supabase
            .from("waitlist")
            .update({ welcome_email_sent: true, welcome_email_sent_at: new Date().toISOString() })
            .eq("email", email.toLowerCase().trim());
        }
      } catch (emailError) {
        console.error("Email send error:", emailError);
        // Don't fail the request if email fails - they're still on the list
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: "You're on the list!" }),
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
