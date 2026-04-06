# GHL MCP Server — 

Custom Model Context Protocol server connecting Claude directly to GoHighLevel's full API (~290 endpoints). Enables Claude to generate lead performance reports, manage contacts, send SMS, move pipeline stages, and more — all from a single natural language prompt.

---

## What This Does

Once deployed and connected to Claude.ai, you can type prompts like:

> **"Pull all leads tagged 'ketamine' created between March 25 and April 3 and generate the weekly lead report."**

Claude will automatically:
1. Fetch all matching contacts from GHL
2. Pull call logs and conversation history per contact
3. Analyze connection quality (calls >1 min = legitimate connection)
4. Classify each lead's status and priority
5. Generate the full lead anaylsis report format

Other prompts you can use:
- *"Send Affirm financing info via SMS to Jennie and Stefanie BrisenoSanchez"*
- *"Create a callback reminder task for Ed Simon due tomorrow at 10am"*
- *"Move all booked leads to the Consultation Confirmed pipeline stage"*
- *"What calendars do I have and what appointments are booked this week?"*
- *"Show me all contacts tagged 'ketamine' who have not responded after 3 call attempts"*

---

## Quick Start

### 1. Clone / download this project

```bash
git clone <your-repo-url>
cd ghl-mcp-server
npm install
```

### 2. Create your .env file

```bash
cp .env.example .env
```

Edit `.env` and fill in:
```
GHL_API_KEY=your_pit_token_from_ghl
GHL_LOCATION_ID=your_location_id
PORT=3000
MCP_TRANSPORT=sse
```

### 3. Get your GHL credentials

**API Key (PIT Token):**
1. In GHL → Settings → Private Integrations
2. Create New Integration → name it "Claude MCP"
3. Enable these permission scopes:
   - Contacts: Read + Write
   - Conversations: Read + Write
   - Opportunities/Pipelines: Read + Write
   - Calendars: Read + Write
   - Workflows: Read + Write
   - Locations: Read
   - Tags: Read + Write
   - Custom Fields: Read + Write
4. Click Create — copy the token immediately (shown once only)

**Location ID:**
- GHL → Settings → Business Profile → copy the Location ID

### 4. Test locally

```bash
node src/index.js
# Visit http://localhost:3000/health — should return {"status":"ok"}
```

---

## Deploy to Railway (Recommended — Free Tier Available)

Railway gives you a public HTTPS URL which Claude.ai needs to connect.

1. Create account at [railway.app](https://railway.app)
2. New Project → Deploy from GitHub repo (or upload folder)
3. Add environment variables in Railway dashboard:
   - `GHL_API_KEY`
   - `GHL_LOCATION_ID`
   - `MCP_TRANSPORT=sse`
4. Railway auto-detects Node.js and deploys
5. Copy your public URL e.g. `https://ghl-mcp-server-production.up.railway.app`

**Alternative hosts:** Render.com, Fly.io, any VPS with Node.js

---

## Connect to Claude.ai

Once deployed, add your MCP server to Claude.ai:

1. Go to [claude.ai](https://claude.ai) → Settings → Integrations (or Connectors)
2. Add Custom MCP Server
3. Enter your SSE URL: `https://your-app.railway.app/sse`
4. Save — Claude will discover all 25+ tools automatically

---

## Available Tools

| Tool | What it does |
|------|-------------|
| `ghl_generate_lead_report` | **Main report tool** — pulls contacts, enriches with calls/conversations, builds full HWC report |
| `ghl_search_contacts` | Search by name, tag, date range |
| `ghl_get_contact` | Full contact profile |
| `ghl_get_contact_conversations` | All SMS/email/call threads |
| `ghl_get_conversation_messages` | Full message content + call durations |
| `ghl_get_contact_activities` | Activity timeline including call logs |
| `ghl_send_sms` | Send SMS to a contact |
| `ghl_add_contact_note` | Log a note on a contact |
| `ghl_create_task` | Create callback reminder or follow-up task |
| `ghl_get_pipelines` | List all pipelines and stages |
| `ghl_get_opportunities` | Pull deals from a pipeline |
| `ghl_move_opportunity` | Move deal to a different stage |
| `ghl_get_calendars` | List all calendars |
| `ghl_get_appointments` | Get bookings for a date range |
| `ghl_create_appointment` | Book a new appointment |
| `ghl_add_to_workflow` | Enroll contact in automation |
| `ghl_remove_from_workflow` | Remove contact from automation |
| `ghl_get_tags` | List all tags |
| `ghl_get_custom_fields` | List custom field definitions |
| `ghl_update_custom_field` | Update custom field on contact |

---

## Report Generation Logic

### Legitimate Connection Rule
A call is only counted as a "legitimate connection" if the duration is **>1 minute (60 seconds)**. This matches the Hawaii Wellness Clinic standard.

### Status Classification
| Status | Criteria |
|--------|----------|
| Booked — Consult | Pipeline stage contains "booked" or "consult" |
| Active Communication | Connected call ≥10 minutes |
| Warm — Callback Pending | Connected call, any length >1 min |
| Warm — Responded | Inbound SMS/email from lead |
| Lost — DND | Contact has DND enabled or texted STOP |
| Lost — [Reason] | Pipeline stage marked lost |
| Nurture — Nth Attempt | No connection, N call attempts |

### Priority Assignment
- **High:** Booked, Active Communication, Callback Pending
- **Medium:** Warm — Responded, 3+ attempts with engagement
- **Low:** Nurture sequence, no engagement

---

## Example Prompts

```
Generate the weekly lead report for leads tagged 'ketamine' from March 25 to April 3

Show me all high-priority contacts who need follow-up today

Send this SMS to contact [name]: "Hi, following up on your inquiry about ketamine therapy. Are you still interested in learning more?"

Create a callback task for Ed Simon due tomorrow at 9am with note "Lead said he will call back"

Move Shane Batalona to the Booked — Clinical Consult pipeline stage

What appointments are booked on the phone consult calendar this week?
```

---

## HIPAA Compliance Notes

This server is designed for **internal use only**. All data stays between your Claude.ai account and your GHL account — no data is stored on the MCP server itself.

- Do not log PHI to console in production (remove `console.error` calls with contact data)
- Store API keys only in environment variables — never in code
- Use Railway or Fly.io private networking if possible
- Rotate your GHL API key periodically via Settings → Private Integrations

---

## File Structure

```
ghl-mcp-server/
├── src/
│   ├── index.js          # MCP server entry point + tool routing
│   ├── ghl-client.js     # GHL API wrapper (~290 endpoints)
│   ├── tools.js          # MCP tool definitions (what Claude sees)
│   └── report-builder.js # Lead report logic + HWC format
├── .env.example          # Environment variable template
├── railway.toml          # Railway deployment config
├── package.json
└── README.md
```

---

## Troubleshooting

**"Session not found" errors**
- Ensure `/sse` and `/messages` are on the same domain
- Check Railway logs for connection errors

**GHL API 401 errors**
- Verify your PIT token is correct and not expired
- Check that the required scopes are enabled on the integration

**No contacts returned**
- Confirm the location ID matches the account with your contacts
- Check date format: use `YYYY-MM-DD` format for startDate/endDate

**Call durations showing as 0**
- Call duration data lives in conversation messages with `messageType: 'TYPE_CALL'`
- Some GHL accounts encode this differently — check raw output of `ghl_get_conversation_messages`
