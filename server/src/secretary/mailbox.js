import { addDays, now, toIsoDate } from '../utils/dates.js';

/**
 * Mock mailbox and calendar.
 *
 * A synthetic inbox for a production manager at a vehicle plant: supplier
 * delays, maintenance reports, quality escalations, HR notices, meeting
 * invites and IT notices, spread over the last five days relative to the
 * configured reference date. It implements the same interface the live
 * Microsoft 365 connector exposes (listMail, getMail, updateMail, listEvents,
 * sendReply), so the secretary routes and the agent tools do not know which
 * one is answering. Nothing here is real: names, addresses and contents are
 * invented, which is what the security constraint requires until the client
 * grants a scoped mailbox.
 */

export const MAILBOX_OWNER = { name: 'Mara Keller', email: 'mara.keller@plant.example' };

export const MAIL_CATEGORIES = ['supplier', 'maintenance', 'quality', 'hr', 'meeting', 'it', 'other'];

/** ISO timestamp `daysAgo` days before the reference date at the given time. */
const at = (daysAgo, time) => {
  const day = toIsoDate(addDays(now(), -daysAgo));
  return `${day}T${time}:00Z`;
};

const preview = (body) => body.replace(/\s+/g, ' ').trim().slice(0, 140);

/** Seed definition: everything the mutable state is rebuilt from. */
const SEED_MAIL = [
  {
    id: 'mail_001',
    from: { name: 'Stefan Brandl', email: 's.brandl@nordkabel.example' },
    subject: 'Delivery delay WH-4410 wiring harness - revised ETA',
    receivedAt: at(0, '07:42'),
    category: 'supplier',
    read: false,
    flagged: true,
    needsReply: true,
    attachments: [{ name: 'Nordkabel_ETA_WH-4410.pdf', size: 184_322 }],
    body: `Dear Ms Keller,

the batch of WH-4410 harnesses scheduled for tomorrow will arrive one day late because of a customs hold at the border. We expect the truck on site by 10:00 the day after. Please confirm whether a partial delivery of 320 units this evening would help bridge the gap on Final Assembly 1.

Best regards
Stefan Brandl, Nordkabel AG`,
  },
  {
    id: 'mail_002',
    from: { name: 'Integral Portal', email: 'noreply@integral.internal' },
    subject: 'Maintenance report: Torque station T7 - calibration completed',
    receivedAt: at(0, '06:15'),
    category: 'maintenance',
    read: false,
    flagged: false,
    needsReply: false,
    attachments: [{ name: 'MT-report-T7.pdf', size: 92_110 }],
    body: `Ticket MT-0412 on asset AS-311 (Torque station T7, Final Assembly 1) was closed at 05:48 by Team B. Calibration after tool change completed; torque readings within tolerance on 20 reference bolts. No follow-up required.`,
  },
  {
    id: 'mail_003',
    from: { name: 'Jonas Vogel', email: 'jonas.vogel@plant.example' },
    subject: 'Quality escalation: E-7781 brake line leak on FA2 - containment proposal',
    receivedAt: at(0, '08:05'),
    category: 'quality',
    read: false,
    flagged: true,
    needsReply: true,
    attachments: [{ name: 'E-7781_containment.xlsx', size: 48_770 }],
    body: `Mara,

we had three E-7781 detections at the roller test bench on the night shift. All three vehicles are on quality hold. I propose a 100% pressure check on BL-77 connections for the next two shifts and a supplier 8D request to HydroBrake. Can you approve the extra inspection time so I can brief the early shift?

Jonas`,
  },
  {
    id: 'mail_004',
    from: { name: 'Petra Lindqvist', email: 'petra.lindqvist@plant.example' },
    subject: 'Invitation: Weekly quality review - Thursday 14:00',
    receivedAt: at(0, '09:20'),
    category: 'meeting',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [],
    body: `The weekly quality review moves to Thursday 14:00 this week, room B2.14 and Teams. Agenda: open critical issues, E-7781 containment, paint rework trend on Paint Line 2. Please bring the shift figures.`,
  },
  {
    id: 'mail_005',
    from: { name: 'IT Service Desk', email: 'servicedesk@plant.example' },
    subject: 'Planned maintenance: Power BI gateway, Saturday 22:00-02:00',
    receivedAt: at(0, '10:02'),
    category: 'it',
    read: false,
    flagged: false,
    needsReply: false,
    attachments: [],
    body: `The on-premises data gateway for the Manufacturing Analytics workspace will be patched on Saturday between 22:00 and 02:00. Reports will show stale data during the window. No action is required.`,
  },
  {
    id: 'mail_006',
    from: { name: 'Anneke de Vries', email: 'a.devries@sealtech.example' },
    subject: 'FDS-220 door seal: corrective action report and replacement batch',
    receivedAt: at(1, '15:30'),
    category: 'supplier',
    read: false,
    flagged: false,
    needsReply: true,
    attachments: [{ name: 'SealTech_8D_FDS-220.pdf', size: 402_118 }],
    body: `Dear Ms Keller,

attached is the 8D report for the FDS-220 seating problem (your E-8150 occurrences). Root cause was a worn forming die; the replacement batch ships Friday. Please let us know whether you want the suspect lot 2241 collected or scrapped on site.

Kind regards
Anneke de Vries, SealTech AG`,
  },
  {
    id: 'mail_007',
    from: { name: 'HR Plant Services', email: 'hr@plant.example' },
    subject: 'Shift schedule confirmation for the next period',
    receivedAt: at(1, '11:10'),
    category: 'hr',
    read: true,
    flagged: false,
    needsReply: true,
    attachments: [{ name: 'Shift_plan_next_period.pdf', size: 66_004 }],
    body: `Please review and confirm the attached shift plan for your area by Friday noon. Two open positions on the late shift of Final Assembly 2 are still unfilled; let us know if you want them covered by agency staff.`,
  },
  {
    id: 'mail_008',
    from: { name: 'Integral Portal', email: 'noreply@integral.internal' },
    subject: 'Open ticket reminder: Paint atomizer A4 - sensor replacement overdue',
    receivedAt: at(1, '06:30'),
    category: 'maintenance',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [],
    body: `Ticket MT-0398 on asset AS-204 (Paint atomizer A4, Paint Line 2) has been open for 3 days. Priority high. Assigned to Team A. Last note: waiting for spare part.`,
  },
  {
    id: 'mail_009',
    from: { name: 'Lena Brandt', email: 'lena.brandt@plant.example' },
    subject: 'Handover notes early shift - Paint Line 2 orange peel',
    receivedAt: at(1, '14:05'),
    category: 'quality',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [],
    body: `Six E-2051 orange peel findings at CP-22 today, all on the C-Class. Booth humidity was above setpoint between 09:00 and 11:00; facilities adjusted the dehumidifier. In-line rework handled all six.`,
  },
  {
    id: 'mail_010',
    from: { name: 'Markus Hofer', email: 'markus.hofer@plant.example' },
    subject: 'Plant walk tomorrow 13:00 - route proposal',
    receivedAt: at(1, '16:45'),
    category: 'meeting',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [],
    body: `Proposed route for the plant walk: Body Shop geometry station, Paint Line 2 inspection, Final Assembly 1 electrical test, roller bench FA2. About 60 minutes. Shout if you want to add a stop.`,
  },
  {
    id: 'mail_011',
    from: { name: 'Elektron Systems', email: 'support@elektron.example' },
    subject: 'ECU-9 flash failures: firmware package 4.2.1 available',
    receivedAt: at(2, '09:55'),
    category: 'supplier',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [{ name: 'ECU-9_release_notes_4.2.1.pdf', size: 120_540 }],
    body: `Firmware 4.2.1 fixes the aborted flash sequence reported under E-6233. The package is available on the supplier portal; your electrical test team can load it at CP-35 without a line stop.`,
  },
  {
    id: 'mail_012',
    from: { name: 'Petra Lindqvist', email: 'petra.lindqvist@plant.example' },
    subject: 'Re: E-1042 torque deviations on Body Shop Line 1',
    receivedAt: at(2, '13:20'),
    category: 'quality',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [],
    body: `Thanks for the quick response. The TQ-18 fixture was re-calibrated and the deviations stopped after the late shift. I will keep the station on the watch list for the week.`,
  },
  {
    id: 'mail_013',
    from: { name: 'IT Service Desk', email: 'servicedesk@plant.example' },
    subject: 'Action required: password expires in 5 days',
    receivedAt: at(2, '07:00'),
    category: 'it',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [],
    body: `Your network password expires in 5 days. Change it through the self-service portal before it expires to avoid losing access to Teams and Power BI.`,
  },
  {
    id: 'mail_014',
    from: { name: 'HR Plant Services', email: 'hr@plant.example' },
    subject: 'Reminder: annual safety training due this month',
    receivedAt: at(2, '08:40'),
    category: 'hr',
    read: false,
    flagged: false,
    needsReply: false,
    attachments: [],
    body: `Four colleagues on your team have not completed the annual safety training. The deadline is the end of the month; sessions run daily at 13:00 in training room A1.`,
  },
  {
    id: 'mail_015',
    from: { name: 'Thomas Reuter', email: 'thomas.reuter@plant.example' },
    subject: 'Request: downtime figures for the management meeting',
    receivedAt: at(2, '17:05'),
    category: 'other',
    read: true,
    flagged: true,
    needsReply: true,
    attachments: [],
    body: `Mara, could you send me the downtime per line for last week and the top three stop reasons? The plant management meeting is on Friday and I would like to include it on one slide.

Thomas`,
  },
  {
    id: 'mail_016',
    from: { name: 'Integral Portal', email: 'noreply@integral.internal' },
    subject: 'Maintenance report: Welding robot R12 - hydraulic leak repaired',
    receivedAt: at(3, '05:50'),
    category: 'maintenance',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [{ name: 'MT-report-R12.pdf', size: 88_421 }],
    body: `Ticket MT-0371 on asset AS-101 (Welding robot R12, Body Shop Line 1) closed by Team C. Hydraulic hose replaced, 42 minutes downtime recorded. Preventive check of the sister robot scheduled.`,
  },
  {
    id: 'mail_017',
    from: { name: 'Lumen Industries', email: 'orders@lumen.example' },
    subject: 'HL-302 headlamp modules: order confirmation and schedule',
    receivedAt: at(3, '10:25'),
    category: 'supplier',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [{ name: 'Order_confirmation_HL-302.pdf', size: 54_201 }],
    body: `We confirm the call-off of 1,200 HL-302 modules for next week, delivered in three daily batches starting Monday. Alignment tolerances per the updated drawing revision D.`,
  },
  {
    id: 'mail_018',
    from: { name: 'Markus Hofer', email: 'markus.hofer@plant.example' },
    subject: 'Invitation: 1:1 Mara / Markus',
    receivedAt: at(3, '12:00'),
    category: 'meeting',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [],
    body: `Our regular 1:1 this week. Topics from my side: late shift staffing on FA2, the Jervis pilot feedback, and the budget for the second roller bench.`,
  },
  {
    id: 'mail_019',
    from: { name: 'Jonas Vogel', email: 'jonas.vogel@plant.example' },
    subject: 'Weekly first pass yield - Paint Line 2 below target',
    receivedAt: at(3, '15:40'),
    category: 'quality',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [{ name: 'FPY_week_summary.xlsx', size: 31_900 }],
    body: `First pass yield on Paint Line 2 was below target for the second week, driven by E-2051 and E-5007. I have asked facilities for the booth humidity log and will present options at the quality review.`,
  },
  {
    id: 'mail_020',
    from: { name: 'IT Service Desk', email: 'servicedesk@plant.example' },
    subject: 'Resolved: Teams audio issues in meeting room B2.14',
    receivedAt: at(4, '09:15'),
    category: 'it',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [],
    body: `The audio device in B2.14 has been replaced. If problems persist, reply to this ticket (INC-55731).`,
  },
  {
    id: 'mail_021',
    from: { name: 'Fixture Systems GmbH', email: 'service@fixturesystems.example' },
    subject: 'TQ-18 torque fixture: service visit proposal',
    receivedAt: at(4, '11:30'),
    category: 'supplier',
    read: false,
    flagged: false,
    needsReply: true,
    attachments: [],
    body: `Following the recent torque deviations we can offer an on-site service visit for the TQ-18 fixtures next Tuesday or Wednesday. Please let us know which day suits the Body Shop; the visit takes about three hours per station.`,
  },
  {
    id: 'mail_022',
    from: { name: 'HR Plant Services', email: 'hr@plant.example' },
    subject: 'New colleague starting Monday - Final Assembly 1',
    receivedAt: at(4, '13:05'),
    category: 'hr',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [],
    body: `A new process engineer joins Final Assembly 1 on Monday. Please arrange the shop-floor induction and the Power BI access request with IT.`,
  },
  {
    id: 'mail_023',
    from: { name: 'Thomas Reuter', email: 'thomas.reuter@plant.example' },
    subject: 'FYI: Plant management meeting agenda',
    receivedAt: at(4, '16:20'),
    category: 'other',
    read: true,
    flagged: false,
    needsReply: false,
    attachments: [{ name: 'Agenda_plant_management.docx', size: 22_380 }],
    body: `Agenda for Friday: production volume, quality KPIs per line, downtime review, Jervis pilot status, staffing. Ten minutes per topic.`,
  },
  {
    id: 'mail_024',
    from: { name: 'Integral Portal', email: 'noreply@integral.internal' },
    subject: 'Scheduled: preventive maintenance Conveyor segment C9 - Sunday',
    receivedAt: at(4, '06:05'),
    category: 'maintenance',
    read: false,
    flagged: false,
    needsReply: false,
    attachments: [],
    body: `Preventive maintenance on asset AS-505 (Conveyor segment C9, Final Assembly 1) is scheduled for Sunday 08:00-12:00. The line is not planned to run during that window.`,
  },
];

/** Calendar seed: offsets in days from the reference date. */
const SEED_EVENTS = [
  {
    id: 'evt_001',
    dayOffset: 0,
    start: '05:45',
    end: '06:15',
    title: 'Shift handover night -> early',
    location: 'Final Assembly 1, team corner',
    attendees: ['Lena Brandt', 'Shift leads FA1/FA2'],
    organizer: MAILBOX_OWNER.name,
    isOnline: false,
  },
  {
    id: 'evt_002',
    dayOffset: 0,
    start: '09:00',
    end: '09:30',
    title: 'Supplier call: Nordkabel - WH-4410 delivery',
    location: 'Teams',
    attendees: ['Stefan Brandl (Nordkabel)', 'Logistics planning'],
    organizer: MAILBOX_OWNER.name,
    isOnline: true,
  },
  {
    id: 'evt_003',
    dayOffset: 0,
    start: '13:00',
    end: '14:00',
    title: 'Plant walk with Markus Hofer',
    location: 'Body Shop -> Paint -> Final Assembly',
    attendees: ['Markus Hofer'],
    organizer: 'Markus Hofer',
    isOnline: false,
  },
  {
    id: 'evt_004',
    dayOffset: 1,
    start: '10:00',
    end: '10:45',
    title: '1:1 Mara / Markus',
    location: 'Office B2.08',
    attendees: ['Markus Hofer'],
    organizer: 'Markus Hofer',
    isOnline: false,
  },
  {
    id: 'evt_005',
    dayOffset: 1,
    start: '14:00',
    end: '15:00',
    title: 'Weekly quality review',
    location: 'B2.14 / Teams',
    attendees: ['Petra Lindqvist', 'Jonas Vogel', 'Shift leads'],
    organizer: 'Petra Lindqvist',
    isOnline: true,
  },
  {
    id: 'evt_006',
    dayOffset: 3,
    start: '08:30',
    end: '09:30',
    title: 'Plant management meeting',
    location: 'Conference room A1',
    attendees: ['Thomas Reuter', 'Plant management'],
    organizer: 'Thomas Reuter',
    isOnline: false,
  },
  {
    id: 'evt_007',
    dayOffset: 5,
    start: '09:00',
    end: '12:00',
    title: 'TQ-18 fixture service visit (Body Shop Line 1)',
    location: 'Body Shop Line 1, geometry station',
    attendees: ['Fixture Systems service', 'Body Shop maintenance'],
    organizer: MAILBOX_OWNER.name,
    isOnline: false,
  },
];

let messages = null;

const build = () =>
  SEED_MAIL.map((seed) => ({
    ...seed,
    to: [MAILBOX_OWNER.email],
    preview: preview(seed.body),
    replied: false,
  }));

const all = () => {
  if (!messages) messages = build();
  return messages;
};

/**
 * Free-text relevance: every word has to appear somewhere (order does not
 * matter); a hit on the sender, category or subject outranks one buried in
 * the body, so "the supplier email" finds a supplier's mail before a quality
 * mail that merely mentions a supplier. 0 means no match.
 */
const queryScore = (mail, q) => {
  if (!q) return 1;
  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 1);
  if (tokens.length === 0) return 1;
  const fields = [
    { text: `${mail.from.name} ${mail.from.email}`.toLowerCase(), weight: 4 },
    { text: mail.category.toLowerCase(), weight: 4 },
    { text: mail.subject.toLowerCase(), weight: 3 },
    { text: mail.body.toLowerCase(), weight: 1 },
  ];
  let score = 0;
  for (const token of tokens) {
    const best = Math.max(...fields.map((field) => (field.text.includes(token) ? field.weight : 0)));
    if (best === 0) return 0;
    score += best;
  }
  return score;
};

const FILTERS = {
  all: () => true,
  unread: (mail) => !mail.read,
  needsReply: (mail) => mail.needsReply && !mail.replied,
  flagged: (mail) => mail.flagged,
};

const counts = (rows) => ({
  total: rows.length,
  unread: rows.filter(FILTERS.unread).length,
  needsReply: rows.filter(FILTERS.needsReply).length,
  flagged: rows.filter(FILTERS.flagged).length,
});

/** Shared contract with connectors/microsoft365.connector.js. */
export const mockMailProvider = {
  mode: 'mock',

  /**
   * @param {{ filter?: 'all'|'unread'|'needsReply'|'flagged', q?: string, category?: string, limit?: number }} options
   * @returns {Promise<{ items: object[], total: number, unread: number, needsReply: number, flagged: number }>}
   */
  async listMail({ filter = 'all', q = '', category = null, limit = 20 } = {}) {
    const predicate = FILTERS[filter] ?? FILTERS.all;
    const rows = all()
      .map((mail) => ({ mail, score: predicate(mail) && (!category || mail.category === category) ? queryScore(mail, q) : 0 }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || (a.mail.receivedAt < b.mail.receivedAt ? 1 : -1))
      .map((entry) => entry.mail);
    const summary = counts(all());
    return {
      items: rows.slice(0, Math.max(1, Math.min(100, Number(limit) || 20))),
      total: rows.length,
      inboxTotal: summary.total,
      unread: summary.unread,
      needsReply: summary.needsReply,
      flagged: summary.flagged,
    };
  },

  async getMail(id) {
    return all().find((mail) => mail.id === id) ?? null;
  },

  /** Only read/flagged are client-settable; replied is set by sendReply. */
  async updateMail(id, { read, flagged } = {}) {
    const mail = all().find((entry) => entry.id === id);
    if (!mail) return null;
    if (typeof read === 'boolean') mail.read = read;
    if (typeof flagged === 'boolean') mail.flagged = flagged;
    return mail;
  },

  /**
   * Simulated send: the message is marked replied and read, nothing leaves
   * the server. The route layer has already enforced the explicit confirm.
   */
  async sendReply(id, { body }) {
    const mail = all().find((entry) => entry.id === id);
    if (!mail) return null;
    mail.replied = true;
    mail.read = true;
    mail.lastReply = { body, sentAt: new Date().toISOString(), mode: 'simulated' };
    return { ok: true, mode: 'simulated', id };
  },

  /**
   * @param {{ day?: 'today'|'tomorrow'|string }} options ISO date or keyword
   * @returns {Promise<{ items: object[], day: string }>}
   */
  async listEvents({ day = 'today' } = {}) {
    const iso = resolveDay(day);
    const items = SEED_EVENTS.map((seed) => {
      const date = toIsoDate(addDays(now(), seed.dayOffset));
      return {
        id: seed.id,
        title: seed.title,
        startsAt: `${date}T${seed.start}:00Z`,
        endsAt: `${date}T${seed.end}:00Z`,
        location: seed.location,
        attendees: seed.attendees,
        organizer: seed.organizer,
        isOnline: seed.isOnline,
      };
    })
      .filter((event) => event.startsAt.slice(0, 10) === iso)
      .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
    return { items, day: iso };
  },
};

/** 'today' | 'tomorrow' | 'yesterday' | 'YYYY-MM-DD' -> ISO date, relative to the reference date. */
export const resolveDay = (day) => {
  const value = String(day ?? 'today').trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value === 'tomorrow' || value === 'morgen') return toIsoDate(addDays(now(), 1));
  if (value === 'yesterday' || value === 'gestern') return toIsoDate(addDays(now(), -1));
  return toIsoDate(now());
};

/** Test hook: rebuild the mailbox from the seed. */
export const resetMailbox = () => {
  messages = null;
};
