import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PlanTemplateRequest {
  email: string;
  first_name?: string;
  family_name?: string;
  family_id?: string; // If provided, update existing family instead of creating template
  template_code?: string; // If provided, update existing plan template
  children: Array<{ name: string; birthdate?: string; ageGroup?: string }>;
  custody_schedule: string;
  custody_anchor_date?: string;
  custody_anchor_parent?: string;
  custody_anchor_position?: number;
  week1_parent?: string;
  week1_iso_parity?: string;
  exchange_time?: string;
  custom_pattern?: number[];
  holiday_preset?: string;
  holidays?: Record<string, string>;
  holiday_custody?: Record<string, string>;
  holiday_scopes?: Record<string, string>;
  tracked_holidays?: string[];
  custom_holidays?: Array<{ id: string; name: string; myYears?: string; years?: Record<string, any> }>;
  summer_schedule_enabled?: boolean;
  summer_start_month?: number;
  summer_start_week?: number;
  summer_start_weekday?: number;
  summer_end_month?: number;
  summer_end_week?: number;
  summer_end_weekday?: number;
  summer_custody_pattern?: string;
  summer_starts_with?: string;
  expense_split_you?: number;
  expense_split_coparent?: number;
  expense_categories?: string[];
  reimbursement_method?: string;
  reimbursement_handle?: string;
  pathway?: string;
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
    const data: PlanTemplateRequest = await req.json();

    // Validate email (not required for updates)
    if (!data.family_id && !data.template_code && (!data.email || !data.email.includes("@"))) {
      return new Response(JSON.stringify({ error: "Valid email required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ===== UPDATE EXISTING FAMILY =====
    if (data.family_id) {
      // Verify family exists
      const { data: family, error: familyError } = await supabase
        .from("families")
        .select("id, join_code")
        .eq("id", data.family_id)
        .single();

      if (familyError || !family) {
        return new Response(JSON.stringify({ error: "Family not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update family name if provided
      if (data.family_name) {
        await supabase
          .from("families")
          .update({ name: data.family_name })
          .eq("id", data.family_id);
      }

      // Build plan update object
      const planUpdate: Record<string, any> = {
        custody_schedule: data.custody_schedule,
        exchange_time: data.exchange_time,
      };

      if (data.week1_parent) planUpdate.week1_parent = data.week1_parent;
      if (data.week1_iso_parity) planUpdate.week1_iso_parity = data.week1_iso_parity;
      if (data.custody_anchor_date) planUpdate.custody_anchor_date = data.custody_anchor_date;
      if (data.custody_anchor_parent) planUpdate.custody_anchor_parent = data.custody_anchor_parent;
      if (data.custody_anchor_position !== undefined) planUpdate.custody_anchor_position = data.custody_anchor_position;
      if (data.custom_pattern) planUpdate.custom_pattern = data.custom_pattern;

      // Holidays
      if (data.holiday_custody) planUpdate.holiday_custody = data.holiday_custody;
      if (data.holiday_scopes) planUpdate.holiday_scope = data.holiday_scopes;
      if (data.tracked_holidays) planUpdate.tracked_holidays = data.tracked_holidays;
      if (data.custom_holidays) planUpdate.custom_holidays = data.custom_holidays;

      // Summer
      planUpdate.summer_schedule_enabled = data.summer_schedule_enabled ?? false;
      if (data.summer_schedule_enabled) {
        planUpdate.summer_start_month = data.summer_start_month;
        planUpdate.summer_start_week = data.summer_start_week;
        planUpdate.summer_start_weekday = data.summer_start_weekday;
        planUpdate.summer_end_month = data.summer_end_month;
        planUpdate.summer_end_week = data.summer_end_week;
        planUpdate.summer_end_weekday = data.summer_end_weekday;
        planUpdate.summer_custody_pattern = data.summer_custody_pattern;
        planUpdate.summer_starts_with_user = data.summer_starts_with === "you";
      }

      // Update or create plan
      const { data: existingPlan } = await supabase
        .from("plan")
        .select("id")
        .eq("family_id", data.family_id)
        .single();

      if (existingPlan) {
        const { error: planError } = await supabase
          .from("plan")
          .update(planUpdate)
          .eq("family_id", data.family_id);

        if (planError) {
          console.error("Error updating plan:", planError);
          return new Response(JSON.stringify({ error: "Failed to update plan", details: planError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        const { error: planError } = await supabase
          .from("plan")
          .insert([{ family_id: data.family_id, ...planUpdate }]);

        if (planError) {
          console.error("Error creating plan:", planError);
          return new Response(JSON.stringify({ error: "Failed to create plan", details: planError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Update children - delete existing and re-insert
      // First get existing children to preserve IDs if names match
      const { data: existingChildren } = await supabase
        .from("children")
        .select("id, name")
        .eq("family_id", data.family_id);

      // Delete all existing children for this family
      await supabase.from("children").delete().eq("family_id", data.family_id);

      // Insert new children
      if (data.children && data.children.length > 0) {
        const childrenToInsert = data.children.map((child, index) => ({
          family_id: data.family_id,
          name: child.name && child.name.trim() ? child.name : `Child ${index + 1}`,
          date_of_birth: child.birthdate || null,
        }));

        const { error: childrenError } = await supabase
          .from("children")
          .insert(childrenToInsert);

        if (childrenError) {
          console.error("Error updating children:", childrenError);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          share_code: family.join_code,
          family_id: data.family_id,
          message: "Plan updated successfully!",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ===== UPDATE EXISTING PLAN TEMPLATE =====
    if (data.template_code) {
      // Verify template exists
      const { data: existingTemplate, error: templateError } = await supabase
        .from("plan_templates")
        .select("id, share_code")
        .eq("share_code", data.template_code.toUpperCase())
        .single();

      if (templateError || !existingTemplate) {
        return new Response(JSON.stringify({ error: "Plan template not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update the template
      const { error: updateError } = await supabase
        .from("plan_templates")
        .update({
          family_name: data.family_name,
          children: data.children,
          custody_schedule: data.custody_schedule,
          custody_anchor_date: data.custody_anchor_date,
          custody_anchor_parent: data.custody_anchor_parent,
          custody_anchor_position: data.custody_anchor_position,
          week1_parent: data.week1_parent,
          week1_iso_parity: data.week1_iso_parity,
          exchange_time: data.exchange_time,
          custom_pattern: data.custom_pattern,
          holiday_preset: data.holiday_preset,
          holidays: data.holidays,
          holiday_custody: data.holiday_custody,
          holiday_scopes: data.holiday_scopes,
          tracked_holidays: data.tracked_holidays,
          custom_holidays: data.custom_holidays,
          summer_schedule_enabled: data.summer_schedule_enabled,
          summer_start_month: data.summer_start_month,
          summer_start_week: data.summer_start_week,
          summer_start_weekday: data.summer_start_weekday,
          summer_end_month: data.summer_end_month,
          summer_end_week: data.summer_end_week,
          summer_end_weekday: data.summer_end_weekday,
          summer_custody_pattern: data.summer_custody_pattern,
          summer_starts_with: data.summer_starts_with,
          expense_split_you: data.expense_split_you,
          expense_split_coparent: data.expense_split_coparent,
          expense_categories: data.expense_categories,
          reimbursement_method: data.reimbursement_method,
          reimbursement_handle: data.reimbursement_handle,
          updated_at: new Date().toISOString(),
        })
        .eq("share_code", data.template_code.toUpperCase());

      if (updateError) {
        console.error("Error updating template:", updateError);
        return new Response(JSON.stringify({ error: "Failed to update plan", details: updateError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          share_code: existingTemplate.share_code,
          message: "Plan updated successfully!",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ===== CREATE NEW PLAN TEMPLATE =====
    const { data: planTemplate, error: dbError } = await supabase
      .from("plan_templates")
      .insert({
        email: data.email.toLowerCase().trim(),
        first_name: data.first_name,
        family_name: data.family_name,
        children: data.children,
        custody_schedule: data.custody_schedule,
        custody_anchor_date: data.custody_anchor_date,
        custody_anchor_parent: data.custody_anchor_parent,
        custody_anchor_position: data.custody_anchor_position,
        week1_parent: data.week1_parent,
        week1_iso_parity: data.week1_iso_parity,
        exchange_time: data.exchange_time,
        custom_pattern: data.custom_pattern,
        holiday_preset: data.holiday_preset,
        holidays: data.holidays,
        holiday_custody: data.holiday_custody,
        holiday_scopes: data.holiday_scopes,
        tracked_holidays: data.tracked_holidays,
        custom_holidays: data.custom_holidays,
        summer_schedule_enabled: data.summer_schedule_enabled,
        summer_start_month: data.summer_start_month,
        summer_start_week: data.summer_start_week,
        summer_start_weekday: data.summer_start_weekday,
        summer_end_month: data.summer_end_month,
        summer_end_week: data.summer_end_week,
        summer_end_weekday: data.summer_end_weekday,
        summer_custody_pattern: data.summer_custody_pattern,
        summer_starts_with: data.summer_starts_with,
        expense_split_you: data.expense_split_you,
        expense_split_coparent: data.expense_split_coparent,
        expense_categories: data.expense_categories,
        reimbursement_method: data.reimbursement_method,
        reimbursement_handle: data.reimbursement_handle,
        pathway: data.pathway,
        source: data.source || "web-plan-builder",
      })
      .select("share_code")
      .single();

    if (dbError) {
      console.error("Database error:", dbError);
      return new Response(JSON.stringify({ error: "Failed to save plan", details: dbError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Note: Plan builder users are NOT added to waitlist - they're active users
    // who just need to complete account setup in the app. Waitlist is for
    // pre-launch "notify me" signups only.

    // Send email with plan code via Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey && planTemplate) {
      try {
        const firstName = data.first_name || "there";
        const scheduleNames: Record<string, string> = {
          "week-on-week-off": "Alternating Weeks",
          "2-2-3": "2-2-3",
          "5-2-2-5": "5-2-2-5",
          "3-4-4-3": "3-4-4-3",
          "4-3": "4-3",
          "primary-every-other-weekend": "Primary + Every Other Weekend",
          "every-other-weekend-only": "Every Other Weekend Only",
          "custom": "Custom Schedule",
        };
        const scheduleName = scheduleNames[data.custody_schedule] || data.custody_schedule;

        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Clearly <hello@getclearly.app>",
            to: data.email,
            subject: `Your Clearly Family Code: ${planTemplate.share_code}`,
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
            Your Family Code
          </h1>

          <!-- Family Code -->
          <div style="background: #E6F5F1; border: 2px solid #0D8268; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
            <p style="font-size: 36px; font-weight: 700; color: #0D8268; font-family: monospace; letter-spacing: 4px; margin: 0;">
              ${planTemplate.share_code}
            </p>
          </div>

          <p style="color: #5C5856; margin: 0 0 24px 0; font-size: 16px; line-height: 1.8; text-align: center;">
            Hi ${firstName}! Your custody plan is ready. Download the Clearly app, enter this code, and create a password to complete your account setup.
          </p>

          <!-- Plan Summary -->
          <div style="background: #FAFAF9; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <p style="font-size: 13px; color: #8C8780; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 12px 0; font-weight: 500;">
              Your Plan Summary
            </p>
            <p style="color: #1A1917; margin: 0; font-size: 15px;">
              <strong>Schedule:</strong> ${scheduleName}<br>
              <strong>Children:</strong> ${data.children.map(c => c.name || 'Child').join(', ')}<br>
              <strong>Exchange Time:</strong> ${formatTime(data.exchange_time || '18:00')}<br>
              <strong>Holidays:</strong> ${getHolidaySummary(data.holiday_preset)}<br>
              <strong>Summer:</strong> ${getSummerSummary(data)}
            </p>
          </div>

          <!-- Divider -->
          <div style="height: 1px; background: #E8E7E4; margin: 0 0 24px 0;"></div>

          <!-- Next Steps -->
          <p style="color: #8C8780; margin: 0 0 16px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; text-align: center; font-weight: 500;">
            Complete Your Setup
          </p>

          <div style="color: #5C5856; font-size: 14px; margin-bottom: 24px;">
            <p style="margin: 0 0 8px 0;"><strong>1.</strong> Download Clearly from the App Store</p>
            <p style="margin: 0 0 8px 0;"><strong>2.</strong> Tap "I have a family code" and enter: <strong>${planTemplate.share_code}</strong></p>
            <p style="margin: 0;"><strong>3.</strong> Create a password to finish setting up your account</p>
          </div>

          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="text-align: center;">
                <a href="https://apps.apple.com/app/clearly-co-parenting" style="display: inline-block; background: #0D8268; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 10px;">
                  Download Clearly
                </a>
              </td>
            </tr>
          </table>

          <p style="color: #8C8780; margin: 20px 0 0 0; font-size: 14px; text-align: center;">
            Share this code with your co-parent — they can use it to join your family with all the same settings already configured.
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

        if (!emailResponse.ok) {
          console.error("Email send failed:", await emailResponse.text());
        }
      } catch (emailError) {
        console.error("Email send error:", emailError);
        // Don't fail the request if email fails
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        share_code: planTemplate.share_code,
        message: "Plan saved successfully!",
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

function formatTime(time: string): string {
  if (!time) return "6:00 PM";
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHours}:${minutes.toString().padStart(2, "0")} ${period}`;
}

function getHolidaySummary(preset: string | undefined): string {
  const presetNames: Record<string, string> = {
    alternate: "Alternating each year",
    split: "Fixed assignment each year",
    custom: "Custom assignments",
  };
  return presetNames[preset || "alternate"] || "Alternating each year";
}

function getSummerSummary(data: PlanTemplateRequest): string {
  if (!data.summer_schedule_enabled) {
    return "Same as regular schedule";
  }

  const weekNames = ["", "1st", "2nd", "3rd", "4th", "Last"];
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const monthNames = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const startMonth = data.summer_start_month || 6;
  const startWeek = data.summer_start_week || 2;
  const startWeekday = data.summer_start_weekday || 5;
  const endMonth = data.summer_end_month || 8;
  const endWeek = data.summer_end_week || 3;
  const endWeekday = data.summer_end_weekday || 0;

  const startDate = `${weekNames[startWeek]} ${dayNames[startWeekday]} of ${monthNames[startMonth]}`;
  const endDate = `${weekNames[endWeek]} ${dayNames[endWeekday]} of ${monthNames[endMonth]}`;

  const patternNames: Record<string, string> = {
    same: "Same as regular",
    "alternating-weeks": "Alternating weeks",
    "alternating-2-weeks": "Alternating 2-week blocks",
    "extended-you": "Extended time with you",
    "extended-coparent": "Extended time with co-parent",
    custom: "Custom",
  };
  const pattern = patternNames[data.summer_custody_pattern || "same"] || "Same as regular";

  return `${startDate} – ${endDate} (${pattern})`;
}
