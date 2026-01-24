import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ProfessionalRequest {
  email: string;
  name?: string;
  profession_type?: string;
  organization?: string;
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
    const { email, name, profession_type, organization }: ProfessionalRequest = await req.json();

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

    // Insert into professionals table
    const { data, error: dbError } = await supabase
      .from("z_professionals")
      .insert({
        email: email.toLowerCase().trim(),
        name: name?.trim() || null,
        profession_type: profession_type?.trim() || null,
        organization: organization?.trim() || null
      })
      .select()
      .single();

    // Handle duplicate emails gracefully
    let shouldSendEmail = !!data; // New signup
    if (dbError) {
      if (dbError.code === "23505") {
        // Duplicate email - check if we should send welcome email
        console.log("Duplicate professional email:", email);
        const { data: existing } = await supabase
          .from("z_professionals")
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
            subject: "Welcome to Clearly — For Professionals",
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

    <!-- Opening -->
    <p style="color: #5C5856; font-size: 16px; line-height: 1.7;">
      Thank you for your interest in Clearly. We're building with legal and family professionals in mind.
    </p>

    <!-- Main Card -->
    <div style="background: white; border: 1px solid #E8E6E4; border-radius: 12px; padding: 28px; margin: 28px 0;">
      <p style="font-size: 13px; color: #0D8268; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 8px 0;">For Professionals</p>
      <h2 style="font-size: 24px; color: #1A1917; margin: 0 0 16px 0;">Clear, time-stamped, professionally reviewable records.</h2>
      <p style="font-size: 15px; color: #5C5856; margin: 0;">We'll notify you when we launch so you can see how Clearly can help your clients.</p>
    </div>

    <!-- What's coming -->
    <h3 style="font-size: 16px; color: #1A1917; margin: 28px 0 12px 0;">What we're building</h3>
    <p style="color: #5C5856; font-size: 15px; line-height: 1.8;">
      • Streamlined record review and export tools<br>
      • Complete communication history with timestamps<br>
      • Custody calendar documentation<br>
      • Expense tracking with receipt attachments<br>
      • Professional resources and best practices
    </p>

    <!-- CTA -->
    <div style="background: #E6F5F1; border-radius: 12px; padding: 24px; margin: 28px 0;">
      <h3 style="font-size: 16px; color: #0D8268; margin: 0 0 12px 0; text-align: center;">Learn more</h3>
      <p style="color: #1A1917; font-size: 15px; line-height: 1.8; margin: 0 0 16px 0; text-align: center;">
        See what we're building for legal and family professionals.
      </p>
      <div style="text-align: center;">
        <a href="https://getclearly.app/professionals.html" style="display: inline-block; background: #0D8268; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 12px 24px; border-radius: 8px;">
          For Professionals
        </a>
      </div>
    </div>

    <!-- Sign-off -->
    <div style="margin-top: 36px;">
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
        <a href="mailto:hello@getclearly.app?subject=Unsubscribe&body=Please%20remove%20me%20from%20the%20professional%20mailing%20list." style="color: #9A9896; font-size: 12px;">Unsubscribe</a>
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
            .from("z_professionals")
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
