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

    // Handle both JSON body and sendBeacon (which may send as text)
    let body;
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await req.json();
    } else {
      const text = await req.text();
      body = JSON.parse(text);
    }

    // Validate session_id
    if (!body.session_id) {
      return new Response(
        JSON.stringify({ error: "session_id required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Prepare data - no PII, just step progression
    const data = {
      session_id: body.session_id,
      started_at: body.started_at || null,
      ended_at: body.ended_at || new Date().toISOString(),
      referrer: body.referrer?.slice(0, 500) || null,
      steps_visited: body.steps_visited || [],
      max_step_index: body.max_step_index ?? 0,
      max_step_name: body.max_step_name || "welcome",
      completed: body.completed === true,
      abandoned: body.abandoned === true,
    };

    // Upsert - update if session exists, insert if new
    const { error } = await supabase
      .from("plan_builder_sessions")
      .upsert([data], {
        onConflict: "session_id",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error("Database error:", error);
      throw new Error("Failed to save session");
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
      JSON.stringify({ error: "Failed to process session" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
