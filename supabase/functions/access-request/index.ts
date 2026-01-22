import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();

    // Validate required fields
    if (!body.email || !body.email.includes("@")) {
      return new Response(
        JSON.stringify({ error: "Valid email required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Sanitize and prepare data
    const data = {
      email: body.email.trim().toLowerCase(),
      reason: body.reason || null,
      notes: body.notes?.slice(0, 2000) || null, // Limit notes length
      page_url: body.page_url?.slice(0, 500) || null,
      referrer: body.referrer?.slice(0, 500) || null,
      submitted_at: body.submitted_at || new Date().toISOString(),
    };

    // Insert into database
    const { error } = await supabase
      .from("access_requests")
      .insert([data]);

    if (error) {
      console.error("Database error:", error);
      throw new Error("Failed to save request");
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process request" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
