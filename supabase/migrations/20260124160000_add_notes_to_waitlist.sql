-- Add notes column to z_waitlist table for storing user's optional notes
ALTER TABLE public.z_waitlist
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.z_waitlist.notes IS 'Optional notes/context provided by user during signup';
