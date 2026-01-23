import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, style_result, secondary_style, answers, source } = await req.json()

    // Validate required fields
    if (!email || !style_result) {
      return new Response(
        JSON.stringify({ error: 'Email and style_result are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Insert into z_assessment_leads table
    const { data, error } = await supabaseClient
      .from('z_assessment_leads')
      .insert({
        email: email.toLowerCase().trim(),
        style_result,
        secondary_style: secondary_style || null,
        answers: answers || [],
        source: source || 'assessment'
      })

    if (error) {
      console.error('Assessment insert error:', error)
      // Check for duplicate email
      if (error.code === '23505') {
        return new Response(
          JSON.stringify({ error: 'Email already registered', code: 'duplicate' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      return new Response(
        JSON.stringify({ error: 'Database error', details: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Also add to z_waitlist table for nurture sequence (don't fail if this errors)
    try {
      await supabaseClient
        .from('z_waitlist')
        .upsert({
          email: email.toLowerCase().trim(),
          source: `assessment-${style_result}`
        }, { onConflict: 'email' })
    } catch (waitlistError) {
      console.error('Waitlist upsert error:', waitlistError)
    }

    // Send results email (async, don't wait)
    sendResultsEmail(email, style_result, secondary_style).catch(console.error)

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Assessment signup error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Style content for email
const STYLES: Record<string, { name: string; tagline: string; pattern: string; helps: string }> = {
  defender: {
    name: 'The Defender',
    tagline: "You're always ready to explain your side.",
    pattern: "When a message comes in, your first instinct is to protect yourself. You explain, justify, or clarify—often before you've fully heard what they're asking. Conversations can feel like you're always on the back foot, even when you don't need to be.",
    helps: "Pause before responding. Read their message again and ask: \"What do they actually need here?\" Often, they're not attacking—they're just asking. You don't have to defend a position they're not questioning."
  },
  fixer: {
    name: 'The Fixer',
    tagline: "You want to solve it and move on.",
    pattern: "You see a problem, you want to fix it. Fast. You jump to solutions—sometimes before the other person feels heard. This efficiency is a strength, but it can feel steamrolling to someone who needs to process before deciding.",
    helps: "Slow down by one beat. Before offering your solution, acknowledge what they said: \"I hear you—that's tricky.\" Then offer options instead of answers: \"Would it work if we...?\" Collaboration lands better than direction."
  },
  avoider: {
    name: 'The Avoider',
    tagline: "You'd rather keep the peace than push back.",
    pattern: "Conflict is exhausting, so you avoid it. You say \"fine\" when it's not fine. You let things slide to prevent a fight. But unresolved issues pile up, and resentment builds quietly—until it doesn't.",
    helps: "Name the small stuff early, before it grows. A quick \"Hey, can we figure out X?\" now is easier than an explosion later. You don't have to fight—you just have to ask. Small asks, made early, prevent big conflicts."
  },
  scorekeeper: {
    name: 'The Scorekeeper',
    tagline: "You track what's fair—and what's not.",
    pattern: "Fairness matters to you. You notice when things are uneven—who did the extra pickup, who paid for the cleats, who got the holiday last year. Tracking isn't wrong, but it can keep you anchored to the past instead of solving the present.",
    helps: "Ask yourself: \"What works for the kids this time?\" instead of \"What's fair based on last time?\" Fairness over time matters—but individual decisions work better when they focus on the current situation, not the historical ledger."
  }
}

async function sendResultsEmail(email: string, styleResult: string, secondaryStyle: string | null) {
  const style = STYLES[styleResult]
  if (!style) return

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_API_KEY) {
    console.log('RESEND_API_KEY not set, skipping email')
    return
  }

  const secondaryText = secondaryStyle
    ? `<p style="color: #5C5856; font-size: 14px; margin-top: 20px;">You also show tendencies toward ${STYLES[secondaryStyle]?.name || secondaryStyle}.</p>`
    : ''

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #FAFAF9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 40px 20px;">

    <!-- Logo -->
    <div style="text-align: center; margin-bottom: 32px;">
      <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly" width="48" height="48">
    </div>

    <!-- Opening -->
    <p style="color: #5C5856; font-size: 16px; line-height: 1.7;">
      Thanks for taking the communication style assessment. Here's what we found—and some practical tips for your next conversation.
    </p>

    <!-- Style Result -->
    <div style="background: white; border: 1px solid #E8E6E4; border-radius: 12px; padding: 28px; margin: 28px 0;">
      <p style="font-size: 13px; color: #0D8268; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 8px 0;">Your style</p>
      <h2 style="font-size: 28px; color: #1A1917; margin: 0 0 8px 0;">${style.name}</h2>
      <p style="font-size: 18px; color: #0D8268; font-style: italic; margin: 0;">"${style.tagline}"</p>
      ${secondaryText}
    </div>

    <!-- The Pattern -->
    <h3 style="font-size: 16px; color: #1A1917; margin: 28px 0 12px 0;">The pattern</h3>
    <p style="color: #5C5856; font-size: 15px; line-height: 1.8;">
      ${style.pattern}
    </p>

    <!-- What Helps -->
    <div style="background: #E6F5F1; border-radius: 12px; padding: 24px; margin: 28px 0;">
      <h3 style="font-size: 16px; color: #0D8268; margin: 0 0 12px 0;">What helps</h3>
      <p style="color: #1A1917; font-size: 15px; line-height: 1.8; margin: 0;">
        ${style.helps}
      </p>
    </div>

    <!-- The Principle -->
    <h3 style="font-size: 18px; color: #1A1917; margin: 36px 0 16px 0;">One thing that helps every style</h3>
    <p style="color: #5C5856; font-size: 15px; line-height: 1.8;">
      When conversations get stuck, it's usually because both people are defending their position instead of talking about what actually matters.
    </p>
    <div style="background: white; border-left: 3px solid #0D8268; padding: 16px 20px; margin: 20px 0;">
      <p style="color: #1A1917; font-size: 14px; margin: 0 0 8px 0;"><strong>Positions</strong> sound like: "I need this weekend."</p>
      <p style="color: #1A1917; font-size: 14px; margin: 0;"><strong>Interests</strong> sound like: "I want to be there for her soccer game."</p>
    </div>
    <p style="color: #5C5856; font-size: 15px; line-height: 1.8;">
      When you focus on the why behind the ask—yours and theirs—solutions get easier to find.
    </p>

    <!-- Soft CTA -->
    <div style="border-top: 1px solid #E8E6E4; margin-top: 36px; padding-top: 28px;">
      <p style="color: #5C5856; font-size: 15px; line-height: 1.8;">
        We're building Clearly—a co-parenting app designed around these same principles. Topic-based conversations that resolve. Structure that makes the day-to-day easier.
      </p>
      <p style="color: #5C5856; font-size: 15px; line-height: 1.8;">
        It's currently in private beta. If you'd like early access, you can <a href="https://getclearly.app" style="color: #0D8268;">request it here</a>.
      </p>
    </div>

    <!-- Sign-off -->
    <div style="margin-top: 36px;">
      <p style="color: #5C5856; font-size: 15px; line-height: 1.7; margin: 0;">
        Wishing you clarity,<br>
        <strong style="color: #1A1917;">The Clearly Team</strong>
      </p>
      <p style="color: #5C5856; font-size: 14px; font-style: italic; margin-top: 16px;">
        P.S. — When communication works, everything else gets easier.
      </p>
    </div>

    <!-- Footer -->
    <div style="border-top: 1px solid #E8E6E4; margin-top: 40px; padding-top: 20px; text-align: center;">
      <p style="color: #9A9896; font-size: 12px; margin: 0;">
        © 2026 Clearly · <a href="https://getclearly.app" style="color: #9A9896;">getclearly.app</a>
      </p>
    </div>
  </div>
</body>
</html>
`

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Clearly <hello@getclearly.app>',
        to: [email],
        subject: `Your co-parenting communication style: ${style.name}`,
        html: emailHtml
      })
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Resend error:', error)
    } else {
      console.log('Results email sent to:', email)

      // Update email_sent flag
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )
      await supabaseClient
        .from('z_assessment_leads')
        .update({ email_sent: true })
        .eq('email', email.toLowerCase().trim())
    }
  } catch (error) {
    console.error('Email send error:', error)
  }
}
