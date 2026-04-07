import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { createGHLClient } from './ghl-client.js';
import { analyzeCallData, buildReport, formatReportAsMarkdown } from './report-builder.js';
import 'dotenv/config';

const API_KEY     = process.env.GHL_API_KEY;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
const PORT        = process.env.PORT || 3000;
const TRANSPORT   = process.env.MCP_TRANSPORT || 'http';

if (!API_KEY || !LOCATION_ID) {
  console.error('ERROR: GHL_API_KEY and GHL_LOCATION_ID must be set in .env');
  process.exit(1);
}

// ─── Sub-account Location Map ─────────────────────────────────────────────────
const LOCATIONS = {
  [LOCATION_ID]: { name: 'Upstate Ketamine', apiKey: API_KEY },
  'tMqk4gZoIz7MCqcIQBFr': { name: 'Mobile Wound Care', apiKey: 'pit-85ca92cc-6cd3-463c-9fa3-e4926b4272cf' },
  '1PLFqlVhlxWLklTAuQtK': { name: 'Advanced Remedy Center', apiKey: 'pit-19589354-e833-4548-bb36-30ac22b1a981' },
  '2HXWvQvzfMHgty2hFtKk': { name: 'MY Self Wellness', apiKey: 'pit-ed4c2afc-db06-4ea8-ab5c-ba8a71511c21' },
};

function getClient(locationId) {
  const id = locationId || LOCATION_ID;
  const loc = LOCATIONS[id];
  if (!loc) throw new Error(`Unknown locationId: ${id}`);
  return createGHLClient(loc.apiKey, id);
}

const ghl = createGHLClient(API_KEY, LOCATION_ID);

// ─── Tool handler ─────────────────────────────────────────────────────────────
async function handleTool(name, args) {
  const client = args.locationId ? getClient(args.locationId) : ghl;

  switch (name) {
    case 'ghl_generate_lead_report': {
      const { startDate, endDate, tags } = args;

      // Keep search small enough to enrich within Railway's 15s edge timeout
      const SEARCH_LIMIT = 25;
      const ENRICH_CONCURRENCY = 4;

      const contactsData = await client.searchContacts({ startDate, endDate, tags, limit: SEARCH_LIMIT });
      console.error('searchContacts response keys:', Object.keys(contactsData || {}));

      const contacts =
        contactsData?.contacts ||
        contactsData?.data ||
        contactsData?.results ||
        [];

      console.error(`Found ${contacts.length} contacts for report`);

      if (contacts.length === 0) {
        return {
          report: null,
          markdown: `# No leads found\n\nNo contacts matched the criteria:\n- **Period:** ${startDate} to ${endDate}\n- **Tags:** ${tags?.join(', ') || 'none'}\n- **Location:** ${args.locationId || LOCATION_ID}`,
          contactCount: 0,
        };
      }

      const enrichOne = async (contact) => {
        try {
          const [convData, notesData] = await Promise.all([
            client.getContactConversations(contact.id).catch((e) => {
              console.error(`getContactConversations failed for ${contact.id}:`, e.message);
              return { conversations: [] };
            }),
            client.getContactNotes(contact.id).catch(() => ({ notes: [] })),
          ]);
          const conversations = convData?.conversations || [];
          let messages = [];
          if (conversations.length > 0) {
            const msgData = await client.getConversationMessages(conversations[0].id).catch(() => ({ messages: [] }));
            messages = msgData?.messages || [];
          }
          const callData = analyzeCallData(messages);
          return { contact, callData, messages, notes: notesData };
        } catch (err) {
          console.error(`Enrichment failed for contact ${contact.id}:`, err.message);
          return { contact, callData: { totalAttempts: 0, connected: false, durations: [], callAttempts: [], connectionCount: 0, longestCall: 0 }, messages: [], notes: [] };
        }
      };

      const enriched = [];
      for (let i = 0; i < contacts.length; i += ENRICH_CONCURRENCY) {
        const batch = contacts.slice(i, i + ENRICH_CONCURRENCY);
        const results = await Promise.all(batch.map(enrichOne));
        enriched.push(...results);
        console.error(`Enriched ${enriched.length}/${contacts.length}`);
      }

      const report = buildReport({ contacts: enriched, startDate, endDate, preparedDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) });
      return { report, markdown: formatReportAsMarkdown(report), contactCount: contacts.length };
    }
    case 'ghl_search_contacts':           return client.searchContacts(args);
    case 'ghl_get_contact':               return client.getContact(args.contactId);
    case 'ghl_update_contact_stage':      return client.updateContactStage(args.contactId, args.pipelineId, args.stageId);
    case 'ghl_add_contact_tag':           return client.addContactTag(args.contactId, args.tags);
    case 'ghl_add_contact_note':          return client.addContactNote(args.contactId, args.body);
    case 'ghl_get_contact_notes':         return client.getContactNotes(args.contactId);
    case 'ghl_get_contact_conversations': return client.getContactConversations(args.contactId);
    case 'ghl_get_conversation_messages': return client.getConversationMessages(args.conversationId, args.limit);
    case 'ghl_send_sms':                  return client.sendSMS(args.contactId, args.message);
    case 'ghl_get_contact_activities':    return client.getContactActivities(args.contactId);
    case 'ghl_get_pipelines':             return client.getPipelines();
    case 'ghl_get_opportunities':         return client.getOpportunities(args);
    case 'ghl_move_opportunity':          return client.moveOpportunity(args.opportunityId, args.stageId);
    case 'ghl_get_calendars':             return client.getCalendars();
    case 'ghl_get_appointments':          return client.getCalendarAppointments(args.calendarId, args.startTime, args.endTime);
    case 'ghl_create_appointment':        return client.createAppointment(args);
    case 'ghl_create_task':               return client.createTask(args.contactId, { title: args.title, dueDate: args.dueDate, description: args.description });
    case 'ghl_get_tasks':                 return client.getTasks(args.contactId);
    case 'ghl_get_workflows':             return client.getWorkflows();
    case 'ghl_add_to_workflow':           return client.addContactToWorkflow(args.contactId, args.workflowId);
    case 'ghl_remove_from_workflow':      return client.removeContactFromWorkflow(args.contactId, args.workflowId);
    case 'ghl_get_tags':                  return client.getTags();
    case 'ghl_get_custom_fields':         return client.getCustomFields();
    case 'ghl_update_custom_field':       return client.updateCustomField(args.contactId, args.customFields);
    case 'ghl_list_locations':            return { locations: Object.entries(LOCATIONS).map(([id, loc]) => ({ locationId: id, name: loc.name })) };
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────
function createServer() {
  const srv = new McpServer({ name: 'ghl-hwc-mcp', version: '1.0.0' });

  function t(name, schema, fn) {
    srv.tool(name, schema, async (args) => {
      try {
        const result = await fn(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        console.error(`Tool ${name} failed:`, err.message, err.stack);
        const detail = err.response?.data
          ? `${err.message} | GHL response: ${JSON.stringify(err.response.data)}`
          : err.message;
        return { content: [{ type: 'text', text: `Error in ${name}: ${detail}` }], isError: true };
      }
    });
  }

  const loc = z.string().optional().describe('GHL Location ID. Omit to use default.');

  t('ghl_list_locations', {}, (a) => handleTool('ghl_list_locations', a));
  t('ghl_generate_lead_report', { startDate: z.string(), endDate: z.string(), tags: z.array(z.string()).optional(), pipelineId: z.string().optional(), locationId: loc }, (a) => handleTool('ghl_generate_lead_report', a));
  t('ghl_search_contacts', { query: z.string().optional(), tags: z.array(z.string()).optional(), startDate: z.string().optional(), endDate: z.string().optional(), limit: z.number().optional(), skip: z.number().optional(), locationId: loc }, (a) => handleTool('ghl_search_contacts', a));
  t('ghl_get_contact', { contactId: z.string(), locationId: loc }, (a) => handleTool('ghl_get_contact', a));
  t('ghl_update_contact_stage', { contactId: z.string(), pipelineId: z.string(), stageId: z.string(), locationId: loc }, (a) => handleTool('ghl_update_contact_stage', a));
  t('ghl_add_contact_tag', { contactId: z.string(), tags: z.array(z.string()), locationId: loc }, (a) => handleTool('ghl_add_contact_tag', a));
  t('ghl_add_contact_note', { contactId: z.string(), body: z.string(), locationId: loc }, (a) => handleTool('ghl_add_contact_note', a));
  t('ghl_get_contact_notes', { contactId: z.string(), locationId: loc }, (a) => handleTool('ghl_get_contact_notes', a));
  t('ghl_get_contact_conversations', { contactId: z.string(), locationId: loc }, (a) => handleTool('ghl_get_contact_conversations', a));
  t('ghl_get_conversation_messages', { conversationId: z.string(), limit: z.number().optional(), locationId: loc }, (a) => handleTool('ghl_get_conversation_messages', a));
  t('ghl_send_sms', { contactId: z.string(), message: z.string(), locationId: loc }, (a) => handleTool('ghl_send_sms', a));
  t('ghl_get_contact_activities', { contactId: z.string(), locationId: loc }, (a) => handleTool('ghl_get_contact_activities', a));
  t('ghl_get_pipelines', { locationId: loc }, (a) => handleTool('ghl_get_pipelines', a));
  t('ghl_get_opportunities', { pipelineId: z.string().optional(), stageId: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional(), limit: z.number().optional(), locationId: loc }, (a) => handleTool('ghl_get_opportunities', a));
  t('ghl_move_opportunity', { opportunityId: z.string(), stageId: z.string(), locationId: loc }, (a) => handleTool('ghl_move_opportunity', a));
  t('ghl_get_calendars', { locationId: loc }, (a) => handleTool('ghl_get_calendars', a));
  t('ghl_get_appointments', { calendarId: z.string(), startTime: z.string(), endTime: z.string(), locationId: loc }, (a) => handleTool('ghl_get_appointments', a));
  t('ghl_create_appointment', { calendarId: z.string(), contactId: z.string(), startTime: z.string(), endTime: z.string(), title: z.string(), locationId: loc }, (a) => handleTool('ghl_create_appointment', a));
  t('ghl_create_task', { contactId: z.string(), title: z.string(), dueDate: z.string(), description: z.string().optional(), locationId: loc }, (a) => handleTool('ghl_create_task', a));
  t('ghl_get_tasks', { contactId: z.string(), locationId: loc }, (a) => handleTool('ghl_get_tasks', a));
  t('ghl_get_workflows', { locationId: loc }, (a) => handleTool('ghl_get_workflows', a));
  t('ghl_add_to_workflow', { contactId: z.string(), workflowId: z.string(), locationId: loc }, (a) => handleTool('ghl_add_to_workflow', a));
  t('ghl_remove_from_workflow', { contactId: z.string(), workflowId: z.string(), locationId: loc }, (a) => handleTool('ghl_remove_from_workflow', a));
  t('ghl_get_tags', { locationId: loc }, (a) => handleTool('ghl_get_tags', a));
  t('ghl_get_custom_fields', { locationId: loc }, (a) => handleTool('ghl_get_custom_fields', a));
  t('ghl_update_custom_field', { contactId: z.string(), customFields: z.array(z.object({ id: z.string(), value: z.string() })), locationId: loc }, (a) => handleTool('ghl_update_custom_field', a));

  return srv;
}

// ─── Transport ────────────────────────────────────────────────────────────────
if (TRANSPORT === 'stdio') {
  const transport = new StdioServerTransport();
  const srv = createServer();
  await srv.connect(transport);
  console.error('GHL MCP Server running (stdio)');
} else {
  const app = express();
  app.use(express.json());

  // CORS for browser-based clients and Claude's connector fetcher
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/health', (_, res) =>
    res.json({ status: 'ok', location: LOCATION_ID, locations: Object.keys(LOCATIONS) })
  );

  // ─── Streamable HTTP transport (modern, Claude connectors) ──────────────────
  // Stateless mode: each request creates a fresh transport + server.
  app.all('/mcp', async (req, res) => {
    try {
      const srv = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });

      res.on('close', () => {
        transport.close();
        srv.close();
      });

      await srv.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('Streamable HTTP error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // ─── Legacy SSE transport (kept for backward compatibility) ─────────────────
  const sseTransports = new Map();

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = sseTransports.get(sessionId);
    if (!transport) return res.status(404).json({ error: 'Session not found' });
    await transport.handlePostMessage(req, res);
  });

  app.get('/sse', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const transport = new SSEServerTransport('/messages', res);
    sseTransports.set(transport.sessionId, transport);

    res.on('close', () => sseTransports.delete(transport.sessionId));

    const srv = createServer();
    await srv.connect(transport);
  });

  app.listen(PORT, () => {
    console.error(`GHL MCP Server running on port ${PORT}`);
    console.error(`  Streamable HTTP: /mcp`);
    console.error(`  Legacy SSE:      /sse`);
    console.error(`  Health:          /health`);
  });
}
