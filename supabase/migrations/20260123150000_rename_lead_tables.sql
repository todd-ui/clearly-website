-- Rename tables to group them together in Supabase table editor (alphabetical)
-- This makes waitlist, assessment_leads, and professionals appear together

-- Rename assessment_leads to z_assessment_leads
ALTER TABLE IF EXISTS public.assessment_leads RENAME TO z_assessment_leads;

-- Rename waitlist to z_waitlist
ALTER TABLE IF EXISTS public.waitlist RENAME TO z_waitlist;

-- Rename professionals to z_professionals
ALTER TABLE IF EXISTS public.professionals RENAME TO z_professionals;

-- Update comments
COMMENT ON TABLE public.z_assessment_leads IS 'Stores leads from the co-parenting relationship patterns assessment';
COMMENT ON TABLE public.z_waitlist IS 'Stores waitlist signups for Clearly beta access';
COMMENT ON TABLE public.z_professionals IS 'Stores professional interest signups';
