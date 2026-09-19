# LinkedIn Lead Scanner

An AI-powered, multi-channel lead generation platform that scrapes LinkedIn post engagers, enriches profiles via Apollo, scores leads against your Ideal Customer Profile using Claude AI, detects buying signals (job changes, funding rounds, hiring spikes), runs multi-step outreach sequences, and syncs qualified leads to HubSpot and Apollo — all from a single dashboard.

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
  - [Core Scan Pipeline](#core-scan-pipeline)
  - [Campaign Management](#campaign-management)
  - [Signal Detection Engine](#signal-detection-engine)
  - [Multi-Step Outreach Sequences](#multi-step-outreach-sequences)
  - [Analytics & Reporting](#analytics--reporting)
  - [Pipeline Board (Kanban)](#pipeline-board-kanban)
  - [AI Tools](#ai-tools)
  - [CRM Integrations](#crm-integrations)
  - [Suppression / Blacklist](#suppression--blacklist)
  - [Cross-Scan Signal Stacking](#cross-scan-signal-stacking)
  - [Automated Monitoring](#automated-monitoring)
  - [Authentication & Multi-Team](#authentication--multi-team)
- [API Reference](#api-reference)
- [Frontend Pages](#frontend-pages)
- [Database Schema](#database-schema)
- [Prompt Templates](#prompt-templates)
- [Tech Stack](#tech-stack)

---

## How It Works

```
                           LinkedIn Post URL
                                  │
                                  ▼
                       ┌──────────────────┐
                       │    Scrape        │  Playwright (stealth mode) extracts all commenters
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │   Suppress       │  Filter out blacklisted / already-contacted leads
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │    Enrich        │  Apollo API → title, company, email, revenue, industry, phone
                                │
                                ▼
                       ┌──────────────────┐
                       │  ICP Score       │  YAML or DB-backed scoring: title, company size, revenue, industry
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │   Classify       │  Claude AI analyzes comment text → intent tier (T1–T5) + score
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │     Rank         │  Total Score = Intent + ICP + Appearance Bonus (capped at 100)
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │    Draft         │  Claude AI generates personalized outreach messages
                       └────────┬─────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │     Save         │  SQLite — leads, appearances, status history, signals
                       └────────┬─────────┘
                                │
                  ┌─────────────┴─────────────┐
                  ▼                           ▼
             ┌─────────┐              ┌────────────┐
             │ HubSpot │              │   Apollo   │
             └─────────┘              │ Sequences  │
                                      └────────────┘
```

### Background Signal Detection (runs on cron)

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Job Change   │  │   Funding    │  │   Hiring     │
│  Detector    │  │  Detector    │  │   Spikes     │
│  (Apollo)    │  │ (Crunchbase/ │  │  (Apollo)    │
│              │  │  Google News)│  │              │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └─────────────────┼─────────────────┘
                         ▼
                ┌────────────────┐
                │ Signal Engine  │ → detected_signals table
                └────────────────┘
```

---

## Architecture

This is a **monorepo** with two workspaces:

| Workspace | Port | Description |
|-----------|------|-------------|
| `server/` | 3001 | Express.js API server + pipeline engine + cron jobs |
| `web/`    | 5173 | React + Vite frontend dashboard |

The frontend proxies all `/api/*` requests to the backend via Vite's dev server proxy. In production, the Vite build output is served as static files.

### Design Principles

- **Graceful degradation** — Every external API integration (Crunchbase, Slack, HubSpot) silently skips when its API key is not set. The core pipeline always works.
- **Database-first** — All state lives in SQLite. No external databases required.
- **Single-user fallback** — Auth is optional. When `JWT_SECRET` is not set, the app runs in single-user mode with no login required.

---

## Project Structure

```
linkedin-lead-scanner/
├── package.json               # Monorepo root (workspaces: server, web)
├── .env                       # Environment variables (API keys, tokens)
├── .env.example               # Template for all env vars
│
├── config/
│   ├── icp.yaml               # Ideal Customer Profile — scoring rules
│   └── campaigns/
│       └── example-campaign.md   # Campaign context for outreach drafts
│
├── prompts/                    # Claude AI prompt templates
│   ├── intent-classification.md  # Comment → intent tier scoring
│   ├── outreach-drafts.md        # Personalized outreach generation
│   ├── icp-generator.md          # AI-powered ICP generation
│   ├── follow-up-sequence.md     # Multi-step follow-up messages
│   ├── message-analyzer.md       # Outreach message scoring
│   └── content-generator.md      # LinkedIn post generation
│
├── server/
│   ├── index.js               # Express app setup — env checks, auth gate, mounts routes
│   ├── package.json
│   │
│   ├── routes/                     # API routes, grouped by area
│   │   ├── scan.js                 # POST /api/scan (SSE progress stream)
│   │   ├── leads.js                # Lead list/detail, drafts, status, CSV export
│   │   ├── crm.js                  # HubSpot, Apollo sequences
│   │   ├── campaigns.js            # Campaigns, variants, sequences
│   │   ├── settings.js             # Monitor, ICP generation, suppression
│   │   └── insights.js             # Analytics, AI tools, usage & cost
│   │
│   ├── test/                       # node:test suites (npm test)
│   │
│   ├── db/                         # Database layer
│   │   ├── schema.sql              # SQLite table definitions (20 tables)
│   │   ├── queries.js              # Core CRUD + migrations
│   │   ├── campaignQueries.js      # Campaign + variant + lead assignment CRUD
│   │   ├── icpQueries.js           # DB-backed ICP profile CRUD
│   │   ├── analyticsQueries.js     # Dashboard, funnel, reply rate analytics
│   │   ├── signalDetectionQueries.js # Signal + headcount storage
│   │   ├── suppressionQueries.js   # Suppression list operations
│   │   ├── statusQueries.js        # Lead status + history tracking
│   │   └── signalQueries.js        # Cross-scan appearance tracking
│   │
│   ├── scrapers/
│   │   └── linkedinScraper.js      # Playwright-based comment scraper
│   │
│   ├── enrichment/
│   │   ├── apolloClient.js         # Apollo People API (email, phone, company)
│   │
│   ├── scoring/
│   │   ├── icpScorer.js            # YAML + DB-backed ICP scoring
│   │   ├── intentClassifier.js     # Claude-powered comment intent analysis
│   │   └── ranker.js               # Score combiner + appearance bonus
│   │
│   ├── signals/                    # Signal detection engine
│   │   ├── signalEngine.js         # Central orchestrator
│   │   ├── jobChangeDetector.js    # Title/company change detection (Apollo)
│   │   ├── fundingDetector.js      # Funding round detection (Crunchbase/News)
│   │   └── hiringDetector.js       # Headcount growth detection (Apollo)
│   │
│   ├── outreach/
│   │   ├── draftGenerator.js       # Claude-powered outreach draft generation
│   │   └── sequenceEngine.js       # Multi-step follow-up sequences
│   │
│   ├── ai/
│   │   ├── icpGenerator.js         # Claude-powered ICP generation
│   │   ├── messageAnalyzer.js      # Outreach message quality scoring
│   │   └── contentGenerator.js     # LinkedIn post content generation
│   │
│   ├── integrations/
│   │   ├── hubspotClient.js        # HubSpot CRM (create/update contacts)
│   │   ├── apolloSequencer.js      # Apollo email sequence automation
│   │   └── slackNotifier.js        # Slack webhook notifications
│   │
│   ├── auth/
│   │   ├── authMiddleware.js       # JWT auth + role-based access + org scoping
│   │   └── authRoutes.js           # Signup / login / me endpoints
│   │
│   ├── import/
│   │
│   ├── jobs/
│   │   ├── scanJob.js              # Full scan pipeline orchestrator
│   │   └── monitorJob.js           # Cron: account monitoring + signal detection
│   │
│   └── data/
│       └── leads.db                # SQLite database (auto-created)
│
└── web/
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    │
    └── src/
        ├── main.jsx
        ├── App.jsx                 # Router + navigation (9 tabs)
        ├── index.css
        │
        ├── api/
        │   └── client.js           # All API fetch functions (~400 LOC)
        │
        ├── pages/
        │   ├── DashboardPage.jsx   # Summary cards + pipeline funnel + campaign table
        │   ├── ScanPage.jsx        # Start a new scan (post URL input)
        │   ├── ResultsPage.jsx     # Lead table with filters + batch actions
        │   ├── LeadDetailPage.jsx  # Full lead profile + drafts + integrations
        │   ├── CampaignPage.jsx    # Campaign CRUD + variants + metrics
        │   ├── PipelinePage.jsx    # Kanban drag-and-drop lead board
        │   ├── MonitorPage.jsx     # Manage monitored LinkedIn accounts
        │   ├── AnalyticsPage.jsx   # 4-tab analytics dashboard
        │   ├── ToolsPage.jsx       # AI tools: ICP gen, message analyzer, content gen
        │   └── SuppressionPage.jsx # Manage blacklist / suppression list
        │
        └── components/
            ├── LeadTable.jsx           # Sortable table with inline status + signals
            ├── DraftEditor.jsx         # Editable outreach draft tabs
            ├── ScoreBadge.jsx          # Color-coded score display
            ├── IntentTierBadge.jsx     # Intent tier badge (T1–T5)
            ├── DataConfidencePill.jsx  # Data quality indicator
            └── StatusBadge.jsx         # Pipeline status badge
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20.12
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

# Tests (scoring, usage caps, auth)
npm test
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

Create a `.env` file in the project root. Variables marked **Optional** will cause their associated features to silently skip when not set — the core pipeline always works.

| Variable | Required | Description |
|----------|----------|-------------|
| **Core** | | |
| `ANTHROPIC_API_KEY` | ✅ | Claude API key for intent classification, outreach drafts, and AI tools |
| `APOLLO_API_KEY` | ✅ | Apollo.io API key for lead enrichment, phone lookup, and sequences |
| `HUBSPOT_ACCESS_TOKEN` | Optional | HubSpot private app token for CRM push |
| `PORT` | Optional | Server port (default: `3001`) |
| `DB_PATH` | Optional | SQLite database path (default: `./data/leads.db`) |
| **Scraping & Monitoring** | | |
| `BROWSER_PROFILE_PATH` | Optional | Playwright browser profile for persistent LinkedIn sessions |
| `MONITOR_CRON_SCHEDULE` | Optional | Cron expression for monitor job (default: `0 */6 * * *`) |
| **Signal Detection** | | |
| `CRUNCHBASE_API_KEY` | Optional | Funding round detection. Falls back to Google News RSS when not set |
| **Email Outreach** | | |
| **CRM & Notifications** | | |
| `SLACK_WEBHOOK_URL` | Optional | Slack incoming webhook for scan notifications |
| **Authentication** | | |
| `JWT_SECRET` | Recommended | Turns on login. When not set, runs in single-user mode with **no login** — only do that on your own machine. Generate with: `openssl rand -base64 32` |
| `CORS_ORIGIN` | Optional | Comma-separated origins allowed to call the API (default: `http://localhost:5173`) |
| **Safety Limits & Cost** | | |
| `CLAUDE_MODEL` | Optional | Claude model for all AI features (default: `claude-sonnet-5`) |
| `MAX_SCANS_PER_DAY` | Optional | Max LinkedIn scans per day, manual + monitor (default: `10`, `0` = no limit) |
| `APOLLO_COST_PER_CREDIT` | Optional | USD per Apollo match, for cost reporting (default: `0`) |

### ICP Configuration

The file `config/icp.yaml` controls how leads are scored. **No code changes needed** — edit the YAML or use the AI ICP Generator in the dashboard.

```yaml
# Target titles (exact match = highest score)
titles:
  exact_match:
    - "VP of Marketing"
    - "Head of Growth"
    - "CTO"
  keyword_match:             # Partial keyword matching in title
    - "marketing"
    - "growth"
  seniority_keywords:        # Combined with department for bonus scoring
    - "VP"
    - "Head"
    - "Director"
  exclude_keywords:          # Automatically filter out
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
  comment_intent: 45          # Claude-analyzed comment quality
  title_match: 25             # ICP title fit
  company_fit: 20             # Industry, size, revenue
  profile_completeness: 10
```

Add more profiles as extra YAML files in `config/` and pick one when starting a scan.

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

Campaigns can also be created and managed from the dashboard (`/campaigns`), which supports A/B test variants for message optimization.

---

## Features

### Core Scan Pipeline

Paste a LinkedIn post URL → the system scrapes all commenters, enriches via Apollo, scores against your ICP, classifies intent with Claude AI, ranks, and generates personalized outreach drafts.

The entire pipeline runs as a **server-sent events (SSE)** stream so you see progress in real time.

Tick **"Also include people who reacted"** to add up to 50 reactors. They skip AI classification and get intent tier T4 (same as a generic "Great post!"), so they rank below real commenters.

Enriched leads are saved as they arrive, so if a scan fails midway, re-running it reuses the Apollo results instead of paying again.

**Scoring formula:**
```
Total Score = Intent Score (0-45) + ICP Score (0-55) + Appearance Bonus (0-20)
```
Capped at 100.

**Outreach draft modes:**

| Mode | Description |
|------|-------------|
| `direct` | Straightforward intro referencing their comment |
| `topic` | Starts with the topic they commented about |
| `pain` | Leads with a pain point based on their industry |
| `campaign` | Uses your campaign context file |

Drafts are editable in-app via a tabbed editor in the lead detail view.

---

### Campaign Management

Create campaigns on the `/campaigns` page to organize outreach:

- **Create campaigns** with names, descriptions, and linked ICP profiles
- **A/B test variants** — add multiple message variants per campaign with a control group
- **Assign leads** — bulk-assign leads from scan results to campaigns
- **Track metrics** — per-campaign counts for sent, replied, meetings, and reply rate
- **Status control** — activate, pause, or delete campaigns

---

### Signal Detection Engine

The signal detection engine runs automatically on the monitor cron schedule and detects buying signals across your lead database.

| Detector | API Used | What It Detects |
|----------|----------|-----------------|
| **Job Change** | Apollo People Match | Title or company changes for existing leads |
| **Funding Rounds** | Crunchbase / Google News RSS | Recent funding events (<30 days) for lead companies |
| **Hiring Spikes** | Apollo Org Enrich | >10% headcount growth between checks |
| **Competitor Engagement** | Playwright (LinkedIn) | Your leads commenting on competitor posts (logged by the monitor job) |

All detected signals are stored in the database.

---

### Multi-Step Outreach Sequences

Follow-up sequences with AI-written messages that **you review and send yourself** — nothing is sent automatically:

| Step | Day | Purpose |
|------|-----|---------|
| 1 | Day 0 | Initial personalized connection message |
| 2 | Day 3 | Soft follow-up — add value or share a resource |
| 3 | Day 7 | Different angle — case study or ROI stat |
| 4 | Day 14 | Break-up message — friendly close with FOMO |

- When a step is due, the monitor job has **Claude draft it** with full context (lead title, company, original comment, previous messages) and puts it on the **Follow-ups** page
- On that page you edit the draft, copy it, send it on LinkedIn, then click **I sent it** (or **Skip this step**). If they answer, click **They replied** — the rest of their sequence is cancelled and the lead is marked replied
- The next step only gets drafted once the previous one is sent or skipped, and its delay counts from when you actually sent — so sending late never makes the next one due instantly
- Leads marked replied, meeting booked, converted or dead get no more drafts
- **Start follow-ups** from the Results page: select leads, pick a campaign, click **Start follow-ups**. Leads are added to the campaign, the default 4 steps are created if needed, and the day-0 draft is written right away. Starting again for the same leads does nothing
- The app never reads your LinkedIn inbox or sends/withdraws anything on LinkedIn — replies are recorded by you, with **They replied**

---

### Analytics & Reporting

The analytics dashboard (`/analytics`) has 4 tabs:

| Tab | Content |
|-----|---------|
| **Campaigns** | Per-campaign table: leads, sent, replied, reply rate, meetings |
| **Signals** | Signal-to-conversion tracking: how many signals of each type led to meetings |
| **Reply Rates** | Reply rates by campaign and by intent tier with bar charts |
| **Pipeline** | Funnel visualization showing leads at each lifecycle stage |

The main dashboard (`/`) shows summary cards (total leads, campaigns, active, signals in 7 days, meetings booked) and a pipeline funnel.

---

### Pipeline Board (Kanban)

The `/pipeline` page provides a drag-and-drop Kanban board with 6 columns:

| Column | Meaning |
|--------|---------|
| **New** | Just scraped, not yet contacted |
| **Contacted** | Outreach sent |
| **Replied** | Got a response |
| **Meeting** | Meeting scheduled |
| **Converted** | Closed deal |
| **Dead** | Not interested / unresponsive |

Drag a lead card between columns to update its status. Cards show name, title, company, score, and email indicator.

---

### AI Tools

The `/tools` page provides 3 AI-powered utilities:

| Tool | What It Does |
|------|-------------|
| **ICP Generator** | Describe your product → Claude generates a complete ICP config (titles, industries, company size, revenue, funding stages) as JSON you can save to the database |
| **Message Analyzer** | Paste an outreach message → get scores (1-10) for personalization, clarity, CTA strength, tone, length, plus a rewritten improved version |
| **Content Generator** | Enter a topic, tone, and format → get a full LinkedIn post with hook, body, hashtags, engagement prediction, and best posting time |

---

### CRM Integrations

#### HubSpot

- Single lead push or batch push to HubSpot Contacts
- Creates/updates contacts with all enriched data
- Automatically adds to suppression list on push
- Custom properties: `lead_score`, `intent_tier`, `source_post_url`, `comment_text`, `outreach_draft`, `data_confidence`

> **First-time setup:** Create the custom properties in HubSpot → Settings → Properties.

#### Apollo Sequences

- List available sequences from your Apollo account
- Push individual leads or batch-push to email sequences
- Tracks which sequence each lead was added to
- Auto-adds to suppression list on push

---

### Daily Limits & Cost Tracking

- **Daily caps** — `MAX_SCANS_PER_DAY` (manual + monitor scans) protects your LinkedIn account. Hitting a cap stops the action with a clear message.
- **Cost per scan** — every Claude call (exact token cost) and Apollo match is logged against the scan that caused it. See **Analytics → Usage & Cost**.

### Suppression / Blacklist

Prevents duplicate outreach:

- **Manual:** Add LinkedIn URLs individually or bulk-import via CSV
- **Automatic:** Leads pushed to HubSpot or Apollo Sequences are auto-added
- **Pipeline integration:** Suppressed leads are filtered out *before* enrichment, saving API credits
- **Reasons tracked:** `manual_exclude`, `in_pipeline`, `already_contacted`
- **Search and filter** by reason or name

---

### Cross-Scan Signal Stacking

If someone comments on multiple posts, that's a stronger buying signal:

- Every appearance across different posts is tracked in `lead_appearances`
- **Score boost:** +5 per additional appearance (capped at +20 bonus)
- 🔥 badge in the lead table for multi-signal leads
- Appearance history shown on lead detail page

---

### CSV Export

Download all leads for a post as CSV from the Results page (`/api/leads/export-csv?postUrl=...`).

---

### Automated Monitoring

Set up LinkedIn accounts to monitor automatically:

- Add LinkedIn profile URLs to watch (your accounts or competitors)
- Configurable check frequency (default: every 6 hours via cron)
- **Own accounts:** When new posts are detected, auto-scans commenters through the full pipeline
- **Competitor accounts:** Scrapes comments and cross-references with your existing leads to detect engagement overlap
- Toggle accounts active/inactive
- After each monitoring run, the signal detection engine runs automatically

---

### Authentication & Multi-Team

JWT-based authentication, enabled by setting `JWT_SECRET`. Every `/api` route except login and first signup then requires a token, and the dashboard shows a sign-in screen.

- **Signup** — the first account signs up freely and becomes `admin`; after that only a logged-in admin can create accounts (they join the admin's org as `member`)
- **Login** — returns a JWT token valid for 7 days
- **Role-based access** — `admin` and `member` roles
- **Org scoping** — prepared for per-organization data isolation
- **Single-user fallback** — when `JWT_SECRET` is not set, all requests are auto-authenticated as a local admin

---

## API Reference

### Scanning

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/scan` | Start a new scan (SSE stream). Body: `{ postUrl, outreachMode, icpProfile, includeReactions }` |
| `GET` | `/api/scanned-posts` | List all previously scanned posts |

### Leads

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/leads` | Get leads. Query: `postUrl`, `minScore`, `sortBy`, `status` |
| `GET` | `/api/leads/:id` | Get single lead with all enrichment data |
| `PATCH` | `/api/leads/:id/draft` | Update outreach draft. Body: `{ mode, content }` |
| `PATCH` | `/api/leads/:id/status` | Update pipeline status. Body: `{ status }` |
| `GET` | `/api/leads/:id/history` | Get status change history |
| `GET` | `/api/leads/:id/appearances` | Get cross-scan appearance history |
| `POST` | `/api/leads/:id/push-hubspot` | Push to HubSpot |
| `POST` | `/api/leads/:id/push-apollo` | Push to Apollo Sequence. Body: `{ sequenceId }` |
| `GET` | `/api/leads/export-csv` | Download leads as CSV. Query: `postUrl` |
| `POST` | `/api/leads/push-hubspot-batch` | Batch HubSpot push. Body: `{ leadIds }` |
| `POST` | `/api/leads/push-apollo-batch` | Batch Apollo push. Body: `{ leadIds, sequenceId }` |

### Campaigns

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/campaigns` | List all campaigns |
| `POST` | `/api/campaigns` | Create campaign. Body: `{ name, description, icpProfileId }` |
| `GET` | `/api/campaigns/:id` | Get campaign with metrics |
| `PATCH` | `/api/campaigns/:id` | Update campaign. Body: `{ name, status, description }` |
| `DELETE` | `/api/campaigns/:id` | Delete campaign |
| `POST` | `/api/campaigns/:id/variants` | Add A/B variant. Body: `{ name, messageTemplate, isControl }` |
| `POST` | `/api/campaigns/:id/follow-ups/start` | Add leads to the campaign and start their sequence. Body: `{ leadIds }` |
| `GET` | `/api/follow-ups` | Drafted follow-ups waiting to be sent |
| `PATCH` | `/api/follow-ups/:id` | Edit a draft. Body: `{ message }` |
| `POST` | `/api/follow-ups/:id/sent` | Mark as sent by you; re-spaces later steps from now |
| `POST` | `/api/follow-ups/:id/skip` | Skip this step |
| `POST` | `/api/follow-ups/:id/replied` | Lead replied: cancel their remaining steps and mark them replied |

### ICP Profiles

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/icp/generate` | AI-generate ICP. Body: `{ productDescription, targetMarket, existingCustomers }` |
| `GET` | `/api/icp-profiles` | List available YAML profile names |

### Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/analytics/dashboard` | Dashboard summary (leads, campaigns, signals, meetings) |
| `GET` | `/api/analytics/campaigns` | Campaign performance table |
| `GET` | `/api/analytics/signals` | Signal-to-conversion tracking |
| `GET` | `/api/analytics/reply-rates` | Reply rates by campaign and intent tier |
| `GET` | `/api/analytics/pipeline` | Pipeline stage counts |
| `GET` | `/api/usage` | Today's cap usage, per-day usage/cost, and cost per scan. Query: `?days=30` |

### Suppression List

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/suppression` | List all. Query: `reason`, `search` |
| `POST` | `/api/suppression` | Add single entry. Body: `{ linkedinUrl, name, reason }` |
| `POST` | `/api/suppression/bulk` | Bulk import. Body: `{ entries: [...] }` |
| `DELETE` | `/api/suppression/:id` | Remove entry |

### Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/monitor` | List monitored accounts |
| `POST` | `/api/monitor` | Add account. Body: `{ linkedinProfileUrl, label, checkFrequencyHours }` |
| `DELETE` | `/api/monitor/:id` | Remove account |
| `PATCH` | `/api/monitor/:id/toggle` | Toggle active/inactive |

### AI Tools

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tools/analyze-message` | Analyze outreach message. Body: `{ message, context }` |
| `POST` | `/api/tools/generate-content` | Generate LinkedIn post. Body: `{ topic, tone, audience, format }` |

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/signup` | Create account. Body: `{ email, password, name, orgName }` |
| `POST` | `/api/auth/login` | Login. Body: `{ email, password }`. Returns JWT token |
| `GET` | `/api/auth/me` | Get current user (requires `Authorization: Bearer <token>`) |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/apollo/sequences` | List Apollo email sequences |

---

## Frontend Pages

| Page | Path | Description |
|------|------|-------------|
| **Dashboard** | `/` | Summary cards (leads, campaigns, signals, meetings), pipeline funnel visualization, campaign performance table |
| **Scan** | `/scan` | Enter a LinkedIn post URL, select outreach mode and ICP profile, start scan with live SSE progress |
| **Results** | `/results` | Sortable lead table with filters (score, intent tier, confidence, status). Batch actions: HubSpot push, CSV export |
| **Lead Detail** | `/leads/:id` | Full profile, comment, intent analysis, editable outreach drafts (4 modes), CRM push buttons, status history, signal history, appearance history |
| **Campaigns** | `/campaigns` | Campaign list + detail split view. Create/edit/pause/delete campaigns. A/B variant management. Per-campaign metrics |
| **Follow-ups** | `/follow-ups` | Review queue for drafted follow-ups: edit, copy, open the LinkedIn profile, mark sent or skip |
| **Pipeline** | `/pipeline` | Kanban board with 6 columns. Drag-and-drop leads between stages (New → Contacted → Replied → Meeting → Converted → Dead) |
| **Monitor** | `/monitor` | Add/remove LinkedIn accounts for automatic monitoring. Toggle active/inactive. View last checked timestamp |
| **Analytics** | `/analytics` | 4-tab analytics: campaign performance table, signal-to-conversion bars, reply rate charts (by campaign + intent tier), pipeline funnel |
| **AI Tools** | `/tools` | 3-tab AI workspace: ICP Generator, Message Analyzer (with scores + rewritten version), Content Generator (LinkedIn posts with hashtags) |
| **Suppress** | `/suppress` | Manage blacklist — add, bulk import (CSV), search, filter by reason, remove entries |

---

## Database Schema

SQLite with **20 tables**, auto-created on first run:

| Table | Purpose |
|-------|---------|
| `leads` | All scraped/enriched leads with scores, drafts, enrichment data (~40 columns) |
| `scanned_posts` | Record of all scanned LinkedIn post URLs |
| `monitored_accounts` | LinkedIn profiles being automatically monitored |
| `suppression_list` | Blacklisted LinkedIn URLs to skip during scans |
| `lead_status_history` | Audit trail of every status change |
| `lead_appearances` | Cross-scan tracking (which leads appeared on which posts) |
| `campaigns` | Campaign definitions with name, status, ICP profile link |
| `campaign_variants` | A/B test message variants per campaign |
| `campaign_leads` | Lead-to-campaign assignment with per-lead status tracking |
| `campaign_metrics` | Aggregated campaign performance snapshots |
| `icp_profiles` | Legacy table, unused (kept because `campaigns.icp_profile_id` references it) |
| `detected_signals` | All detected signals (job change, funding, hiring) |
| `company_headcount_history` | Periodic headcount snapshots for hiring spike detection |
| `sequence_steps` | Multi-step sequence definitions (step number, delay days) |
| `sequence_tracking` | Per-lead sequence progress (status, sent_at, message_content) |
| `organizations` | Multi-tenant organization entities |
| `users` | User accounts with bcrypt password hashes and org membership |

The database auto-creates on first run and runs safe `ALTER TABLE` migrations for schema updates. All column additions are guarded by `PRAGMA table_info` checks to prevent duplicate column errors.

---

## Prompt Templates

All Claude AI prompts are stored as Markdown files in the `prompts/` directory for easy editing:

| File | Used By | Purpose |
|------|---------|---------|
| `intent-classification.md` | `intentClassifier.js` | Score comment text as intent tier (T1 strongest → T5 weakest) |
| `outreach-drafts.md` | `draftGenerator.js` | Generate 4 personalized outreach messages per lead |
| `icp-generator.md` | `icpGenerator.js` | Generate a complete ICP config from a product description |
| `follow-up-sequence.md` | `sequenceEngine.js` | Generate follow-up messages for multi-step sequences |
| `message-analyzer.md` | `messageAnalyzer.js` | Score outreach messages on personalization, clarity, CTA, tone, length |
| `content-generator.md` | `contentGenerator.js` | Generate LinkedIn posts with hook, body, hashtags, engagement prediction |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 20+ |
| **Backend** | Express.js |
| **Database** | SQLite via `better-sqlite3` |
| **Scraping** | Playwright + stealth plugin |
| **AI** | Anthropic Claude via one shared helper (`server/ai/claude.js`) with structured JSON output; model set by `CLAUDE_MODEL` |
| **Lead Enrichment** | Apollo.io People API |
| **Signal Detection** | Apollo, Crunchbase (optional), Google News RSS (free fallback) |
| **CRM** | HubSpot Contacts API |
| **Email Automation** | Apollo Sequences API |
| **Auth** | JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`) |
| **Notifications** | Slack Webhooks |
| **Frontend** | React 18 + React Router v6 |
| **Build Tool** | Vite |
| **Styling** | Tailwind CSS |
| **Monorepo** | npm workspaces + concurrently |

---

## License

Private — not open source.
