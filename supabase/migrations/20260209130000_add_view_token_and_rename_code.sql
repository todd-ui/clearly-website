-- Add view_token for secure plan viewing links
ALTER TABLE public.z_alignment_plans
ADD COLUMN IF NOT EXISTS view_token TEXT UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '');

-- Rename pairing_code to alignment_plan_code for clarity
ALTER TABLE public.z_alignment_plans
RENAME COLUMN pairing_code TO alignment_plan_code;

-- Update index name
DROP INDEX IF EXISTS idx_alignment_plans_pairing_code;
CREATE INDEX IF NOT EXISTS idx_alignment_plans_code ON public.z_alignment_plans(alignment_plan_code);

-- Add index for view_token lookups
CREATE INDEX IF NOT EXISTS idx_alignment_plans_view_token ON public.z_alignment_plans(view_token);

-- Grant select permission for viewing plans (needed for anon to view via token)
GRANT SELECT ON public.z_alignment_plans TO anon;
