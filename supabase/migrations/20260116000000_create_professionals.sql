-- Create professionals table for professional email signups
CREATE TABLE IF NOT EXISTS professionals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  profession_type TEXT,
  organization TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  welcome_email_sent BOOLEAN DEFAULT FALSE,
  welcome_email_sent_at TIMESTAMPTZ
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_professionals_email ON professionals(email);
CREATE INDEX IF NOT EXISTS idx_professionals_created_at ON professionals(created_at DESC);

-- Enable Row Level Security
ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;

-- Create policy to allow inserts from edge functions (service role)
CREATE POLICY "Allow service role full access" ON professionals
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Comment on table
COMMENT ON TABLE professionals IS 'Email list for legal and family professionals interested in Clearly launch';
