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
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 0; background-color: #f5f7f9;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

    <!-- Header with brand color -->
    <div style="background: linear-gradient(135deg, #0D8268 0%, #14a085 100%); border-radius: 16px 16px 0 0; padding: 40px 32px; text-align: center;">
      <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly" style="width: 72px; height: 72px; border-radius: 18px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);">
      <h1 style="font-size: 28px; font-weight: 700; margin: 24px 0 0 0; color: white;">You're on the list!</h1>
    </div>

    <!-- Body -->
    <div style="background: white; border-radius: 0 0 16px 16px; padding: 40px 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.06);">
      <p style="color: #4a5568; margin: 0 0 20px 0; font-size: 16px;">
        Thanks for joining the Clearly waitlist. We're building a new kind of co-parenting app — one that's designed to <strong style="color: #1a1a1a;">reduce conflict</strong>, not just document it.
      </p>

      <p style="color: #4a5568; margin: 0 0 24px 0; font-size: 16px;">
        We'll let you know the moment Clearly is ready to download. In the meantime, check out our free resources:
      </p>

      <!-- Resources -->
      <div style="background: linear-gradient(135deg, #E6F5F1 0%, #D4EDE6 100%); border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid rgba(13, 130, 104, 0.1);">
        <p style="margin: 0 0 16px 0; font-size: 15px;">
          <a href="https://getclearly.app/calculators/" style="color: #0D8268; text-decoration: none; font-weight: 600;">📊 Child Support Calculators</a><br>
          <span style="color: #4a5568; font-size: 14px;">Free estimates for NY, CA, TX, FL, IL, and PA</span>
        </p>
        <p style="margin: 0; font-size: 15px;">
          <a href="https://getclearly.app/blog.html" style="color: #0D8268; text-decoration: none; font-weight: 600;">📖 Co-Parenting Blog</a><br>
          <span style="color: #4a5568; font-size: 14px;">Practical advice and insights for navigating co-parenting</span>
        </p>
      </div>

      <p style="color: #4a5568; margin: 0 0 24px 0; font-size: 16px;">
        Thanks for being an early supporter. We can't wait to share Clearly with you.
      </p>

      <p style="color: #1a1a1a; margin: 0; font-weight: 600;">
        — The Clearly Team
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding: 24px 0;">
      <p style="font-size: 13px; color: #a0aec0; margin: 0;">
        You signed up at <a href="https://getclearly.app" style="color: #0D8268; text-decoration: none;">getclearly.app</a>
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
