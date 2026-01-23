-- Create assessment_leads table for communication style assessment
CREATE TABLE IF NOT EXISTS public.assessment_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  style_result TEXT NOT NULL CHECK (style_result IN ('defender', 'fixer', 'avoider', 'scorekeeper')),
  secondary_style TEXT CHECK (secondary_style IS NULL OR secondary_style IN ('defender', 'fixer', 'avoider', 'scorekeeper')),
  answers JSONB DEFAULT '[]'::jsonb,
  source TEXT DEFAULT 'assessment',
  email_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Unique constraint on email
  CONSTRAINT assessment_leads_email_unique UNIQUE (email)
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_assessment_leads_email ON public.assessment_leads(email);

-- Create index on style_result for analytics
CREATE INDEX IF NOT EXISTS idx_assessment_leads_style ON public.assessment_leads(style_result);

-- Create index on created_at for time-based queries
CREATE INDEX IF NOT EXISTS idx_assessment_leads_created ON public.assessment_leads(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.assessment_leads ENABLE ROW LEVEL SECURITY;

-- Policy: Allow inserts from anyone (for the assessment form)
CREATE POLICY "Allow public inserts" ON public.assessment_leads
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Policy: Only service role can read/update
CREATE POLICY "Service role full access" ON public.assessment_leads
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE public.assessment_leads IS 'Stores leads from the co-parenting communication style assessment';
