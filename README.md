# LinkedIn Lead Scanner

An AI-powered lead generation pipeline that scrapes LinkedIn post commenters, enriches their profiles via Apollo, scores them against your Ideal Customer Profile (ICP) using Claude AI, generates personalized outreach drafts, and pushes qualified leads to HubSpot and Apollo Sequences — all from a single URL.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [ICP Configuration](#icp-configuration)
  - [Campaigns](#campaigns)
- [Features](#features)
  - [Scan Pipeline](#scan-pipeline)
  - [Suppression / Blacklist](#suppression--blacklist)
  - [Lead Status Tracking](#lead-status-tracking)
  - [Cross-Scan Signal Stacking](#cross-scan-signal-stacking)
  - [Outreach Drafts](#outreach-drafts)
  - [HubSpot Integration](#hubspot-integration)
  - [Apollo Sequences](#apollo-sequences)
  - [Automated Monitoring](#automated-monitoring)
  - [Slack Notifications](#slack-notifications)
- [API Reference](#api-reference)
- [Frontend Pages](#frontend-pages)
- [Database Schema](#database-schema)
- [Tech Stack](#tech-stack)

---

## How It Works

```
LinkedIn Post URL
       │
       ▼
┌──────────────┐
│   Scrape     │  Playwright (stealth mode) extracts all commenters
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Suppress    │  Filter out blacklisted/already-contacted leads
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Enrich     │  Apollo API fills in title, company, email, revenue, industry
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ ICP Score    │  YAML-driven scoring: title match, company size, revenue, industry
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Classify    │  Claude AI analyzes comment text → intent tier (T1–T5) + score
└──────┬───────┘
       │
       ▼
┌──────────────┐
│    Rank      │  Total Score = Intent + ICP + Appearance Bonus (capped at 100)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Draft      │  Claude AI generates personalized outreach messages
└──────┬───────┘
       │
       ▼
┌──────────────┐
│    Save      │  SQLite — leads, appearances, status history
└──────┬───────┘
       │
       ▼
  Push to HubSpot / Apollo Sequence
```

---

## Architecture

This is a **monorepo** with two workspaces:

| Workspace | Port | Description |
|-----------|------|-------------|
| `server/` | 3001 | Express.js API server + pipeline engine |
| `web/`    | 5173 | React + Vite frontend dashboard |

The frontend proxies all `/api/*` requests to the backend via Vite's dev server proxy. In production, the Vite build output is served as static files.

---

## Project Structure

```
linkedin-lead-scanner/
├── package.json              # Monorepo root (workspaces: server, web)
├── .env                      # Environment variables (keys, tokens)
├── .env.example              # Template for required env vars
│
├── config/
│   ├── icp.yaml              # Ideal Customer Profile — scoring rules
│   └── campaigns/
│       └── example-campaign.md  # Campaign context for outreach drafts
│
├── prompts/
│   ├── intent-classification.md   # Claude prompt for comment intent scoring
│   └── outreach-drafts.md         # Claude prompt for outreach draft generation
│
├── server/
│   ├── index.js              # Express app — all API routes
│   ├── package.json
│   │
│   ├── db/
│   │   ├── schema.sql             # SQLite table definitions
│   │   ├── queries.js             # Core CRUD + migrations
│   │   ├── suppressionQueries.js  # Suppression list operations
│   │   ├── statusQueries.js       # Lead status + history tracking
│   │   └── signalQueries.js       # Cross-scan appearance tracking
│   │
│   ├── scrapers/
│   │   └── linkedinScraper.js     # Playwright-based comment scraper
│   │
│   ├── enrichment/
│   │   └── apolloClient.js        # Apollo People Enrichment API
│   │
│   ├── scoring/
│   │   ├── icpScorer.js           # YAML-driven ICP scoring (title, company, revenue)
│   │   ├── intentClassifier.js    # Claude-powered comment intent analysis
│   │   └── ranker.js              # Score combiner + appearance bonus
│   │
│   ├── outreach/
│   │   └── draftGenerator.js      # Claude-powered outreach draft generation
│   │
│   ├── integrations/
│   │   ├── hubspotClient.js       # HubSpot CRM push (create/update contacts)
│   │   ├── apolloSequencer.js     # Apollo Sequences email automation
│   │   └── slackNotifier.js       # Slack webhook notifications
│   │
│   ├── jobs/
│   │   ├── scanJob.js             # Full scan pipeline orchestrator
│   │   └── monitorJob.js          # Cron job for monitoring accounts
│   │
│   └── data/                      # SQLite database file (auto-created)
│       └── leads.db
│
└── web/
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    │
    └── src/
        ├── main.jsx
        ├── App.jsx                # Router + navigation
        ├── index.css
        │
        ├── api/
        │   └── client.js          # All API fetch functions
        │
        ├── pages/
        │   ├── ScanPage.jsx       # Start a new scan (post URL input)
        │   ├── ResultsPage.jsx    # Lead table with filters + batch actions
        │   ├── LeadDetailPage.jsx # Full lead profile + drafts + integrations
        │   ├── MonitorPage.jsx    # Manage monitored LinkedIn accounts
        │   └── SuppressionPage.jsx # Manage blacklist / suppression list
        │
        └── components/
            ├── LeadTable.jsx          # Sortable table with inline status + signals
            ├── DraftEditor.jsx        # Editable outreach draft tabs
            ├── ScoreBadge.jsx         # Color-coded score display
            ├── IntentTierBadge.jsx    # Intent tier badge (T1–T5)
            ├── DataConfidencePill.jsx # Data quality indicator
            └── StatusBadge.jsx        # Pipeline status badge
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- API keys (see [Environment Variables](#environment-variables))

### Installation

```bash
# Clone the repo
git clone https://github.com/your-org/linkedin-lead-scanner.git
cd linkedin-lead-scanner

# Install all dependencies (root + both workspaces)
npm install

# Install Playwright browser (required for scraping)
npx playwright install chromium

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your API keys
```

### Running

```bash
# Start both server and frontend (development)
npm run dev

# Server only
npm run dev --workspace=server

# Frontend only
npm run dev --workspace=web
```

The app will be available at:
- **Frontend:** http://localhost:5173
- **API Server:** http://localhost:3001

### Production Build

```bash
# Build the frontend
npm run build

# Start the production server
npm start
```

---

## Configuration

### Environment Variables

Create a `.env` file in the project root:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✅ | Claude API key for intent classification and outreach draft generation |
| `APOLLO_API_KEY` | ✅ | Apollo.io API key for lead enrichment and email sequences |
| `HUBSPOT_ACCESS_TOKEN` | ⬡ | HubSpot private app token for CRM push |
| `SLACK_WEBHOOK_URL` | ⬡ | Slack incoming webhook URL for scan notifications |
| `PORT` | ⬡ | Server port (default: `3001`) |
| `DB_PATH` | ⬡ | SQLite database path (default: `./data/leads.db`) |
| `MONITOR_CRON_SCHEDULE` | ⬡ | Cron expression for monitor job (default: `0 */6 * * *`) |
| `BROWSER_PROFILE_PATH` | ⬡ | Playwright browser profile path for persistent sessions |

> ⬡ = Optional — features that depend on these will gracefully degrade if not set.

### ICP Configuration

The file `config/icp.yaml` controls how leads are scored. **No code changes needed** — just edit the YAML:

```yaml
# Target titles (exact match = highest score)
titles:
  exact_match:
    - "VP of Marketing"
    - "Head of Growth"
    - "CTO"
  keyword_match:       # Partial keyword matching in title
    - "marketing"
    - "growth"
  seniority_keywords:  # Combined with department for bonus scoring
    - "VP"
    - "Head"
    - "Director"
  exclude_keywords:    # Automatically filter out
    - "intern"
    - "recruiter"

# Target industries
industries:
  include: ["SaaS", "Fintech", "B2B Software"]
  exclude: ["Agency", "Staffing"]

# Company size and revenue filters
company_size:
  min_headcount: 50
  max_headcount: 10000

revenue:
  min_annual_revenue_usd: 6000000

# Scoring weights (must total 100)
scoring_weights:
  comment_intent: 45   # Claude-analyzed comment quality
  title_match: 25      # ICP title fit
  company_fit: 20      # Industry, size, revenue
  profile_completeness: 10
```

### Campaigns

Create campaign files in `config/campaigns/` as Markdown files. These provide context to Claude when generating outreach drafts:

```markdown
# Campaign: Product Launch Q1

## Context
We're launching our new analytics platform and targeting marketing leaders...

## Value Proposition
- 3x faster reporting
- One-click dashboard setup

## Tone
Professional but conversational. Reference their LinkedIn comment naturally.
```

---

## Features

### Scan Pipeline

Paste a LinkedIn post URL → the system scrapes all commenters, enriches via Apollo, scores against your ICP, classifies intent with Claude AI, ranks, and generates personalized outreach drafts. The entire pipeline runs as a server-sent events (SSE) stream so you see progress in real time.

**Scoring formula:**
```
Total Score = Intent Score (0-45) + ICP Score (0-55) + Appearance Bonus (0-20)
```
Capped at 100.

### Suppression / Blacklist

Prevents duplicate outreach:

- **Manual:** Add LinkedIn URLs individually or bulk-import via CSV
- **Automatic:** Leads pushed to HubSpot or Apollo Sequences are auto-added
- **Pipeline integration:** Suppressed leads are filtered out *before* enrichment, saving Apollo API credits
- **Reasons tracked:** `manual_exclude`, `in_pipeline`, `already_contacted`

### Lead Status Tracking

Full pipeline lifecycle management:

| Status | Meaning |
|--------|---------|
| `new` | Just scraped, not yet contacted |
| `contacted` | Outreach sent |
| `replied` | Got a response |
| `meeting_booked` | Meeting scheduled |
| `converted` | Closed deal |
| `dead` | Not interested / unresponsive |

- Inline status dropdown in the lead table
- Full status history timeline on lead detail page
- Conversion funnel stats via `/api/stats/funnel`
- Filter leads by status in the results view

### Cross-Scan Signal Stacking

If someone comments on multiple competitor posts, that's a stronger signal:

- Every appearance across different posts is tracked in `lead_appearances`
- **Score boost:** +5 per additional appearance (capped at +20 bonus)
- 🔥 badge in the lead table for multi-signal leads
- Appearance history shown on lead detail page
- Dedicated multi-signal leads endpoint (`/api/leads/multi-signal`)

### Outreach Drafts

Claude AI generates 4 personalized outreach drafts per lead:

| Mode | Description |
|------|-------------|
| `direct` | Straightforward intro referencing their comment |
| `topic` | Starts with the topic they commented about |
| `pain` | Leads with a pain point based on their industry |
| `campaign` | Uses your campaign context file |

Drafts are editable in-app via a tabbed editor.

### HubSpot Integration

Push qualified leads to HubSpot CRM:

- Single lead push or batch push
- Creates/updates contacts with all enriched data
- Automatically adds to suppression list on push
- Custom properties: `lead_score`, `intent_tier`, `source_post_url`, `comment_text`, `outreach_draft`, `data_confidence`

> Before first push, create the custom properties in HubSpot → Settings → Properties.

### Apollo Sequences

Automate email outreach by pushing leads directly into Apollo email sequences:

- List available sequences from your Apollo account
- Push individual leads or batch-push selected leads
- Tracks which sequence each lead was added to
- Auto-adds to suppression list on push

### Automated Monitoring

Set up LinkedIn accounts to monitor automatically:

- Add LinkedIn profile URLs to watch
- Configurable check frequency (default: every 6 hours via cron)
- When new posts are detected, auto-scans commenters
- Toggle accounts active/inactive

### Slack Notifications

Optional Slack webhook for scan completion alerts. Set `SLACK_WEBHOOK_URL` in `.env`.

---

## API Reference

### Scanning

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/scan` | Start a new scan (SSE stream) |

### Leads

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/leads?postUrl=...&status=...&sortBy=...` | Get leads for a post |
| `GET` | `/api/leads/multi-signal?min=2` | Get repeat engagers |
| `GET` | `/api/leads/export-csv?postUrl=...` | Download leads as CSV |
| `GET` | `/api/leads/:id` | Get single lead |
| `PATCH` | `/api/leads/:id/draft` | Update outreach draft |
| `PATCH` | `/api/leads/:id/status` | Update pipeline status |
| `GET` | `/api/leads/:id/history` | Get status change history |
| `GET` | `/api/leads/:id/appearances` | Get appearance history |
| `POST` | `/api/leads/:id/push-hubspot` | Push to HubSpot |
| `POST` | `/api/leads/:id/push-apollo` | Push to Apollo Sequence |
| `POST` | `/api/leads/push-hubspot-batch` | Batch push to HubSpot |
| `POST` | `/api/leads/push-apollo-batch` | Batch push to Apollo |
| `POST` | `/api/leads/batch-status` | Batch status update |

### Suppression List

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/suppression` | List all (filter: `?reason=...&search=...`) |
| `GET` | `/api/suppression/count` | Get total count |
| `POST` | `/api/suppression` | Add single entry |
| `POST` | `/api/suppression/bulk` | Bulk import |
| `DELETE` | `/api/suppression/:id` | Remove entry |

### Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/monitor` | List monitored accounts |
| `POST` | `/api/monitor` | Add account to monitor |
| `DELETE` | `/api/monitor/:id` | Remove account |
| `PATCH` | `/api/monitor/:id/toggle` | Toggle active/inactive |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats/funnel` | Conversion funnel stats |
| `GET` | `/api/icp-profiles` | Available ICP profile names |
| `GET` | `/api/campaigns` | Available campaign names |
| `GET` | `/api/apollo/sequences` | List Apollo email sequences |
| `GET` | `/api/scanned-posts` | All previously scanned posts |

---

## Frontend Pages

| Page | Path | Description |
|------|------|-------------|
| **Scan** | `/` | Enter a LinkedIn post URL, select outreach mode and ICP profile, start scan with live progress |
| **Results** | `/results?postUrl=...` | Sortable lead table with filters (score, intent tier, confidence, status), batch actions (HubSpot push, CSV export) |
| **Lead Detail** | `/leads/:id` | Full profile, comment, intent analysis, editable outreach drafts, HubSpot push, Apollo Sequence push, status history, appearance history |
| **Monitor** | `/monitor` | Add/remove LinkedIn accounts for automatic monitoring |
| **Suppress** | `/suppress` | Manage blacklist — add, bulk import (CSV), search, filter by reason, remove |

---

## Database Schema

SQLite with 6 tables:

| Table | Purpose |
|-------|---------|
| `leads` | All scraped/enriched leads with scores, drafts, and metadata (34 columns) |
| `scanned_posts` | Record of all scanned LinkedIn post URLs |
| `monitored_accounts` | LinkedIn profiles being automatically monitored |
| `suppression_list` | Blacklisted LinkedIn URLs to skip during scans |
| `lead_status_history` | Audit trail of every status change |
| `lead_appearances` | Cross-scan tracking (which leads appeared on which posts) |

The database auto-creates on first run and runs safe ALTER TABLE migrations for schema updates.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 18+ |
| **Backend** | Express.js |
| **Database** | SQLite via `better-sqlite3` |
| **Scraping** | Playwright + stealth plugin |
| **AI** | Anthropic Claude (intent classification, outreach drafts) |
| **Enrichment** | Apollo.io People API |
| **CRM** | HubSpot Contacts API |
| **Email Automation** | Apollo Sequences API |
| **Notifications** | Slack Webhooks |
| **Frontend** | React 18 + React Router |
| **Build Tool** | Vite |
| **Styling** | Tailwind CSS |
| **Monorepo** | npm workspaces + concurrently |

---

## License

Private — not open source.
