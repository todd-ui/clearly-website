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
            from: "Clearly <noreply@getclearly.app>",
            to: email,
            subject: "You're on the list!",
            html: `
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
          <h1 style="font-size: 26px; font-weight: 700; margin: 20px 0 0 0; color: #ffffff; letter-spacing: -0.02em;">You're on the list!</h1>
        </td>
      </tr>
    </table>

    <!-- Body -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background: #FFFFFF; border-radius: 0 0 16px 16px; border: 1px solid #E8E7E4; border-top: none;">
      <tr>
        <td style="padding: 32px;">

          <p style="color: #5C5856; margin: 0 0 16px 0; font-size: 16px; line-height: 1.7;">
            Thanks for joining the Clearly waitlist. We're building a new kind of co-parenting app — one designed to <strong style="color: #1A1917;">reduce conflict</strong>, not just document it.
          </p>

          <p style="color: #5C5856; margin: 0 0 28px 0; font-size: 16px; line-height: 1.7;">
            We'll let you know the moment Clearly is ready to download. In the meantime, check out our free resources:
          </p>

          <!-- Resource Cards -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
            <tr>
              <td style="padding: 16px 20px; background: #E6F5F1; border-radius: 12px; border: 1px solid #A8DFD0;">
                <a href="https://getclearly.app/blog.html" style="color: #0D8268; text-decoration: none; font-weight: 600; font-size: 15px; display: block; margin-bottom: 4px;">Our Co-Parenting Blog 'Common Ground'</a>
                <span style="color: #5C5856; font-size: 14px;">Practical advice for navigating co-parenting</span>
              </td>
            </tr>
            <tr><td style="height: 12px;"></td></tr>
            <tr>
              <td style="padding: 16px 20px; background: #E6F5F1; border-radius: 12px; border: 1px solid #A8DFD0;">
                <a href="https://getclearly.app/calculators/" style="color: #0D8268; text-decoration: none; font-weight: 600; font-size: 15px; display: block; margin-bottom: 4px;">Child Support Calculators</a>
                <span style="color: #5C5856; font-size: 14px;">Free estimates for NY, CA, TX, FL, IL, and PA</span>
              </td>
            </tr>
          </table>

          <p style="color: #5C5856; margin: 0 0 4px 0; font-size: 16px;">
            Thanks for being an early supporter. We can't wait to share Clearly with you.
          </p>
          <p style="color: #1A1917; margin: 16px 0 0 0; font-weight: 600; font-size: 16px;">
            — The Clearly Team
          </p>

        </td>
      </tr>
    </table>

    <!-- Footer -->
    <p style="text-align: center; font-size: 13px; color: #8C8780; margin: 24px 0 0 0;">
      You signed up at <a href="https://getclearly.app" style="color: #0D8268; text-decoration: none;">getclearly.app</a>
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
