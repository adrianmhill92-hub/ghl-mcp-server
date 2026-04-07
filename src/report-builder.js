// Builds the lead performance report from raw GHL data
// Mirrors the Hawaii Wellness Clinic report format exactly

const pct = (num, denom) => denom > 0 ? `${Math.round((num / denom) * 100)}%` : '0%';

/**
 * Analyzes call messages to extract:
 * - Number of call attempts
 * - Duration of each call
 * - Whether any call was a legitimate connection (>1 min)
 */
export function analyzeCallData(messages) {
  const calls = (messages || []).filter(m =>
    m.messageType === 'TYPE_CALL' || m.type === 'call' || m.contentType === 'call'
  );

  const callAttempts = calls.map(call => {
    const duration = call.meta?.duration || call.duration || 0; // seconds
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    return {
      duration,
      durationFormatted: `${mins}:${String(secs).padStart(2, '0')}`,
      connected: duration > 60,
      direction: call.direction || 'outbound',
      date: call.dateAdded || call.createdAt,
    };
  });

  const legitimateConnections = callAttempts.filter(c => c.connected);

  return {
    totalAttempts: callAttempts.length,
    callAttempts,
    connected: legitimateConnections.length > 0,
    connectionCount: legitimateConnections.length,
    durations: callAttempts.map(c => c.durationFormatted),
    longestCall: callAttempts.reduce((max, c) => c.duration > max ? c.duration : max, 0),
  };
}

/**
 * Determines lead status based on call data, tags, and pipeline stage
 */
export function classifyLeadStatus(contact, callData, messages, notes) {
  const tags = contact.tags || [];
  const stageName = contact.pipelineStage?.name || '';

  // DND check
  if (contact.dnd || tags.includes('DND') || tags.includes('stop')) {
    return { status: 'Lost --- DND', priority: 'none' };
  }

  // Lost checks
  if (stageName.toLowerCase().includes('lost') || tags.includes('lost')) {
    const lostReason = tags.find(t => ['insurance', 'price', 'abandoned'].includes(t.toLowerCase()));
    return { status: `Lost --- ${lostReason || 'Disqualified'}`, priority: 'none' };
  }

  // Booked check
  if (stageName.toLowerCase().includes('booked') || stageName.toLowerCase().includes('consult')) {
    return { status: 'Booked --- Consult', priority: 'high' };
  }

  // Connected check
  if (callData.connected) {
    if (callData.longestCall >= 600) { // 10+ min call
      return { status: 'Active Communication', priority: 'high' };
    }
    return { status: 'Warm --- Callback Pending', priority: 'high' };
  }

  // Check for text/message responses from lead
  const inboundMessages = (messages || []).filter(m => m.direction === 'inbound');
  if (inboundMessages.length > 0) {
    return { status: 'Warm --- Responded', priority: 'medium' };
  }

  // Nurture classification by attempt count
  const attempts = callData.totalAttempts;
  if (attempts === 0) return { status: 'Nurture --- New', priority: 'low' };
  if (attempts === 1) return { status: 'Nurture --- 1st Attempt', priority: 'low' };
  if (attempts === 2) return { status: 'Nurture --- 2nd Attempt', priority: 'low' };
  return { status: `Nurture --- ${attempts}rd Attempt`, priority: 'low' };
}

/**
 * Generates next action recommendation based on status and contact data
 */
export function generateNextAction(status, callData, contact) {
  const name = contact.firstName || 'Lead';

  if (status.includes('DND')) return 'DND enabled — archive all channels. No further outreach.';
  if (status.includes('Lost')) return 'Mark lost in pipeline. No further action unless circumstances change.';
  if (status.includes('Booked')) return `Confirm appointment, send intake form and pre-consult materials to ${name}.`;
  if (status.includes('Callback Pending')) return `Create GHL callback task. Call proactively if no contact within 24 hours.`;
  if (status.includes('Active Communication')) return `Review call notes. Send financing options (Affirm/6-pack). Push for consult booking.`;
  if (status.includes('Warm --- Responded')) return 'Answer their question, provide pricing + Affirm options, push for consult booking.';

  const attempts = callData.totalAttempts;
  if (attempts === 0) return 'Automated follow-up active. No human reply yet.';
  if (attempts === 1) return 'Schedule 2nd call attempt within 24–48 hours.';
  if (attempts === 2) return 'Continue drip sequence. Try SMS engagement.';
  if (attempts >= 3) return `3+ attempts with no connection. Send personal text: "Is this still a priority for you?"`;

  return 'Continue nurture sequence.';
}

/**
 * Builds the full structured report from an array of contact data objects
 */
export function buildReport({ contacts, startDate, endDate, preparedDate }) {
  const leads = contacts.map((item, index) => {
    const { contact, callData, messages, notes } = item;
    const { status, priority } = classifyLeadStatus(contact, callData, messages, notes);
    const nextAction = generateNextAction(status, callData, contact);

    const createdDate = new Date(contact.dateAdded || contact.createdAt);
    const createdFormatted = isNaN(createdDate.getTime())
      ? 'Unknown'
      : createdDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    return {
      number: index + 1,
      id: contact.id,
      name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unnamed Contact',
      created: createdFormatted,
      callAttempts: callData.totalAttempts,
      connected: callData.connected
        ? `Yes (${callData.durations.filter((_, i) => callData.callAttempts[i]?.connected).join('/')})`
        : callData.durations.length > 0
          ? `No (${callData.durations.join('/')})`
          : 'No',
      status,
      nextAction,
      priority,
      rawCallData: callData,
      notes: notes?.notes || [],
    };
  });

  // Executive summary metrics
  const total = leads.length;
  const legitimateConnections = leads.filter(l => l.rawCallData.connected).length;
  const booked = leads.filter(l => l.status.includes('Booked')).length;
  const activeNurture = leads.filter(l => l.status.includes('Nurture')).length;
  const warmActive = leads.filter(l => l.status.includes('Warm') || l.status.includes('Active')).length;
  const lost = leads.filter(l => l.status.includes('Lost')).length;
  const totalCalls = leads.reduce((sum, l) => sum + l.rawCallData.totalAttempts, 0);
  const avgCallAttempts = total > 0 ? (totalCalls / total).toFixed(1) : '0.0';
  const highPriority = leads.filter(l => l.priority === 'high');

  // Call distribution
  const callDist = [0, 1, 2, 3, 4].map(n => ({
    attempts: n === 4 ? '4+' : String(n),
    count: leads.filter(l => n === 4 ? l.rawCallData.totalAttempts >= 4 : l.rawCallData.totalAttempts === n).length,
  }));

  return {
    reportingPeriod: `${startDate} – ${endDate}`,
    preparedDate: preparedDate || new Date().toLocaleDateString(),
    summary: {
      total,
      legitimateConnections,
      connectionRate: pct(legitimateConnections, total),
      booked,
      bookingRate: pct(booked, total),
      activeNurture,
      warmActive,
      lost,
      lostRate: pct(lost, total),
      avgCallAttempts,
      highPriorityCount: highPriority.length,
    },
    leads,
    highPriority: highPriority.map(l => ({ name: l.name, action: l.nextAction })),
    mediumPriority: leads.filter(l => l.priority === 'medium').map(l => ({ name: l.name, action: l.nextAction })),
    callDistribution: callDist,
    analytics: {
      connectionRate: pct(legitimateConnections, total),
      avgCallAttempts,
      leadsWithAnyCall: leads.filter(l => l.rawCallData.totalAttempts > 0).length,
    },
  };
}

/**
 * Formats the report as a clean markdown string for Claude to present
 */
export function formatReportAsMarkdown(report) {
  const s = report.summary;
  const lines = [];

  lines.push(`# HAWAII WELLNESS CLINIC`);
  lines.push(`## Weekly Lead Performance Report`);
  lines.push(`**Reporting Period:** ${report.reportingPeriod} | **Prepared:** ${report.preparedDate}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 1. Executive Summary');
  lines.push('');
  lines.push(`| Metric | Value | Notes |`);
  lines.push(`|--------|-------|-------|`);
  lines.push(`| Total Leads | **${s.total}** | All from Smart List |`);
  lines.push(`| Legitimate Connections (>1 min) | **${s.legitimateConnections}** | ${s.connectionRate} connection rate |`);
  lines.push(`| Consultations Booked | **${s.booked}** | ${s.bookingRate} booking rate |`);
  lines.push(`| Active Nurture | **${s.activeNurture}** | In drip sequence |`);
  lines.push(`| Warm / Responded / Active | **${s.warmActive}** | Verbal or text engagement |`);
  lines.push(`| Lost / DND / Abandoned | **${s.lost}** | ${s.lostRate} disqualified |`);
  lines.push(`| Avg. Call Attempts Per Lead | **~${s.avgCallAttempts}** | Target: 3–5 per lead |`);
  lines.push(`| High-Priority Follow-Up Needed | **${s.highPriorityCount}** | Require immediate action |`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 2. Lead-by-Lead Status');
  lines.push('');
  lines.push('| # | Name | Created | Calls | Connected? | Status | Next Action |');
  lines.push('|---|------|---------|-------|-----------|--------|-------------|');

  for (const lead of report.leads) {
    lines.push(
      `| ${lead.number} | **${lead.name}** | ${lead.created} | ${lead.callAttempts} | ${lead.connected} | **${lead.status}** | ${lead.nextAction} |`
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 3. Priority Follow-Up List');
  lines.push('');
  lines.push('### 3a. High Priority — Act Today');
  lines.push('');
  if (report.highPriority.length === 0) {
    lines.push('_None_');
  } else {
    for (const item of report.highPriority) {
      lines.push(`- **${item.name}**: ${item.action}`);
    }
  }

  lines.push('');
  lines.push('### 3b. Medium Priority — This Week');
  lines.push('');
  if (report.mediumPriority.length === 0) {
    lines.push('_None_');
  } else {
    for (const item of report.mediumPriority) {
      lines.push(`- **${item.name}**: ${item.action}`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 4. Analytics');
  lines.push('');
  lines.push('### Call Attempt Distribution');
  lines.push('');
  lines.push('| Call Attempts | # of Leads | % of Total |');
  lines.push('|--------------|-----------|-----------|');
  for (const row of report.callDistribution) {
    const rowPct = report.summary.total > 0
      ? `${Math.round((row.count / report.summary.total) * 100)}%`
      : '0%';
    lines.push(`| ${row.attempts} | ${row.count} | ${rowPct} |`);
  }

  lines.push('');
  lines.push(`**Connection Rate:** ${report.analytics.connectionRate}`);
  lines.push(`**Avg Call Attempts:** ${report.analytics.avgCallAttempts}`);
  lines.push(`**Leads with Any Call:** ${report.analytics.leadsWithAnyCall}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`*End of Report — Hawaii Wellness Clinic — ${report.reportingPeriod}*`);
  lines.push(`*Prepared by Hawaii Wellness Clinic AI System*`);

  return lines.join('\n');
}
