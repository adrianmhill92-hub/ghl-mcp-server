import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { z } from 'zod';
import { createGHLClient } from './ghl-client.js';
import { analyzeCallData, buildReport, formatReportAsMarkdown } from './report-builder.js';
import 'dotenv/config';

const API_KEY     = process.env.GHL_API_KEY;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
const PORT        = process.env.PORT || 3000;
const TRANSPORT   = process.env.MCP_TRANSPORT || 'sse';

if (!API_KEY || !LOCATION_ID) {
  console.error('ERROR: GHL_API_KEY and GHL_LOCATION_ID must be set in .env');
  process.exit(1);
}

const ghl = createGHLClient(API_KEY, LOCATION_ID);
const server = new McpServer({ name: 'ghl-hwc-mcp', version: '1.0.0' });

async function handleTool(name, args) {
  switch (name) {
    case 'ghl_generate_lead_report': {
      const { startDate, endDate, tags } = args;
      const contactsData = await ghl.searchContacts({ startDate, endDate, tags, limit: 200 });
      const contacts = contactsData.contacts || [];
      const enriched = await Promise.all(contacts.map(async (contact) => {
        try {
          const [convData, notesData] = await Promise.all([
            ghl.getContactConversations(contact.id),
            ghl.getContactNotes(contact.id).catch(() => ({ notes: [] })),
          ]);
          const conversations = convData?.conversations || [];
          let messages = [];
          if (conversations.length > 0) {
            const msgData = await ghl.getConversationMessages(conversations[0].id);
            messages = msgData?.messages || [];
          }
          const callData = analyzeCallData(messages);
          return { contact, callData, messages, notes: notesData };
        } catch {
          return { contact, callData: { totalAttempts: 0, connected: false, durations: [], callAttempts: [], connectionCount: 0, longestCall: 0 }, messages: [], notes: [] };
        }
      }));
      const report = buildReport({ contacts: enriched, startDate, endDate, preparedDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) });
      return { report, markdown: formatReportAsMarkdown(report), contactCount: contacts.length };
    }
    case 'ghl_search_contacts':           return ghl.searchContacts(args);
    case 'ghl_get_contact':               return ghl.getContact(args.contactId);
    case 'ghl_update_contact_stage':      return ghl.updateContactStage(args.contactId, args.pipelineId, args.stageId);
    case 'ghl_add_contact_tag':           return ghl.addContactTag(args.contactId, args.tags);
    case 'ghl_add_contact_note':          return ghl.addContactNote(args.contactId, args.body);
    case 'ghl_get_contact_notes':         return ghl.getContactNotes(args.contactId);
    case 'ghl_get_contact_conversations': return ghl.getContactConversations(args.contactId);
    case 'ghl_get_conversation_messages': return ghl.getConversationMessages(args.conversationId, args.limit);
    case 'ghl_send_sms':                  return ghl.sendSMS(args.contactId, args.message);
    case 'ghl_get_contact_activities':    return ghl.getContactActivities(args.contactId);
    case 'ghl_get_pipelines':             return ghl.getPipelines();
    case 'ghl_get_opportunities':         return ghl.getOpportunities(args);
    case 'ghl_move_opportunity':          return ghl.moveOpportunity(args.opportunityId, args.stageId);
    case 'ghl_get_calendars':             return ghl.getCalendars();
    case 'ghl_get_appointments':          return ghl.getCalendarAppointments(args.calendarId, args.startTime, args.endTime);
    case 'ghl_create_appointment':        return ghl.createAppointment(args);
    case 'ghl_create_task':               return ghl.createTask(args.contactId, { title: args.title, dueDate: args.dueDate, description: args.description });
    case 'ghl_get_tasks':                 return ghl.getTasks(args.contactId);
    case 'ghl_get_workflows':             return ghl.getWorkflows();
    case 'ghl_add_to_workflow':           return ghl.addContactToWorkflow(args.contactId, args.workflowId);
    case 'ghl_remove_from_workflow':      return ghl.removeContactFromWorkflow(args.contactId, args.workflowId);
    case 'ghl_get_tags':                  return ghl.getTags();
    case 'ghl_get_custom_fields':         return ghl.getCustomFields();
    case 'ghl_update_custom_field':       return ghl.updateCustomField(args.contactId, args.customFields);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function t(name, schema, fn) {
  server.tool(name, schema, async (args) => {
    try {
      const result = await fn(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });
}

t('ghl_generate_lead_report', { startDate: z.string(), endDate: z.string(), tags: z.array(z.string()).optional(), pipelineId: z.string().optional() }, (a) => handleTool('ghl_generate_lead_report', a));
t('ghl_search_contacts', { query: z.string().optional(), tags: z.array(z.string()).optional(), startDate: z.string().optional(), endDate: z.string().optional(), limit: z.number().optional(), skip: z.number().optional() }, (a) => handleTool('ghl_search_contacts', a));
t('ghl_get_contact', { contactId: z.string() }, (a) => handleTool('ghl_get_contact', a));
t('ghl_update_contact_stage', { contactId: z.string(), pipelineId: z.string(), stageId: z.string() }, (a) => handleTool('ghl_update_contact_stage', a));
t('ghl_add_contact_tag', { contactId: z.string(), tags: z.array(z.string()) }, (a) => handleTool('ghl_add_contact_tag', a));
t('ghl_add_contact_note', { contactId: z.string(), body: z.string() }, (a) => handleTool('ghl_add_contact_note', a));
t('ghl_get_contact_notes', { contactId: z.string() }, (a) => handleTool('ghl_get_contact_notes', a));
t('ghl_get_contact_conversations', { contactId: z.string() }, (a) => handleTool('ghl_get_contact_conversations', a));
t('ghl_get_conversation_messages', { conversationId: z.string(), limit: z.number().optional() }, (a) => handleTool('ghl_get_conversation_messages', a));
t('ghl_send_sms', { contactId: z.string(), message: z.string() }, (a) => handleTool('ghl_send_sms', a));
t('ghl_get_contact_activities', { contactId: z.string() }, (a) => handleTool('ghl_get_contact_activities', a));
t('ghl_get_pipelines', {}, (a) => handleTool('ghl_get_pipelines', a));
t('ghl_get_opportunities', { pipelineId: z.string().optional(), stageId: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional(), limit: z.number().optional() }, (a) => handleTool('ghl_get_opportunities', a));
t('ghl_move_opportunity', { opportunityId: z.string(), stageId: z.string() }, (a) => handleTool('ghl_move_opportunity', a));
t('ghl_get_calendars', {}, (a) => handleTool('ghl_get_calendars', a));
t('ghl_get_appointments', { calendarId: z.string(), startTime: z.string(), endTime: z.string() }, (a) => handleTool('ghl_get_appointments', a));
t('ghl_create_appointment', { calendarId: z.string(), contactId: z.string(), startTime: z.string(), endTime: z.string(), title: z.string() }, (a) => handleTool('ghl_create_appointment', a));
t('ghl_create_task', { contactId: z.string(), title: z.string(), dueDate: z.string(), description: z.string().optional() }, (a) => handleTool('ghl_create_task', a));
t('ghl_get_tasks', { contactId: z.string() }, (a) => handleTool('ghl_get_tasks', a));
t('ghl_get_workflows', {}, (a) => handleTool('ghl_get_workflows', a));
t('ghl_add_to_workflow', { contactId: z.string(), workflowId: z.string() }, (a) => handleTool('ghl_add_to_workflow', a));
t('ghl_remove_from_workflow', { contactId: z.string(), workflowId: z.string() }, (a) => handleTool('ghl_remove_from_workflow', a));
t('ghl_get_tags', {}, (a) => handleTool('ghl_get_tags', a));
t('ghl_get_custom_fields', {}, (a) => handleTool('ghl_get_custom_fields', a));
t('ghl_update_custom_field', { contactId: z.string(), customFields: z.array(z.object({ id: z.string(), value: z.string() })) }, (a) => handleTool('ghl_update_custom_field', a));

if (TRANSPORT === 'stdio') {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GHL MCP Server running (stdio)');
} else {
  const app = express();
  app.use(express.json());
  app.get('/health', (_, res) => res.json({ status: 'ok', location: LOCATION_ID }));

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
  });

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = transports.get(sessionId);
    if (!transport) return res.status(404).json({ error: 'Session not found' });
    await transport.handlePostMessage(req, res, req.body);
  });

  app.listen(PORT, () => {
    console.error(`GHL MCP Server running on port ${PORT}`);
  });
}
