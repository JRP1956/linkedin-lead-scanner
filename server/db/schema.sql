CREATE TABLE IF NOT EXISTS scanned_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_url TEXT UNIQUE NOT NULL,
  scanned_at TEXT NOT NULL,
  commenter_count INTEGER,
  enriched_count INTEGER
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_url TEXT NOT NULL,
  linkedin_url TEXT UNIQUE NOT NULL,
  name TEXT,
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  company TEXT,
  company_domain TEXT,
  email TEXT,
  headcount_range TEXT,
  estimated_revenue TEXT,
  industry TEXT,
  funding_stage TEXT,
  comment_text TEXT,
  comment_date TEXT,
  intent_tier TEXT,
  intent_score INTEGER,
  intent_reasoning TEXT,
  intent_signals TEXT,
  icp_score INTEGER,
  total_score INTEGER,
  data_confidence TEXT,
  outreach_draft_direct TEXT,
  outreach_draft_topic TEXT,
  outreach_draft_pain TEXT,
  outreach_draft_campaign TEXT,
  hubspot_contact_id TEXT,
  hubspot_pushed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monitored_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  linkedin_profile_url TEXT UNIQUE NOT NULL,
  label TEXT,
  check_frequency_hours INTEGER DEFAULT 6,
  last_checked_at TEXT,
  last_post_id TEXT,
  active INTEGER DEFAULT 1
);

-- Feature 1: Suppress / Blacklist List
CREATE TABLE IF NOT EXISTS suppression_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  linkedin_url TEXT UNIQUE NOT NULL,
  name TEXT,
  reason TEXT NOT NULL DEFAULT 'manual_exclude',
  source TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Feature 2: Lead Status History
CREATE TABLE IF NOT EXISTS lead_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

-- Feature 3: Cross-Scan Signal Stacking
CREATE TABLE IF NOT EXISTS lead_appearances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  linkedin_url TEXT NOT NULL,
  post_url TEXT NOT NULL,
  comment_text TEXT,
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(linkedin_url, post_url)
);
