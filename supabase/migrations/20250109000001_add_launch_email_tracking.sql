-- Add launch email tracking columns to waitlist table
ALTER TABLE waitlist
ADD COLUMN IF NOT EXISTS launch_email_sent BOOLEAN DEFAULT NULL,
ADD COLUMN IF NOT EXISTS launch_email_sent_at TIMESTAMPTZ DEFAULT NULL;

-- Add index for querying unsent launch emails
CREATE INDEX IF NOT EXISTS idx_waitlist_launch_email_sent ON waitlist(launch_email_sent) WHERE launch_email_sent IS NULL;
