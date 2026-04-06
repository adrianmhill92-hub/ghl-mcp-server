import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { createGHLClient } from './ghl-client.js';
import { tools } from './tools.js';
import { analyzeCallData, buildReport, formatReportAsMarkdown } from './report-builder.js';
import 'dotenv/config';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const API_KEY    = process.env.GHL_API_KEY;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
const PORT       = process.env.PORT || 3000;
const TRANSPORT  = process.env.MCP_TRANSPORT || 'sse'; // 'sse' for hosted, 'stdio' for local

if (!API_KEY || !LOCATION_ID) {
  console.error('ERROR: GHL_API_KEY and GHL_LOCATION_ID must be set in .env');
  process.exit(1);
}

const ghl = createGHLClient(API_KEY, LOCATION_ID);

// ─── MCP SERVER ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'ghl-hwc-mcp',
  version: '1.0.0',
});

// Register all tools
for (const tool of tools) {
  server.tool(tool.name, tool.description, tool.inputSchema.properties || {}, async (args) => {
    try {
      const result = await handleTool(tool.name, args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });
}

// ─── TOOL HANDLER ─────────────────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {

    // ── LEAD REPORT ────────────────────────────────────────────────────────────
    case 'ghl_generate_lead_report': {
      const { startDate, endDate, tags, pipelineId } = args;

      // 1. Fetch all contacts in date range
      const contactsData = await ghl.searchContacts({
        startDate,
        endDate,
        tags,
        limit: 200,
      });

      const contacts = contactsData.contacts || [];
      console.error(`Fetched ${contacts.length} contacts`);

      // 2. For each contact, gather call logs + conversations + notes in parallel
      const enriched = await Promise.all(
        contacts.map(async (contact) => {
          try {
            const [convData, activitiesData, notesData] = await Promise.all([
              ghl.getContactConversations(contact.id),
              ghl.getContactActivities(contact.id).catch(() => ({ activities: [] })),
              ghl.getContactNotes(contact.id).catch(() => ({ notes: [] })),
            ]);

            // Get messages from first conversation
            const conversations = convData?.conversations || [];
            let messages = [];
            if (conversations.length > 0) {
              const msgData = await ghl.getConversationMessages(conversations[0].id);
              messages = msgData?.messages || [];
            }

            const callData = analyzeCallData(messages);

            return { contact, callData, messages, notes: notesData };
          } catch (err) {
            console.error(`Error enriching contact ${contact.id}: ${err.message}`);
            return {
              contact,
              callData: { totalAttempts: 0, connected: false, durations: [], callAttempts: [], connectionCount: 0, longestCall: 0 },
              messages: [],
              notes: [],
            };
          }
        })
      );

      const report = buildReport({
        contacts: enriched,
        startDate,
        endDate,
        preparedDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      });

      return {
        report,
        markdown: formatReportAsMarkdown(report),
        contactCount: contacts.length,
      };
    }

    // ── CONTACTS ───────────────────────────────────────────────────────────────
    case 'ghl_search_contacts':
      return ghl.searchContacts(args);

    case 'ghl_get_contact':
      return ghl.getContact(args.contactId);

    case 'ghl_update_contact_stage':
      return ghl.updateContactStage(args.contactId, args.pipelineId, args.stageId);

    case 'ghl_add_contact_tag':
      return ghl.addContactTag(args.contactId, args.tags);

    case 'ghl_add_contact_note':
      return ghl.addContactNote(args.contactId, args.body);

    case 'ghl_get_contact_notes':
      return ghl.getContactNotes(args.contactId);

    // ── CONVERSATIONS ──────────────────────────────────────────────────────────
    case 'ghl_get_contact_conversations':
      return ghl.getContactConversations(args.contactId);

    case 'ghl_get_conversation_messages':
      return ghl.getConversationMessages(args.conversationId, args.limit);

    case 'ghl_send_sms':
      return ghl.sendSMS(args.contactId, args.message);

    // ── ACTIVITIES ─────────────────────────────────────────────────────────────
    case 'ghl_get_contact_activities':
      return ghl.getContactActivities(args.contactId);

    // ── PIPELINES ──────────────────────────────────────────────────────────────
    case 'ghl_get_pipelines':
      return ghl.getPipelines();

    case 'ghl_get_opportunities':
      return ghl.getOpportunities(args);

    case 'ghl_move_opportunity':
      return ghl.moveOpportunity(args.opportunityId, args.stageId);

    // ── CALENDARS ──────────────────────────────────────────────────────────────
    case 'ghl_get_calendars':
      return ghl.getCalendars();

    case 'ghl_get_appointments':
      return ghl.getCalendarAppointments(args.calendarId, args.startTime, args.endTime);

    case 'ghl_create_appointment':
      return ghl.createAppointment(args);

    // ── TASKS ──────────────────────────────────────────────────────────────────
    case 'ghl_create_task':
      return ghl.createTask(args.contactId, {
        title: args.title,
        dueDate: args.dueDate,
        description: args.description,
      });

    case 'ghl_get_tasks':
      return ghl.getTasks(args.contactId);

    // ── WORKFLOWS ──────────────────────────────────────────────────────────────
    case 'ghl_get_workflows':
      return ghl.getWorkflows();

    case 'ghl_add_to_workflow':
      return ghl.addContactToWorkflow(args.contactId, args.workflowId);

    case 'ghl_remove_from_workflow':
      return ghl.removeContactFromWorkflow(args.contactId, args.workflowId);

    // ── TAGS & CUSTOM FIELDS ───────────────────────────────────────────────────
    case 'ghl_get_tags':
      return ghl.getTags();

    case 'ghl_get_custom_fields':
      return ghl.getCustomFields();

    case 'ghl_update_custom_field':
      return ghl.updateCustomField(args.contactId, args.customFields);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── TRANSPORT SETUP ──────────────────────────────────────────────────────────

if (TRANSPORT === 'stdio') {
  // Local mode: for Claude Code / terminal use
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GHL MCP Server running (stdio)');

} else {
  // Hosted mode: SSE over HTTP — works with Claude.ai custom MCP connectors
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_, res) => res.json({ status: 'ok', location: LOCATION_ID }));

  // SSE endpoint — Claude connects here
  const transports = new Map();

  app.get('/sse', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const transport = new SSEServerTransport('/messages', res);
    transports.set(transport.sessionId, transport);

    res.on('close', () => transports.delete(transport.sessionId));

    await server.connect(transport);
    console.error(`Client connected: ${transport.sessionId}`);
  });

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = transports.get(sessionId);
    if (!transport) return res.status(404).json({ error: 'Session not found' });
    await transport.handlePostMessage(req, res, req.body);
  });

  app.listen(PORT, () => {
    console.error(`GHL MCP Server running on port ${PORT}`);
    console.error(`SSE endpoint: http://localhost:${PORT}/sse`);
    console.error(`Health check: http://localhost:${PORT}/health`);
  });
}
