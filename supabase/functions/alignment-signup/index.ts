import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BASE_URL = 'https://getclearly.app'

interface Child {
  name: string
  age: number | null
  gender: string
}

interface Setup {
  parentName?: string
  coParentName?: string
  children?: Child[]
  custodyArrangement?: string
}

interface AlignmentPayload {
  email: string
  setup?: Setup
  responses: Record<string, unknown>
  source?: string
  link_code?: string // Optional: family code to link with existing plan
}

interface NormalizedData {
  email: string
  parent_name: string | null
  coparent_name: string | null
  children: Child[]
  custody_arrangement: string | null
  responses: Record<string, unknown>
  age_variant: string | null
  source: string
}

function getAgeVariant(children: Child[]): string | null {
  if (!children || children.length === 0) return null
  const ages = children.map(c => c.age).filter((a): a is number => a !== null)
  if (ages.length === 0) return null
  const maxAge = Math.max(...ages)
  if (maxAge <= 5) return 'early-childhood'
  if (maxAge <= 9) return 'children'
  if (maxAge <= 12) return 'middle-childhood'
  return 'adolescents'
}

// Generate a random 8-character code (same format as plan_templates)
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Avoiding confusing chars like 0/O, 1/I
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload: AlignmentPayload = await req.json()

    if (!payload.email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(payload.email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const setup = payload.setup || {}
    const children = setup.children || []
    const normalizedEmail = payload.email.toLowerCase().trim()

    const normalized: NormalizedData = {
      email: normalizedEmail,
      parent_name: setup.parentName || null,
      coparent_name: setup.coParentName || null,
      children: children,
      custody_arrangement: setup.custodyArrangement || null,
      responses: payload.responses || {},
      age_variant: getAgeVariant(children),
      source: payload.source || 'alignment-tool'
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Determine the family code to use
    let familyCode: string | null = null
    let linkedPlan = null

    // If linking to an existing plan via code
    if (payload.link_code) {
      const linkCode = payload.link_code.toUpperCase().trim()

      // Look for existing alignment plan with this family code
      const { data: existingPlan } = await supabaseClient
        .from('z_alignment_plans')
        .select('id, email, parent_name, view_token, family_code')
        .eq('family_code', linkCode)
        .is('paired_with', null)
        .single()

      if (existingPlan) {
        linkedPlan = existingPlan
        familyCode = linkCode
      } else {
        // Also check plan_templates and families for the code
        const { data: planTemplate } = await supabaseClient
          .from('plan_templates')
          .select('share_code')
          .eq('share_code', linkCode)
          .single()

        if (planTemplate) {
          familyCode = linkCode
        } else {
          const { data: family } = await supabaseClient
            .from('families')
            .select('join_code')
            .eq('join_code', linkCode)
            .single()

          if (family) {
            familyCode = linkCode
          } else {
            return new Response(
              JSON.stringify({ error: 'Invalid family code. Please check the code and try again.', code: 'invalid_code' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
        }
      }
    }

    // If not linking, find or create a family code for this user
    if (!familyCode) {
      familyCode = await getOrCreateFamilyCode(supabaseClient, normalizedEmail, normalized)
    }

    // Insert new alignment plan
    const { data, error } = await supabaseClient
      .from('z_alignment_plans')
      .insert({
        ...normalized,
        family_code: familyCode,
        completed_at: new Date().toISOString(),
        paired_with: linkedPlan?.id || null
      })
      .select('id, family_code, view_token')
      .single()

    if (error) {
      console.error('Alignment insert error:', error)
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

    // If linked, update the original plan to point back
    if (linkedPlan) {
      await supabaseClient
        .from('z_alignment_plans')
        .update({ paired_with: data.id })
        .eq('id', linkedPlan.id)
    }

    // Add to waitlist
    try {
      await supabaseClient
        .from('z_waitlist')
        .upsert({
          email: normalizedEmail,
          source: 'alignment-tool'
        }, { onConflict: 'email' })
    } catch (waitlistError) {
      console.error('Waitlist upsert error:', waitlistError)
    }

    // Send appropriate email(s)
    if (linkedPlan) {
      // Both plans are now linked - send comparison emails to both
      sendComparisonEmail(normalized, familyCode, linkedPlan).catch(console.error)
      sendComparisonEmailToFirstParent(linkedPlan, familyCode, normalized).catch(console.error)
    } else {
      // First parent - send plan view email
      sendPlanEmail(normalized, data.view_token, familyCode).catch(console.error)
    }

    return new Response(
      JSON.stringify({
        success: true,
        family_code: familyCode,
        view_token: data.view_token,
        is_linked: !!linkedPlan
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Alignment signup error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Get existing family code or create a new one via plan_templates
async function getOrCreateFamilyCode(
  supabase: ReturnType<typeof createClient>,
  email: string,
  data: NormalizedData
): Promise<string> {

  // 1. Check if user has an existing plan_template
  const { data: planTemplate } = await supabase
    .from('plan_templates')
    .select('share_code')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (planTemplate?.share_code) {
    console.log('Using existing plan_template share_code:', planTemplate.share_code)
    return planTemplate.share_code
  }

  // 2. Check if user has a family via profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('family_id')
    .eq('email', email)
    .single()

  if (profile?.family_id) {
    const { data: family } = await supabase
      .from('families')
      .select('join_code')
      .eq('id', profile.family_id)
      .single()

    if (family?.join_code) {
      console.log('Using existing family join_code:', family.join_code)
      return family.join_code
    }
  }

  // 3. Create a new plan_template to get a share_code
  // This keeps the code system unified - alignment creates a plan_template
  // which can later be used in plan-builder or when signing up for the app
  const newCode = generateCode()

  const { data: newTemplate, error } = await supabase
    .from('plan_templates')
    .insert({
      email: email,
      share_code: newCode,
      source: 'alignment-tool',
      // Store minimal child info if available
      children: data.children?.map(c => ({ name: c.name, birthdate: null })) || [],
      family_name: null
    })
    .select('share_code')
    .single()

  if (error) {
    console.error('Error creating plan_template:', error)
    // If insert failed (e.g., code collision), generate and try again
    // For now, just use the generated code
    return newCode
  }

  console.log('Created new plan_template with share_code:', newTemplate.share_code)
  return newTemplate.share_code
}

async function sendPlanEmail(data: NormalizedData, viewToken: string, familyCode: string) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_API_KEY) {
    console.log('RESEND_API_KEY not set, skipping email')
    return
  }

  const childNames = data.children?.map(c => c.name).filter(Boolean).join(', ') || 'your children'
  const parentName = data.parent_name || 'there'
  const viewUrl = `${BASE_URL}/alignment/view/?token=${viewToken}`

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #FAFAF9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 40px 20px;">

    <div style="text-align: center; margin-bottom: 32px;">
      <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly" width="48" height="48">
    </div>

    <p style="color: #5C5856; font-size: 16px; line-height: 1.7;">
      Hi ${parentName},
    </p>
    <p style="color: #5C5856; font-size: 16px; line-height: 1.7;">
      Thank you for completing your Co-Parenting Alignment Plan. Your responses capture your values, intentions, and vision for raising ${childNames}.
    </p>

    <!-- View Plan Button -->
    <div style="text-align: center; margin: 32px 0;">
      <a href="${viewUrl}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #0D8268 0%, #0a6b56 100%); color: white; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 10px;">View Your Alignment Plan</a>
    </div>

    <!-- Family Code -->
    <div style="background: #E6F5F1; border-radius: 12px; padding: 24px; margin: 28px 0;">
      <h3 style="font-size: 16px; color: #0D8268; margin: 0 0 12px 0;">Invite ${data.coparent_name || 'Your Co-Parent'}</h3>
      <p style="color: #1A1917; font-size: 15px; line-height: 1.8; margin: 0 0 16px 0;">
        Share your family code so they can complete their own plan. Once they do, you'll both receive a comparison showing where you align and where you might want to talk.
      </p>
      <div style="background: white; border: 2px dashed #0D8268; border-radius: 8px; padding: 16px; text-align: center;">
        <span style="font-size: 24px; font-weight: 600; color: #0D8268; letter-spacing: 0.15em; font-family: monospace;">${familyCode}</span>
      </div>
      <p style="color: #5C5856; font-size: 13px; margin: 12px 0 0 0; text-align: center;">
        This is your family code — use it across all Clearly tools.
      </p>
    </div>

    <div style="border-top: 1px solid #E8E6E4; margin-top: 36px; padding-top: 28px;">
      <p style="color: #5C5856; font-size: 15px; line-height: 1.8;">
        We're building Clearly—a co-parenting app designed to make day-to-day coordination easier. It's currently in private beta. <a href="https://getclearly.app" style="color: #0D8268;">Request early access</a>.
      </p>
    </div>

    <div style="margin-top: 36px;">
      <p style="color: #5C5856; font-size: 15px; line-height: 1.7; margin: 0;">
        Wishing you clarity,<br>
        <strong style="color: #1A1917;">The Clearly Team</strong>
      </p>
    </div>

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
        to: [data.email],
        subject: 'Your Co-Parenting Alignment Plan',
        html: emailHtml
      })
    })

    if (!response.ok) {
      console.error('Resend error:', await response.text())
    } else {
      console.log('Plan email sent to:', data.email)
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )
      await supabaseClient
        .from('z_alignment_plans')
        .update({ email_sent: true })
        .eq('email', data.email)
    }
  } catch (error) {
    console.error('Email send error:', error)
  }
}

async function sendComparisonEmail(data: NormalizedData, familyCode: string, linkedPlan: { email: string; parent_name: string }) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_API_KEY) return

  const parentName = data.parent_name || 'there'
  const otherParentName = linkedPlan.parent_name || 'your co-parent'
  const compareUrl = `${BASE_URL}/alignment/compare/?code=${familyCode}`

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #FAFAF9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 40px 20px;">

    <div style="text-align: center; margin-bottom: 32px;">
      <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly" width="48" height="48">
    </div>

    <p style="color: #5C5856; font-size: 16px; line-height: 1.7;">
      Hi ${parentName},
    </p>
    <p style="color: #5C5856; font-size: 16px; line-height: 1.7;">
      Great news — both you and ${otherParentName} have completed your Co-Parenting Alignment Plans. You can now see where your parenting values align and where you might benefit from a conversation.
    </p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${compareUrl}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #0D8268 0%, #0a6b56 100%); color: white; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 10px;">View Your Comparison</a>
    </div>

    <div style="background: #E6F5F1; border-radius: 12px; padding: 24px; margin: 28px 0;">
      <h3 style="font-size: 16px; color: #0D8268; margin: 0 0 12px 0;">What You'll See</h3>
      <ul style="color: #1A1917; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
        <li><strong>Aligned</strong> — Areas where you both agree</li>
        <li><strong>Close</strong> — Similar views with minor differences</li>
        <li><strong>Divergent</strong> — Areas worth discussing together</li>
      </ul>
    </div>

    <div style="margin-top: 36px;">
      <p style="color: #5C5856; font-size: 15px; line-height: 1.7; margin: 0;">
        Wishing you clarity,<br>
        <strong style="color: #1A1917;">The Clearly Team</strong>
      </p>
    </div>

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
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Clearly <hello@getclearly.app>',
        to: [data.email],
        subject: 'Your Co-Parenting Alignment Comparison is Ready',
        html: emailHtml
      })
    })
    console.log('Comparison email sent to:', data.email)
  } catch (error) {
    console.error('Email send error:', error)
  }
}

async function sendComparisonEmailToFirstParent(firstParent: { email: string; parent_name: string; view_token: string }, familyCode: string, secondParent: NormalizedData) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_API_KEY) return

  const parentName = firstParent.parent_name || 'there'
  const otherParentName = secondParent.parent_name || 'Your co-parent'
  const compareUrl = `${BASE_URL}/alignment/compare/?code=${familyCode}`

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #FAFAF9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 40px 20px;">

    <div style="text-align: center; margin-bottom: 32px;">
      <img src="https://dwncravjhkbclbuzijra.supabase.co/storage/v1/object/public/Clearly%20Logos/icon.png" alt="Clearly" width="48" height="48">
    </div>

    <p style="color: #5C5856; font-size: 16px; line-height: 1.7;">
      Hi ${parentName},
    </p>
    <p style="color: #5C5856; font-size: 16px; line-height: 1.7;">
      ${otherParentName} has completed their Co-Parenting Alignment Plan! You can now see how your parenting values compare — where you naturally align and where you might want to have a conversation.
    </p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${compareUrl}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #0D8268 0%, #0a6b56 100%); color: white; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 10px;">View Your Comparison</a>
    </div>

    <div style="background: #E6F5F1; border-radius: 12px; padding: 24px; margin: 28px 0;">
      <h3 style="font-size: 16px; color: #0D8268; margin: 0 0 12px 0;">What You'll See</h3>
      <ul style="color: #1A1917; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
        <li><strong>Aligned</strong> — Areas where you both agree</li>
        <li><strong>Close</strong> — Similar views with minor differences</li>
        <li><strong>Divergent</strong> — Areas worth discussing together</li>
      </ul>
    </div>

    <div style="margin-top: 36px;">
      <p style="color: #5C5856; font-size: 15px; line-height: 1.7; margin: 0;">
        Wishing you clarity,<br>
        <strong style="color: #1A1917;">The Clearly Team</strong>
      </p>
    </div>

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
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Clearly <hello@getclearly.app>',
        to: [firstParent.email],
        subject: 'Your Co-Parenting Alignment Comparison is Ready',
        html: emailHtml
      })
    })
    console.log('Comparison email sent to first parent:', firstParent.email)
  } catch (error) {
    console.error('Email send error:', error)
  }
}
