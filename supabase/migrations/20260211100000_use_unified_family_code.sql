-- Migrate from alignment_plan_code to unified family_code
-- This allows the alignment tool to share the same family code as plan-builder and the app

-- Rename the column
ALTER TABLE public.z_alignment_plans
RENAME COLUMN alignment_plan_code TO family_code;

-- Update the index
DROP INDEX IF EXISTS idx_alignment_plans_pairing_code;
CREATE INDEX IF NOT EXISTS idx_alignment_plans_family_code ON public.z_alignment_plans(family_code);

-- Add comment explaining the unified code system
COMMENT ON COLUMN public.z_alignment_plans.family_code IS 'Unified family code shared with plan_templates.share_code and families.join_code';
