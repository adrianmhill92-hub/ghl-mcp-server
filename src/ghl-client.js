import axios from 'axios';

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

export function createGHLClient(apiKey, locationId) {
  const client = axios.create({
    baseURL: GHL_BASE_URL,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: 30000,
  });

  // Retry on 429 + log GHL error bodies for easier debugging
  client.interceptors.response.use(null, async (error) => {
    if (error.response?.status === 429) {
      const retryAfter = parseInt(error.response.headers['retry-after'] || '2') * 1000;
      await new Promise(r => setTimeout(r, retryAfter));
      return client.request(error.config);
    }
    if (error.response) {
      console.error(
        `GHL API ${error.response.status} on ${error.config?.method?.toUpperCase()} ${error.config?.url}:`,
        JSON.stringify(error.response.data)
      );
    }
    throw error;
  });

  return {
    // ─── CONTACTS ────────────────────────────────────────────────────────────

    async searchContacts({ query, tags, startDate, endDate, limit = 100, skip = 0 }) {
      // GHL v2 uses POST /contacts/search with a structured filters body.
      const filters = [];

      if (startDate || endDate) {
        const gte = startDate ? new Date(startDate).toISOString() : undefined;
        const lte = endDate
          ? new Date(`${endDate}T23:59:59.999Z`).toISOString()
          : undefined;

        filters.push({
          field: 'dateAdded',
          operator: 'range',
          value: { ...(gte && { gte }), ...(lte && { lte }) },
        });
      }

      if (tags?.length) {
        filters.push({
          field: 'tags',
          operator: 'contains',
          value: tags,
        });
      }

      const body = {
        locationId,
        pageLimit: limit,
        page: Math.floor(skip / limit) + 1,
        filters,
      };

      if (query) body.query = query;

      const res = await client.post('/contacts/search', body);
      return res.data;
    },

    async getContact(contactId) {
      const res = await client.get(`/contacts/${contactId}`);
      return res.data;
    },

    async getContactsByPipeline(pipelineId, stageId) {
      const params = { location_id: locationId, pipeline_id: pipelineId };
      if (stageId) params.pipeline_stage_id = stageId;
      const res = await client.get('/opportunities/search', { params });
      return res.data;
    },

    async updateContactStage(contactId, pipelineId, stageId) {
      const res = await client.patch(`/contacts/${contactId}`, {
        pipelineId,
        pipelineStageId: stageId,
      });
      return res.data;
    },

    async addContactTag(contactId, tags) {
      const res = await client.post(`/contacts/${contactId}/tags`, { tags });
      return res.data;
    },

    async addContactNote(contactId, body) {
      const res = await client.post(`/contacts/${contactId}/notes`, { body, userId: '' });
      return res.data;
    },

    async getContactNotes(contactId) {
      const res = await client.get(`/contacts/${contactId}/notes`);
      return res.data;
    },

    // ─── CONVERSATIONS & MESSAGES ────────────────────────────────────────────

    async getContactConversations(contactId) {
      const res = await client.get('/conversations/search', {
        params: { locationId, contactId },
      });
      return res.data;
    },

    async getConversationMessages(conversationId, limit = 100) {
      const res = await client.get(`/conversations/${conversationId}/messages`, {
        params: { limit },
      });
      return res.data;
    },

    async sendSMS(contactId, message) {
      const convData = await this.getContactConversations(contactId);
      let conversationId = convData?.conversations?.[0]?.id;

      if (!conversationId) {
        const newConv = await client.post('/conversations/', {
          locationId,
          contactId,
        });
        conversationId = newConv.data.conversation.id;
      }

      const res = await client.post(`/conversations/messages`, {
        type: 'SMS',
        conversationId,
        locationId,
        contactId,
        message,
      });
      return res.data;
    },

    // ─── CALL LOGS / ACTIVITIES ───────────────────────────────────────────────

    async getContactActivities(contactId) {
      const res = await client.get(`/contacts/${contactId}/activities`);
      return res.data;
    },

    // ─── PIPELINES & OPPORTUNITIES ───────────────────────────────────────────

    async getPipelines() {
      const res = await client.get('/opportunities/pipelines', {
        params: { locationId },
      });
      return res.data;
    },

    async getOpportunities({
      pipelineId,
      stageId,
      status,
      startDate,
      endDate,
      limit = 100,
      startAfter,
      startAfterId,
      fetchAll = false,
      maxPages = 20,
    } = {}) {
      // Build the params GHL's /opportunities/search expects.
      const buildParams = (cursor) => {
        const p = { location_id: locationId, limit };
        if (pipelineId) p.pipeline_id = pipelineId;
        if (stageId) p.pipeline_stage_id = stageId;
        if (status) p.status = status;                 // open | won | lost | abandoned | all
        if (startDate) p.date = startDate;             // MM-DD-YYYY; means updatedAt >=
        if (endDate) p.endDate = endDate;              // GHL ignores server-side; we enforce client-side below
        if (cursor) {
          p.startAfter = cursor.startAfter;
          p.startAfterId = cursor.startAfterId;
        } else {
          if (startAfter !== undefined) p.startAfter = startAfter;
          if (startAfterId !== undefined) p.startAfterId = startAfterId;
        }
        return p;
      };

      const fetchPage = async (cursor) => {
        const res = await client.get('/opportunities/search', { params: buildParams(cursor) });
        return res.data;
      };

      // Single-page mode — returns GHL's native response incl. meta.startAfter/startAfterId
      if (!fetchAll) {
        return await fetchPage();
      }

      // Multi-page mode — walk the cursor until exhausted or maxPages hit.
      // GHL ignores endDate server-side, so enforce it client-side by filtering on createdAt.
      const endDateTs = endDate ? parseMMDDYYYYEndOfDay(endDate) : null;

      const allOps = [];
      let pagesFetched = 0;
      let cursor;
      let lastMeta = null;

      while (pagesFetched < maxPages) {
        const data = await fetchPage(cursor);
        lastMeta = data.meta;
        pagesFetched += 1;

        const ops = data.opportunities || [];
        const filtered = endDateTs == null
          ? ops
          : ops.filter((op) => {
              const t = Date.parse(op.createdAt || op.dateAdded || '');
              return Number.isFinite(t) ? t <= endDateTs : true;
            });

        allOps.push(...filtered);

        if (!data.meta?.startAfter || !data.meta?.startAfterId || !data.meta?.nextPage) {
          break;
        }

        cursor = {
          startAfter: data.meta.startAfter,
          startAfterId: data.meta.startAfterId,
        };
      }

      return {
        opportunities: allOps,
        meta: {
          total: lastMeta?.total ?? allOps.length,
          returned: allOps.length,
          pagesFetched,
          truncated: pagesFetched >= maxPages && !!lastMeta?.nextPage,
          endDateApplied: endDate ?? null,
        },
      };
    },

    async moveOpportunity(opportunityId, stageId) {
      const res = await client.patch(`/opportunities/${opportunityId}`, {
        pipelineStageId: stageId,
      });
      return res.data;
    },

    // ─── CALENDARS ────────────────────────────────────────────────────────────

    async getCalendars() {
      const res = await client.get('/calendars/', { params: { locationId } });
      return res.data;
    },

    async getCalendarAppointments(calendarId, startTime, endTime) {
      const res = await client.get('/calendars/events', {
        params: { locationId, calendarId, startTime, endTime },
      });
      return res.data;
    },

    async createAppointment({ calendarId, contactId, startTime, endTime, title }) {
      const res = await client.post('/calendars/events/appointments', {
        locationId, calendarId, contactId, startTime, endTime, title,
      });
      return res.data;
    },

    // ─── TAGS ─────────────────────────────────────────────────────────────────

    async getTags() {
      const res = await client.get(`/locations/${locationId}/tags`);
      return res.data;
    },

    // ─── TASKS ────────────────────────────────────────────────────────────────

    async createTask(contactId, { title, dueDate, description }) {
      const res = await client.post(`/contacts/${contactId}/tasks`, {
        title,
        dueDate,
        description,
        completed: false,
        assignedTo: '',
      });
      return res.data;
    },

    async getTasks(contactId) {
      const res = await client.get(`/contacts/${contactId}/tasks`);
      return res.data;
    },

    // ─── WORKFLOWS ────────────────────────────────────────────────────────────

    async getWorkflows() {
      const res = await client.get('/workflows/', { params: { locationId } });
      return res.data;
    },

    async addContactToWorkflow(contactId, workflowId) {
      const res = await client.post(`/contacts/${contactId}/workflow/${workflowId}`, {
        eventStartTime: new Date().toISOString(),
      });
      return res.data;
    },

    async removeContactFromWorkflow(contactId, workflowId) {
      const res = await client.delete(`/contacts/${contactId}/workflow/${workflowId}`);
      return res.data;
    },

    // ─── CUSTOM FIELDS ────────────────────────────────────────────────────────

    async getCustomFields() {
      const res = await client.get(`/locations/${locationId}/customFields`);
      return res.data;
    },

    async updateCustomField(contactId, customFields) {
      const res = await client.put(`/contacts/${contactId}`, { customFields });
      return res.data;
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Parses MM-DD-YYYY to an end-of-day UTC timestamp in ms.
function parseMMDDYYYYEndOfDay(s) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const t = Date.parse(`${yyyy}-${mm}-${dd}T23:59:59.999Z`);
  return Number.isFinite(t) ? t : null;
}
