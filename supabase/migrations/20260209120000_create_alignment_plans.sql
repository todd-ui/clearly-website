-- Create alignment_plans table for co-parenting alignment tool
CREATE TABLE IF NOT EXISTS public.z_alignment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  pairing_code TEXT UNIQUE DEFAULT upper(substring(md5(random()::text), 1, 8)),
  parent_name TEXT,
  coparent_name TEXT,
  children JSONB DEFAULT '[]'::jsonb,
  custody_arrangement TEXT,
  responses JSONB DEFAULT '{}'::jsonb,
  results JSONB DEFAULT '{}'::jsonb,
  paired_with UUID REFERENCES public.z_alignment_plans(id),
  comparison_results JSONB,
  age_variant TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  email_sent BOOLEAN DEFAULT FALSE,
  pdf_generated BOOLEAN DEFAULT FALSE,
  source TEXT DEFAULT 'alignment-tool',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Unique constraint on email
  CONSTRAINT z_alignment_plans_email_unique UNIQUE (email)
);

-- Create index on pairing_code for partner matching
CREATE INDEX IF NOT EXISTS idx_alignment_plans_pairing_code ON public.z_alignment_plans(pairing_code);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_alignment_plans_email ON public.z_alignment_plans(email);

-- Create index on created_at for time-based queries
CREATE INDEX IF NOT EXISTS idx_alignment_plans_created ON public.z_alignment_plans(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.z_alignment_plans ENABLE ROW LEVEL SECURITY;

-- Policy: Allow inserts from anyone (for the alignment form)
CREATE POLICY "Allow public inserts" ON public.z_alignment_plans
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Policy: Only service role can read/update
CREATE POLICY "Service role full access" ON public.z_alignment_plans
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE public.z_alignment_plans IS 'Stores alignment plan submissions from the co-parenting alignment tool';
