import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Only allow GET
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get code from URL params
    const url = new URL(req.url);
    const code = url.searchParams.get("code")?.toUpperCase().trim();

    if (!code) {
      return new Response(JSON.stringify({ error: "Family code required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // FIRST: Check if this is an existing family's join_code (live data)
    const { data: family } = await supabase
      .from("families")
      .select("id, join_code, name")
      .eq("join_code", code)
      .single();

    if (family) {
      // Family exists - get the live plan data and children
      const [planResult, childrenResult] = await Promise.all([
        supabase.from("plan").select("*").eq("family_id", family.id).single(),
        supabase.from("children").select("id, name, date_of_birth").eq("family_id", family.id),
      ]);

      const plan = planResult.data;
      const children = childrenResult.data || [];

      // Build plan data from live family data
      const planData = {
        family_name: family.name,
        children: children.map((c: any) => ({
          name: c.name,
          birthdate: c.date_of_birth,
        })),
        // Schedule settings from plan table
        custody_schedule: plan?.custody_schedule,
        custody_anchor_date: plan?.custody_anchor_date,
        custody_anchor_parent: plan?.custody_anchor_parent,
        custody_anchor_position: plan?.custody_anchor_position,
        week1_parent: plan?.week1_parent,
        week1_iso_parity: plan?.week1_iso_parity,
        exchange_time: plan?.exchange_time,
        custom_pattern: plan?.custom_pattern,
        // Holidays
        holiday_custody: plan?.holiday_custody,
        holiday_scopes: plan?.holiday_scope,
        tracked_holidays: plan?.tracked_holidays,
        custom_holidays: plan?.custom_holidays,
        // Summer
        summer_enabled: plan?.summer_schedule_enabled,
        summer_start: plan?.summer_start_week ? {
          week: plan.summer_start_week,
          day: plan.summer_start_weekday,
          month: plan.summer_start_month,
        } : null,
        summer_end: plan?.summer_end_week ? {
          week: plan.summer_end_week,
          day: plan.summer_end_weekday,
          month: plan.summer_end_month,
        } : null,
        summer_pattern: plan?.summer_custody_pattern,
        summer_start_parent: plan?.summer_starts_with_user ? "you" : "coparent",
        // Expenses (these are on profile, not plan - skip for now)
        expense_split_you: null,
        expense_categories: null,
        payment_method: null,
        payment_handle: null,
      };

      return new Response(
        JSON.stringify({
          success: true,
          share_code: code,
          family_id: family.id,
          source: "family",
          plan_data: planData,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // SECOND: Check if this is an unredeemed plan_template code
    const { data: planTemplate, error: templateError } = await supabase
      .from("plan_templates")
      .select("*")
      .eq("share_code", code)
      .single();

    if (templateError || !planTemplate) {
      return new Response(JSON.stringify({
        error: "Family code not found. Please check your code.",
        code: code
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if plan template has expired (90 days)
    const createdAt = new Date(planTemplate.created_at);
    const now = new Date();
    const daysSinceCreation = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceCreation > 90) {
      return new Response(JSON.stringify({ error: "This plan code has expired (90 days). Please create a new plan." }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Return plan template data (not yet redeemed)
    const planData = {
      family_name: planTemplate.family_name,
      children: planTemplate.children,
      custody_schedule: planTemplate.custody_schedule,
      custody_anchor_date: planTemplate.custody_anchor_date,
      custody_anchor_parent: planTemplate.custody_anchor_parent,
      custody_anchor_position: planTemplate.custody_anchor_position,
      week1_parent: planTemplate.week1_parent,
      week1_iso_parity: planTemplate.week1_iso_parity,
      exchange_time: planTemplate.exchange_time,
      custom_pattern: planTemplate.custom_pattern,
      // Holidays
      holiday_custody: planTemplate.holiday_custody,
      holiday_scopes: planTemplate.holiday_scopes,
      tracked_holidays: planTemplate.tracked_holidays,
      custom_holidays: planTemplate.custom_holidays,
      // Summer
      summer_enabled: planTemplate.summer_schedule_enabled,
      summer_start: planTemplate.summer_start_week ? {
        week: planTemplate.summer_start_week,
        day: planTemplate.summer_start_weekday,
        month: planTemplate.summer_start_month,
      } : null,
      summer_end: planTemplate.summer_end_week ? {
        week: planTemplate.summer_end_week,
        day: planTemplate.summer_end_weekday,
        month: planTemplate.summer_end_month,
      } : null,
      summer_pattern: planTemplate.summer_custody_pattern,
      summer_start_parent: planTemplate.summer_starts_with,
      // Expenses
      expense_split_you: planTemplate.expense_split_you,
      expense_categories: planTemplate.expense_categories,
      payment_method: planTemplate.reimbursement_method,
      payment_handle: planTemplate.reimbursement_handle,
    };

    return new Response(
      JSON.stringify({
        success: true,
        share_code: planTemplate.share_code,
        source: "template",
        plan_data: planData,
      }),
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
