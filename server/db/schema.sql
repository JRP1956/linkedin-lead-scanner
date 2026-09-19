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
  active INTEGER DEFAULT 1,
  monitor_type TEXT NOT NULL DEFAULT 'own'
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

-- ─── Phase 1: Campaigns ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  icp_profile_id INTEGER,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (icp_profile_id) REFERENCES icp_profiles(id)
);

CREATE TABLE IF NOT EXISTS campaign_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT 'Control',
  message_template TEXT,
  is_control INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS campaign_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  variant_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  replied_at TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (variant_id) REFERENCES campaign_variants(id),
  UNIQUE(campaign_id, lead_id)
);

CREATE TABLE IF NOT EXISTS campaign_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  variant_id INTEGER,
  sent INTEGER DEFAULT 0,
  replied INTEGER DEFAULT 0,
  meetings INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES campaign_variants(id)
);

-- ─── Phase 1: ICP Profiles (DB-backed) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS icp_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Phase 2: Signal Detection ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS detected_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  lead_id INTEGER,
  linkedin_url TEXT,
  company_domain TEXT,
  data_json TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed INTEGER DEFAULT 0,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE IF NOT EXISTS company_headcount_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_domain TEXT NOT NULL,
  company_name TEXT,
  headcount INTEGER,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Phase 3: Follow-up Sequences ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sequence_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  step_number INTEGER NOT NULL,
  delay_days INTEGER NOT NULL DEFAULT 3,
  message_template TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  UNIQUE(campaign_id, step_number)
);

CREATE TABLE IF NOT EXISTS sequence_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_lead_id INTEGER NOT NULL,
  step_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_at TEXT,
  sent_at TEXT,
  message_content TEXT,
  FOREIGN KEY (campaign_lead_id) REFERENCES campaign_leads(id) ON DELETE CASCADE
);

-- ─── Phase 5: Organizations & Users ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  org_id INTEGER,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES organizations(id)
);

-- One row per billable or rate-limited action: scan, claude, apollo
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  post_url TEXT,
  units INTEGER NOT NULL DEFAULT 1,
  cost_usd REAL NOT NULL DEFAULT 0,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usage_events_kind_created ON usage_events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_post_url ON usage_events(post_url);
