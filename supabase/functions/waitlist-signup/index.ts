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
  notes?: string;
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
    const { email, source = "website", notes }: WaitlistRequest = await req.json();

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
      .from("z_waitlist")
      .insert({
        email: email.toLowerCase().trim(),
        source,
        notes: notes?.trim() || null
      })
      .select()
      .single();

    // Handle duplicate emails gracefully
    let shouldSendEmail = !!data; // New signup
    if (dbError) {
      if (dbError.code === "23505") {
        // Duplicate email - check if we should send welcome email
        console.log("Duplicate email:", email);
        const { data: existing } = await supabase
          .from("z_waitlist")
          .select("welcome_email_sent")
          .eq("email", email.toLowerCase().trim())
          .single();
        shouldSendEmail = existing && !existing.welcome_email_sent;
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
    if (resendApiKey && shouldSendEmail) {
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
            subject: "You're on the list — We'll be in touch",
            html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin: 0; padding: 0; background-color: #FAFAF9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 40px 20px;">

    <!-- Logo -->
    <div style="text-align: center; margin-bottom: 32px;">
      <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly" width="48" height="48">
    </div>

    <!-- Main Card -->
    <div style="background: white; border: 1px solid #E8E6E4; border-radius: 12px; padding: 28px; margin: 0 0 28px 0;">
      <h1 style="font-size: 26px; color: #1A1917; margin: 0 0 16px 0; text-align: center;">You're on the list.</h1>
      <p style="color: #5C5856; font-size: 16px; line-height: 1.7; margin: 0; text-align: center;">
        We're opening access gradually and will send you an invite when it's your turn.
      </p>
    </div>

    <!-- What Clearly Is -->
    <h3 style="font-size: 16px; color: #1A1917; margin: 0 0 12px 0;">A calmer way to co-parent</h3>
    <p style="color: #5C5856; font-size: 15px; line-height: 1.8; margin: 0 0 20px 0;">
      You're not together anymore. But you still have to communicate—about pickups, expenses, holidays, and every decision about your kids. And every message can feel loaded.
    </p>
    <p style="color: #5C5856; font-size: 15px; line-height: 1.8; margin: 0 0 28px 0;">
      Clearly gives those conversations structure, so co-parenting doesn't have to be so hard.
    </p>

    <!-- What's Different -->
    <div style="background: #E6F5F1; border-radius: 12px; padding: 24px; margin: 0 0 28px 0;">
      <h3 style="font-size: 16px; color: #0D8268; margin: 0 0 12px 0;">Structure that actually helps</h3>
      <p style="color: #1A1917; font-size: 15px; line-height: 1.8; margin: 0;">
        Topic-based conversations that resolve. A shared calendar you both can trust. Expense tracking that's fair and transparent. All in one place.
      </p>
    </div>

    <!-- Blog CTA -->
    <p style="color: #5C5856; font-size: 15px; line-height: 1.8; margin: 0 0 16px 0; text-align: center;">
      While you wait, our blog has practical advice for navigating co-parenting.
    </p>
    <div style="text-align: center;">
      <a href="https://getclearly.app/blog.html" style="display: inline-block; background: #0D8268; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 12px 24px; border-radius: 8px;">
        Read Common Ground
      </a>
    </div>

    <!-- Sign-off -->
    <div style="margin-top: 36px; text-align: center;">
      <p style="color: #5C5856; font-size: 15px; line-height: 1.7; margin: 0;">
        Wishing you clarity,<br>
        <strong style="color: #1A1917;">The Clearly Team</strong>
      </p>
    </div>

    <!-- Footer -->
    <div style="border-top: 1px solid #E8E6E4; margin-top: 40px; padding-top: 20px; text-align: center;">
      <p style="color: #9A9896; font-size: 12px; margin: 0;">
        © 2026 Clearly · <a href="https://getclearly.app" style="color: #9A9896;">getclearly.app</a>
      </p>
      <p style="margin-top: 8px;">
        <a href="mailto:hello@getclearly.app?subject=Unsubscribe&body=Please%20remove%20me%20from%20the%20waitlist." style="color: #9A9896; font-size: 12px;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>
            `,
          }),
        });

        if (emailResponse.ok) {
          // Update record to mark email as sent
          await supabase
            .from("z_waitlist")
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
