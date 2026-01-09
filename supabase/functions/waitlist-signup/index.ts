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
      .upsert(
        { email: email.toLowerCase().trim(), source },
        { onConflict: "email", ignoreDuplicates: true }
      )
      .select()
      .single();

    if (dbError && dbError.code !== "23505") {
      // 23505 is unique violation (duplicate) - we ignore that
      console.error("Database error:", dbError);
      return new Response(JSON.stringify({ error: "Failed to save email" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
            subject: "You're on the list!",
            html: `
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

  <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 16px; text-align: center;">You're on the list!</h1>

  <p style="color: #4a5568; margin-bottom: 24px;">
    Thanks for joining the Clearly waitlist. We're building a new kind of co-parenting app — one that's designed to reduce conflict, not just document it.
  </p>

  <p style="color: #4a5568; margin-bottom: 24px;">
    We'll let you know the moment Clearly is ready to download. In the meantime, check out our free resources:
  </p>

  <div style="background: #f7fafc; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
    <p style="margin: 0 0 12px 0;"><a href="https://getclearly.app/calculators/" style="color: #0D8268; text-decoration: none; font-weight: 600;">Child Support Calculators</a> — Free estimates for 6 states</p>
    <p style="margin: 0;"><a href="https://getclearly.app/blog.html" style="color: #0D8268; text-decoration: none; font-weight: 600;">Co-Parenting Blog</a> — Practical advice and insights</p>
  </div>

  <p style="color: #4a5568; margin-bottom: 32px;">
    Thanks for being an early supporter. We can't wait to share Clearly with you.
  </p>

  <p style="color: #4a5568; margin-bottom: 0;">
    — The Clearly Team
  </p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 40px 0 24px;">

  <p style="font-size: 12px; color: #a0aec0; text-align: center;">
    You're receiving this because you signed up at getclearly.app.<br>
    <a href="https://getclearly.app" style="color: #a0aec0;">getclearly.app</a>
  </p>
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
