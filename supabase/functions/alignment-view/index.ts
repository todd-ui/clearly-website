import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    const code = url.searchParams.get('code')

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // View single plan by token
    if (token) {
      const { data: plan, error } = await supabaseClient
        .from('z_alignment_plans')
        .select('parent_name, coparent_name, children, custody_arrangement, responses, family_code, paired_with')
        .eq('view_token', token)
        .single()

      if (error || !plan) {
        return new Response(
          JSON.stringify({ error: 'Plan not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ plan, has_comparison: !!plan.paired_with }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Compare plans by family code
    if (code) {
      // Find the first plan with this code
      const { data: plan1, error: error1 } = await supabaseClient
        .from('z_alignment_plans')
        .select('id, parent_name, coparent_name, children, custody_arrangement, responses, paired_with')
        .eq('family_code', code.toUpperCase())
        .single()

      if (error1 || !plan1) {
        return new Response(
          JSON.stringify({ error: 'Alignment plan not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check if it has a paired plan
      if (!plan1.paired_with) {
        return new Response(
          JSON.stringify({ error: 'Comparison not available yet - waiting for co-parent to complete their plan', code: 'not_paired' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Fetch the paired plan
      const { data: plan2, error: error2 } = await supabaseClient
        .from('z_alignment_plans')
        .select('id, parent_name, coparent_name, children, custody_arrangement, responses')
        .eq('id', plan1.paired_with)
        .single()

      if (error2 || !plan2) {
        return new Response(
          JSON.stringify({ error: 'Paired plan not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Generate comparison
      const comparison = generateComparison(plan1.responses, plan2.responses)

      return new Response(
        JSON.stringify({
          plan1: {
            parent_name: plan1.parent_name,
            responses: plan1.responses
          },
          plan2: {
            parent_name: plan2.parent_name,
            responses: plan2.responses
          },
          children: plan1.children || plan2.children,
          comparison
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Token or code parameter required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Alignment view error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

interface Comparison {
  aligned: string[]
  close: string[]
  divergent: string[]
}

function generateComparison(responses1: Record<string, unknown>, responses2: Record<string, unknown>): Comparison {
  const comparison: Comparison = {
    aligned: [],
    close: [],
    divergent: []
  }

  const allKeys = new Set([...Object.keys(responses1), ...Object.keys(responses2)])

  for (const key of allKeys) {
    const val1 = responses1[key]
    const val2 = responses2[key]

    // Skip if either didn't answer
    if (val1 === undefined || val2 === undefined) continue

    // For single-select questions (string values)
    if (typeof val1 === 'string' && typeof val2 === 'string') {
      if (val1 === val2) {
        comparison.aligned.push(key)
      } else {
        comparison.divergent.push(key)
      }
      continue
    }

    // For multi-select questions (array values)
    if (Array.isArray(val1) && Array.isArray(val2)) {
      const set1 = new Set(val1)
      const set2 = new Set(val2)
      const intersection = [...set1].filter(x => set2.has(x))
      const overlapRatio = intersection.length / Math.max(set1.size, set2.size)

      if (overlapRatio >= 0.8) {
        comparison.aligned.push(key)
      } else if (overlapRatio >= 0.4) {
        comparison.close.push(key)
      } else {
        comparison.divergent.push(key)
      }
      continue
    }

    // For matrix/object responses
    if (typeof val1 === 'object' && typeof val2 === 'object') {
      // Compare each sub-key
      const subKeys = new Set([...Object.keys(val1 as object), ...Object.keys(val2 as object)])
      let matches = 0
      let total = 0

      for (const subKey of subKeys) {
        const subVal1 = (val1 as Record<string, unknown>)[subKey]
        const subVal2 = (val2 as Record<string, unknown>)[subKey]
        if (subVal1 !== undefined && subVal2 !== undefined) {
          total++
          if (subVal1 === subVal2) matches++
        }
      }

      const matchRatio = total > 0 ? matches / total : 0
      if (matchRatio >= 0.8) {
        comparison.aligned.push(key)
      } else if (matchRatio >= 0.5) {
        comparison.close.push(key)
      } else {
        comparison.divergent.push(key)
      }
      continue
    }

    // Default: treat as divergent if different types
    comparison.divergent.push(key)
  }

  return comparison
}
