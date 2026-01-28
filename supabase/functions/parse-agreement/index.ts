import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ParseRequest {
  document: string; // base64 encoded PDF
  userParentRole?: string; // 'mother', 'father', 'petitioner', 'respondent'
}

interface ParsedAgreement {
  schedule?: {
    type: string;
    description?: string;
  };
  exchangeTime?: string;
  holidays?: Record<string, string>;
  summer?: {
    enabled: boolean;
    pattern?: string;
  };
  expenses?: {
    splitYou: number;
    splitCoparent: number;
  };
  children?: Array<{ name: string; ageGroup?: string }>;
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

    const { document, userParentRole }: ParseRequest = await req.json();

    if (!document) {
      return new Response(JSON.stringify({ error: "Document required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get Anthropic API key
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!anthropicApiKey) {
      return new Response(JSON.stringify({ error: "AI parsing not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call Claude API with the document
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: document,
                },
              },
              {
                type: "text",
                text: `You are a legal document analyst extracting custody agreement details. Read the ENTIRE document carefully and extract precise information.

THE USER IS: ${userParentRole === 'father' || userParentRole === 'respondent' ? 'Father/Respondent (second parent)' : 'Mother/Petitioner (first parent)'}

CRITICAL INSTRUCTIONS:
- "${userParentRole === 'father' || userParentRole === 'respondent' ? 'Father' : 'Mother'}" or "${userParentRole === 'father' || userParentRole === 'respondent' ? 'Respondent' : 'Petitioner'}" = "you" (the user)
- The other parent = "coparent"
- Only extract what is EXPLICITLY stated in the document
- For schedule type, carefully analyze the weekly pattern described

SCHEDULE PATTERN DETECTION:
- If one parent has Mon-Tue, other has Wed-Thu, weekends alternate = "5-2-2-5"
- If exchanges happen Mon/Wed/Fri with 2-2-3 day splits = "2-2-3"
- If one parent has Mon-Thu, other has Fri-Sun = "4-3"
- If full week alternates = "week-on-week-off"
- If one parent has most weekdays, other gets every other weekend = "primary-every-other-weekend"

Return this EXACT JSON structure:

{
  "children": [
    { "name": "Full Name", "ageGroup": "6-12", "birthdate": "YYYY-MM-DD if stated" }
  ],

  "schedule": {
    "type": "5-2-2-5",
    "excerpt": "Quote the exact sentence(s) describing the regular schedule"
  },

  "exchangeTime": "15:00",
  "exchangeTimeExcerpt": "Quote describing exchange time",

  "holidays": {
    "thanksgiving": { "assignment": "alternate_you", "excerpt": "Mother has Thanksgiving in odd years..." },
    "christmas_eve": { "assignment": "you", "excerpt": "Quote about Christmas Eve" },
    "christmas_day": { "assignment": "coparent", "excerpt": "Quote about Christmas Day" },
    "new_years_eve": { "assignment": "alternate_you", "excerpt": "Quote if mentioned" },
    "new_years_day": { "assignment": "alternate_coparent", "excerpt": "Quote if mentioned" },
    "easter": { "assignment": "alternate_you", "excerpt": "Quote if mentioned" },
    "memorial_day": { "assignment": "you", "excerpt": "Quote if mentioned" },
    "july_4th": { "assignment": "alternate_you", "excerpt": "Quote if mentioned" },
    "labor_day": { "assignment": "coparent", "excerpt": "Quote if mentioned" },
    "mothers_day": { "assignment": "you", "excerpt": "Quote if mentioned" },
    "fathers_day": { "assignment": "coparent", "excerpt": "Quote if mentioned" },
    "spring_break": { "assignment": "alternate_you", "excerpt": "Quote if mentioned" }
  },

  "summer": {
    "enabled": true,
    "pattern": "alternating-weeks",
    "startDate": "When summer schedule begins",
    "endDate": "When summer schedule ends",
    "excerpt": "Quote the summer schedule section"
  },

  "expenses": {
    "splitYou": null,
    "splitCoparent": null,
    "excerpt": null
  },

  "categorySummaries": {
    "schedule": "1-2 sentence summary of regular custody schedule",
    "holidays": "1-2 sentence summary of holiday arrangements",
    "summer": "1-2 sentence summary of summer schedule",
    "expenses": "1-2 sentence summary of expense sharing"
  }
}

Assignment values: "you", "coparent", "alternate_you" (alternates starting with first parent in odd years), "alternate_coparent" (alternates starting with second parent in odd years)

CRITICAL: Only include data that is EXPLICITLY stated in the document.
- NEVER guess or assume - only extract what's written
- If expense split is NOT mentioned (and many agreements don't include this), you MUST set splitYou and splitCoparent to null - do NOT guess 50/50 or any other value
- If a holiday is NOT mentioned, do NOT include it in the holidays object
- If summer schedule is NOT mentioned, set enabled to false
- For categorySummaries.expenses, if no expense info is found, set to "Expense sharing not specified in this agreement"

Only include holidays that are EXPLICITLY mentioned in the document. Omit any not mentioned.`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Claude API error:", error);
      console.error("Response status:", response.status);
      return new Response(JSON.stringify({ error: "Failed to analyze document", details: error, status: response.status }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const content = result.content?.[0]?.text;

    if (!content) {
      return new Response(JSON.stringify({ error: "No analysis returned" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse the JSON from Claude's response
    let parsedData: ParsedAgreement;
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      console.error("Raw content:", content);
      return new Response(JSON.stringify({ error: "Failed to parse analysis" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: parsedData,
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
