// All tool definitions exposed to Claude via MCP
// Each tool maps directly to GHL API operations

export const tools = [

  // ─── LEAD REPORT ─────────────────────────────────────────────────────────────
  {
    name: 'ghl_generate_lead_report',
    description: `Pull all contacts from GHL for a date range and generate a full
      lead performance report like the Hawaii Wellness Clinic weekly report.
      Fetches contacts, call logs, conversations, notes, and pipeline stages
      then returns structured data ready for report generation.`,
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date ISO string e.g. 2026-03-25' },
        endDate: { type: 'string', description: 'End date ISO string e.g. 2026-04-03' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags e.g. ["ketamine","organic","heyflow"]',
        },
        pipelineId: { type: 'string', description: 'Optional pipeline ID to filter by' },
      },
      required: ['startDate', 'endDate'],
    },
  },

  // ─── CONTACTS ─────────────────────────────────────────────────────────────────
  {
    name: 'ghl_search_contacts',
    description: 'Search contacts by name, phone, email, tags, or date range.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, email, or phone search' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        startDate: { type: 'string', description: 'Created after date (ISO)' },
        endDate: { type: 'string', description: 'Created before date (ISO)' },
        limit: { type: 'number', description: 'Max results (default 100)' },
        skip: { type: 'number', description: 'Offset for pagination' },
      },
    },
  },

  {
    name: 'ghl_get_contact',
    description: 'Get full contact profile including tags, pipeline stage, and custom fields.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID' },
      },
      required: ['contactId'],
    },
  },

  {
    name: 'ghl_update_contact_stage',
    description: 'Move a contact to a different pipeline stage.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        pipelineId: { type: 'string' },
        stageId: { type: 'string' },
      },
      required: ['contactId', 'pipelineId', 'stageId'],
    },
  },

  {
    name: 'ghl_add_contact_tag',
    description: 'Add one or more tags to a contact.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['contactId', 'tags'],
    },
  },

  {
    name: 'ghl_add_contact_note',
    description: 'Add a note to a contact record.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        body: { type: 'string', description: 'Note content' },
      },
      required: ['contactId', 'body'],
    },
  },

  {
    name: 'ghl_get_contact_notes',
    description: 'Get all notes on a contact.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
      },
      required: ['contactId'],
    },
  },

  // ─── CONVERSATIONS ────────────────────────────────────────────────────────────
  {
    name: 'ghl_get_contact_conversations',
    description: 'Get all conversation threads for a contact (SMS, email, calls).',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
      },
      required: ['contactId'],
    },
  },

  {
    name: 'ghl_get_conversation_messages',
    description: 'Get all messages in a conversation thread including call logs and durations.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string' },
        limit: { type: 'number', description: 'Max messages to return (default 100)' },
      },
      required: ['conversationId'],
    },
  },

  {
    name: 'ghl_send_sms',
    description: 'Send an SMS message to a contact.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['contactId', 'message'],
    },
  },

  // ─── ACTIVITIES / CALL LOGS ───────────────────────────────────────────────────
  {
    name: 'ghl_get_contact_activities',
    description: `Get activity timeline for a contact including call attempts,
      call durations, SMS sent/received, emails, and notes. Use this to
      determine number of call attempts and whether any were >1 minute.`,
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
      },
      required: ['contactId'],
    },
  },

  // ─── PIPELINES & OPPORTUNITIES ────────────────────────────────────────────────
  {
    name: 'ghl_get_pipelines',
    description: 'Get all pipelines and their stages.',
    inputSchema: { type: 'object', properties: {} },
  },

  {
    name: 'ghl_get_opportunities',
    description: 'Get opportunities/deals from a pipeline, optionally filtered by stage.',
    inputSchema: {
      type: 'object',
      properties: {
        pipelineId: { type: 'string' },
        stageId: { type: 'string', description: 'Optional: filter by specific stage' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },

  {
    name: 'ghl_move_opportunity',
    description: 'Move an opportunity/deal to a different pipeline stage.',
    inputSchema: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string' },
        stageId: { type: 'string' },
      },
      required: ['opportunityId', 'stageId'],
    },
  },

  // ─── CALENDARS ────────────────────────────────────────────────────────────────
  {
    name: 'ghl_get_calendars',
    description: 'List all calendars in the location.',
    inputSchema: { type: 'object', properties: {} },
  },

  {
    name: 'ghl_get_appointments',
    description: 'Get appointments/events for a calendar in a date range.',
    inputSchema: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        startTime: { type: 'string', description: 'ISO datetime' },
        endTime: { type: 'string', description: 'ISO datetime' },
      },
      required: ['calendarId', 'startTime', 'endTime'],
    },
  },

  {
    name: 'ghl_create_appointment',
    description: 'Book an appointment for a contact on a calendar.',
    inputSchema: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        contactId: { type: 'string' },
        startTime: { type: 'string', description: 'ISO datetime' },
        endTime: { type: 'string', description: 'ISO datetime' },
        title: { type: 'string' },
      },
      required: ['calendarId', 'contactId', 'startTime', 'endTime', 'title'],
    },
  },

  // ─── TASKS ────────────────────────────────────────────────────────────────────
  {
    name: 'ghl_create_task',
    description: 'Create a follow-up task or callback reminder for a contact in GHL.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        title: { type: 'string', description: 'Task title e.g. "Callback reminder - Ed Simon"' },
        dueDate: { type: 'string', description: 'ISO datetime for due date' },
        description: { type: 'string', description: 'Additional notes for the task' },
      },
      required: ['contactId', 'title', 'dueDate'],
    },
  },

  {
    name: 'ghl_get_tasks',
    description: 'Get all open tasks for a contact.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
      },
      required: ['contactId'],
    },
  },

  // ─── WORKFLOWS ────────────────────────────────────────────────────────────────
  {
    name: 'ghl_get_workflows',
    description: 'List all automation workflows.',
    inputSchema: { type: 'object', properties: {} },
  },

  {
    name: 'ghl_add_to_workflow',
    description: 'Enroll a contact into an automation workflow (drip sequence).',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        workflowId: { type: 'string' },
      },
      required: ['contactId', 'workflowId'],
    },
  },

  {
    name: 'ghl_remove_from_workflow',
    description: 'Remove a contact from an automation workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        workflowId: { type: 'string' },
      },
      required: ['contactId', 'workflowId'],
    },
  },

  // ─── TAGS & CUSTOM FIELDS ─────────────────────────────────────────────────────
  {
    name: 'ghl_get_tags',
    description: 'Get all tags defined in the location.',
    inputSchema: { type: 'object', properties: {} },
  },

  {
    name: 'ghl_get_custom_fields',
    description: 'Get all custom field definitions for the location.',
    inputSchema: { type: 'object', properties: {} },
  },

  {
    name: 'ghl_update_custom_field',
    description: 'Update custom field values on a contact.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        customFields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              value: { type: 'string' },
            },
          },
        },
      },
      required: ['contactId', 'customFields'],
    },
  },
];
