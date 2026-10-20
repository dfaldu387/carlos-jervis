/**
 * Deterministic narration strings, English and German side by side.
 *
 * `t(language, key, vars)` picks the string for the language and fills the
 * `{name}` placeholders. A key missing in German falls back to English rather
 * than throwing, so a new template can ship in one language first. Numbers
 * are always passed in from retrieved facts; nothing in this table carries a
 * figure of its own.
 */

export const LANGUAGES = ['en', 'de'];

export const normalizeLanguage = (value) =>
  String(value ?? '').toLowerCase().startsWith('de') ? 'de' : 'en';

const STRINGS = {
  en: {
    // ---- conversational -----------------------------------------------------
    'greeting.intro':
      '{prompt} I can answer questions about production issues, rework, shifts, lines, vehicle models, error codes, parts, checkpoints, maintenance and downtime, and I will tell you which system each figure came from. I also read your inbox and calendar, draft replies, set reminders, compose the daily briefing and build simple dashboards on request.',
    'capabilities.headline': 'What I can answer today',
    'capabilities.intro':
      'I combine the production issue history, the Power BI measures, the Integral Portal maintenance records and the MQTT downtime signals into one answer, and cite each source. As your secretary I also handle mail, calendar, reminders, the daily briefing and dashboards on request.',
    'capabilities.item.problems': 'Production problems for a day, a shift, a line or a vehicle model',
    'capabilities.item.causes': 'Error codes, symptoms, parts, cost centers and checkpoints behind the issues',
    'capabilities.item.rework': 'Rework counts, including vehicles removed from the line',
    'capabilities.item.shifts': 'Daily and shift summaries over the 06:00-14:00, 14:00-22:00 and 22:00-06:00 periods',
    'capabilities.item.maintenance': 'Maintenance tickets and recorded downtime for the same period',
    'capabilities.item.links': 'A link back to the Power BI report or application that owns the figures',
    'capabilities.item.mail': 'Your inbox: unread mail, what needs a reply, a drafted answer (sent only after you confirm)',
    'capabilities.item.calendar': 'Your calendar for today or tomorrow, reminders, and the morning briefing',
    'capabilities.item.dashboards': 'A Power BI measure by name, or a simple dashboard built for your question',
    'unknown.headline': 'I need a little more to go on',
    'unknown.narrative':
      'I could not identify what to retrieve for that question. Name a period, a line, a shift, a model or an error code and I will investigate - for example "what problems did we have on Friday on Final Assembly 1?". You can also ask for your inbox, your calendar, the daily briefing or a reminder.',

    // ---- production summaries ------------------------------------------------
    'period.on': 'on {period}',
    'period.onRange': 'on {period}',
    'period.for': ' for {scope}',
    'period.today': 'today ({date})',
    'period.yesterday': 'yesterday ({date})',
    'period.dayBefore': 'the day before yesterday ({date})',
    'period.tomorrow': 'tomorrow ({date})',
    'period.lastWeek': 'last week ({from} to {to})',
    'period.thisWeek': 'this week ({from} to {to})',
    'period.lastDays': 'the last {days} days',
    'period.month': 'the last 28 days',
    'period.assumed': 'today ({date}, assumed)',
    'severity.suffix': '{severity} severity',
    'count.issue': '{count} issue|{count} issues',
    'count.issueDative': '{count} issue|{count} issues',
    'count.issueEvent': '{count} issue event|{count} issue events',
    'count.problem': '{count} problem|{count} problems',
    'count.vehicle': '{count} vehicle|{count} vehicles',
    'count.stop': '{count} stop|{count} stops',
    'count.ticket': '{count} maintenance ticket|{count} maintenance tickets',
    'count.occurrence': '{count} occurrence|{count} occurrences',
    'summary.none.headline': 'No issues recorded {on}{scope}',
    'summary.headline': '{issues} recorded {on}{scope}',
    'summary.none': 'Nothing was recorded for {period}{scope} in the production issue history.',
    'summary.narrative':
      'On {period}{scope} the production issue history holds {issues}, affecting {vehicles}. {removed} of them were taken off the line and {rework} of rework was booked.',
    'summary.dominant': 'The dominant problems were {codes}.',
    'summary.heaviestShift': 'Heaviest shift: {shift} with {issues}',
    'summary.mostAffectedLine': 'Most affected line: {line} ({count} issues)',
    'summary.downtime': '{minutes} of downtime across {stops} (MQTT)',
    'summary.maintenance': '{tickets} in the Integral Portal, {open} still open',
    'codes.headline': '{count} distinct error code {on}{scope}|{count} distinct error codes {on}{scope}',
    'codes.none': 'No error codes were recorded for {period}{scope}.',
    'codes.narrative':
      '{issues} {on}{scope} map to {count} distinct error code. The most frequent were {codes}.|{issues} {on}{scope} map to {count} distinct error codes. The most frequent were {codes}.',
    'lines.headline': '{line} had the most issues {on}',
    'lines.none.headline': 'No line activity recorded {on}',
    'lines.none': 'No issues were recorded on any line for {period}{scope}.',
    'lines.narrative': 'Across {period}{scope}, {lines}. {line} leads with {issues} and {rework} of rework.',
    'lines.longestDowntime': 'Longest downtime: {line}, {minutes}',
    'issues.none.headline': 'No problems recorded {on}{scope}',
    'issues.headline': '{problems} recorded {on}{scope}',
    'issues.none': 'Nothing was recorded for {period}{scope}.',
    'issues.narrative':
      'On {period}{scope} there were {issues} affecting {vehicles}. {removed} vehicles were removed from the line and {rework} of rework was booked.',
    'issues.biggest': 'The biggest contributor was {code} with {occurrences}; the full picture is {codes}.',
    'issues.removed': '{vehicles} removed from the line',

    // ---- production detail intents --------------------------------------------
    'count.ticketShort': '{count} ticket|{count} tickets',
    'count.stopEvent': '{count} stop event|{count} stop events',
    'models.headline': '{count} vehicle model affected {on}{scope}|{count} vehicle models affected {on}{scope}',
    'models.none': 'No vehicle models were affected for {period}{scope}.',
    'models.narrative': '{models} - {vehicles} in total{scope}.',
    'models.causes': 'The issues behind those models were mainly {codes}.',
    'parts.headline': '{count} part involved {on}{scope}|{count} parts involved {on}{scope}',
    'parts.none': 'No parts were recorded against issues for {period}{scope}.',
    'parts.narrative': 'The components appearing most often were {parts}.',
    'parts.codes': 'They are associated with {codes}.',
    'vehicles.headline': '{count} vehicles affected {on}{scope}',
    'vehicles.narrative':
      '{vehicles} were affected {on}{scope}. {reworked} needed rework and {removed} were removed from the line.',
    'vehicles.byModel': 'By model: {models}.',
    'rework.headline': '{count} vehicles reworked {on}{scope}',
    'rework.narrative':
      '{vehicles} went through rework {on}{scope}, of which {removed} were removed from the line. Booked rework time was {minutes}.',
    'rework.byCategory': 'By category: {categories}.',
    'checkpoints.headline': '{count} checkpoint detected issues {on}{scope}|{count} checkpoints detected issues {on}{scope}',
    'checkpoints.none': 'No checkpoint detections were recorded for {period}{scope}.',
    'checkpoints.narrative': 'Detections came from {checkpoints}.',
    'cost.headline': 'Cost center impact for {period}{scope}',
    'cost.restricted':
      'Cost figures sit in the restricted Finance workspace report. Your role can see the issue distribution across cost centers, but not the monetary values.',
    'cost.distribution': 'Issues distributed across {centers}.',
    'cost.rework': 'Rework effort behind those issues totals {minutes}.',
    'maintenance.headline': '{count} maintenance tickets {on}{scope}',
    'maintenance.narrative': 'The Integral Portal holds {tickets} for {period}{scope}; {open} are still open.',
    'maintenance.downtime': 'Telemetry recorded {minutes} of downtime across {stops} in the same window.',
    'downtime.headline': '{minutes} of downtime {on}{scope}',
    'downtime.narrative': '{events} were published to the broker for {period}{scope}, totalling {minutes}.',
    'downtime.byLine': 'By line: {lines}.',
    'downtime.maintenance': '{tickets} booked in the same period',
    'trend.headline': 'Issue trend for {range}{scope}',
    'trend.narrative': 'Across {days} days the average is {average} issues per day{peak}.',
    'trend.peak': ', peaking at {count} on {date}',
    'trend.drivers': 'The trend is driven mainly by {codes}.',
    'reports.headline': '{count} Power BI reports cover this',
    'reports.narrative':
      'Power BI stays the system of record. These are the reports that own the figures, with the current headline values read through the API.',
    'reports.hidden': '{count} report(s) hidden for your role',

    // ---- KPI tiles, tables and links -----------------------------------------
    'metric.issuesTotal': 'Issues recorded',
    'metric.vehiclesAffected': 'Vehicles affected',
    'metric.vehiclesReworked': 'Vehicles reworked',
    'metric.vehiclesRemoved': 'Removed from line',
    'metric.reworkMinutes': 'Rework time',
    'metric.firstPassYield': 'First pass yield (est.)',
    'metric.reworkCost': 'Estimated rework cost',
    'metric.downtime': 'Recorded downtime',
    'metric.maintenanceOpen': 'Open maintenance tickets',
    'metric.mailUnread': 'Unread mail',
    'metric.mailNeedsReply': 'Awaiting reply',
    'dimension.default': 'Dimension',
    'dimension.date': 'Date',
    'dimension.shiftId': 'Shift',
    'dimension.lineId': 'Production line',
    'dimension.modelId': 'Vehicle model',
    'dimension.errorCode': 'Error code',
    'dimension.partId': 'Part',
    'dimension.costCenter': 'Cost center',
    'dimension.checkpointId': 'Checkpoint',
    'dimension.severity': 'Severity',
    'dimension.reworkCategoryId': 'Rework category',
    'dimension.category': 'Issue category',
    'dimension.status': 'Status',
    'column.issues': 'Issues',
    'column.vehicles': 'Vehicles',
    'column.reworkMinutes': 'Rework time',
    'column.detected': 'Detected',
    'column.code': 'Code',
    'column.symptom': 'Symptom',
    'column.line': 'Line',
    'column.model': 'Model',
    'column.severity': 'Severity',
    'column.rework': 'Rework',
    'column.ticket': 'Ticket',
    'column.asset': 'Asset',
    'column.work': 'Work',
    'column.priority': 'Priority',
    'column.status': 'Status',
    'column.topic': 'Topic',
    'column.reason': 'Reason',
    'column.duration': 'Duration',
    'column.report': 'Report',
    'column.workspace': 'Workspace',
    'column.measures': 'Measures',
    'table.byErrorCode': 'Issues by error code',
    'table.byShift': 'Issues by shift',
    'table.byLine': 'Issues by production line',
    'table.byModel': 'Issues by vehicle model',
    'table.byPart': 'Issues by part',
    'table.byCheckpoint': 'Detections by checkpoint',
    'table.byCostCenter': 'Issues by cost center',
    'table.byRework': 'Rework categories',
    'table.issuesPerDay': 'Issues per day',
    'table.issueRecords': 'Representative issue records',
    'table.maintenance': 'Maintenance tickets (Integral Portal)',
    'table.downtime': 'Downtime events (MQTT)',
    'table.reports': 'Power BI reports',
    'link.open': 'Open {source}',
    'redaction.vehicle': 'Vehicle identifiers',
    'redaction.supplier': 'Supplier names',
    'redaction.finance': 'Cost figures and cost center breakdown',
    'redaction.columns': '{count} column(s) withheld',

    // ---- secretary -----------------------------------------------------------
    'inbox.headline': '{unread} unread, {needsReply} waiting for a reply',
    'inbox.narrative':
      'Your inbox holds {total} messages from the last five days: {unread} unread and {needsReply} that still need an answer from you.',
    'inbox.filtered': 'Showing {count} {filter} messages.',
    'inbox.filter.unread': 'unread',
    'inbox.filter.needsReply': 'reply-needed',
    'inbox.filter.flagged': 'flagged',
    'inbox.filter.all': 'recent',
    'inbox.top': 'Needs a reply: {items}.',
    'inbox.empty': 'Nothing matched in your inbox.',
    'inbox.mode': 'Mailbox mode: {mode}.',
    'mail.search.headline': '{count} message found|{count} messages found',
    'mail.search.none.headline': 'No message matched',
    'mail.search.narrative': 'Best match: "{subject}" from {from}, received {received}.',
    'mail.search.none': 'I searched sender, subject and body for "{query}" and found nothing in the last five days.',
    'calendar.headline': '{count} appointment {day}|{count} appointments {day}',
    'calendar.none.headline': 'Nothing in your calendar {day}',
    'calendar.narrative': 'Your calendar {day}: {items}.',
    'calendar.none': 'There are no appointments {day}.',
    'calendar.today': 'today',
    'calendar.tomorrow': 'tomorrow',
    'calendar.on': 'on {date}',
    'calendar.tasksDue': '{count} task due that day|{count} tasks due that day',
    'briefing.headline': 'Your briefing for {date}',
    'briefing.greeting': '{greeting} Here is what matters today.',
    'reminder.headline': 'Reminder set: {title}',
    'reminder.narrative.due': 'I will remind you to {title} on {due}. It is in your task list as an open task.',
    'reminder.narrative.noDue': 'I added "{title}" to your task list without a due time. Tell me when and I will set it.',
    'reminder.failed.headline': 'I could not create that reminder',
    'reminder.failed': 'Tell me what to remind you of, for example "remind me to call the supplier tomorrow at 9".',
    'draft.headline': 'Draft reply to "{subject}"',
    'draft.narrative': 'I prepared a {tone} reply to {from}. Review it and confirm before anything is sent - I never send on my own.',
    'draft.none.headline': 'I could not find the message to answer',
    'draft.none': 'Name the sender or the subject, for example "draft a reply to the Nordkabel delivery email".',
    'measure.headline': '{name}: {value}',
    'measure.narrative': '{name} is {value} for {period}{scope}, as published in the Power BI report "{report}".',
    'measure.none.headline': 'No Power BI measure matches "{query}"',
    'measure.none': 'The reports expose: {available}.',
    'dashboard.headline': 'Dashboard created: {title}',
    'dashboard.narrative':
      'I built a dashboard with {count} widgets for {period}{scope}: {widgets}. Open it from the dashboards list; its figures are recomputed from the data source each time.',
    'dashboard.failed.headline': 'I could not build that dashboard',
    'dashboard.failed': 'Tell me what it should show, for example "create a dashboard for paint line issues this week".',
    'automate.headline': 'Ready to start: {label}',
    'automate.narrative': 'I can start the "{label}" flow with the details from your request.',
    'automate.confirm':
      'Nothing runs until you confirm - use the Run button to start it (it calls POST /api/automate/trigger with confirm: true).',
    'automate.simulated': 'This environment runs in mock mode, so the flow run is simulated and only recorded in the audit trail.',
    'automate.none.headline': 'Which flow should I start?',
    'automate.none': 'I can start these flows: {flows}. Tell me which one, for example "escalate a quality issue".',
    'automate.label.escalate-quality-issue': 'Escalate a quality issue',
    'automate.label.request-maintenance-visit': 'Request a maintenance visit',
    'automate.label.daily-report-distribution': 'Distribute the daily report',
    'automate.phrase.escalate-quality-issue': 'Escalate a quality issue',
    'automate.phrase.request-maintenance-visit': 'Start the maintenance visit request',
    'automate.phrase.daily-report-distribution': 'Send the daily report',
    'withheld.tool': '{tool} withheld: your role lacks the {permission} permission',
    'withheld.headline': 'Not available for your role',
    'withheld.narrative':
      'Your role ({role}) does not hold the permission this needs ({permissions}). Nothing was read. Ask an administrator if you need access.',

    // ---- follow-ups ------------------------------------------------------------
    'followUps.inbox.1': 'Draft a reply to the supplier email',
    'followUps.inbox.2': "What's on my calendar today?",
    'followUps.inbox.3': 'Give me my daily briefing',
    'followUps.calendar.1': "What's on my calendar tomorrow?",
    'followUps.calendar.2': 'Remind me to prepare the shift figures at 13:00',
    'followUps.calendar.3': 'Which emails need a reply?',
    'followUps.briefing.1': 'Which emails need a reply?',
    'followUps.briefing.2': 'What problems did we have on the night shift?',
    'followUps.briefing.3': 'Create a dashboard for critical issues this week',
    'followUps.reminder.1': 'What is on my task list?',
    'followUps.reminder.2': "What's on my calendar tomorrow?",
    'followUps.reminder.3': "What's in my inbox?",
    'followUps.draft.1': 'Which emails need a reply?',
    'followUps.draft.2': 'Remind me to follow up on this tomorrow at 9',
    'followUps.draft.3': 'Give me my daily briefing',
    'followUps.measure.1': 'Show me the first pass yield measure',
    'followUps.measure.2': 'Which Power BI report has the rework figures?',
    'followUps.measure.3': 'Create a dashboard for this week',
    'followUps.dashboard.1': 'Create a dashboard for error codes on Paint Line 2 this week',
    'followUps.dashboard.2': 'What is the OEE in Power BI?',
    'followUps.dashboard.3': 'Which production line had the most issues?',
    'followUps.default.1': 'What problems did we have on Friday?',
    'followUps.default.2': 'Summarize the early shift yesterday',
    'followUps.default.3': 'Which error codes occurred this week?',
    'followUps.issues.1': 'Which vehicle models were affected?',
    'followUps.issues.2': 'How many vehicles were reworked?',
    'followUps.issues.3': 'Which checkpoints detected the issues?',
    'followUps.daily.1': 'Break that down by shift',
    'followUps.daily.2': 'Which production line had the most issues?',
    'followUps.daily.3': 'Show the maintenance work for the same day',
    'followUps.shift.1': 'What problems did the late shift have?',
    'followUps.shift.2': 'Which parts were involved?',
    'followUps.shift.3': 'How much downtime was recorded?',
    'followUps.codes.1': 'Which parts are involved in E-4120?',
    'followUps.codes.2': 'Which models were affected?',
    'followUps.codes.3': 'Show the trend over the last 7 days',
    'followUps.lines.1': 'What problems did we have on that line?',
    'followUps.lines.2': 'How much downtime did that line have?',
    'followUps.lines.3': 'Which error codes occurred there?',
    'followUps.rework.1': 'Which vehicles were removed from the line?',
    'followUps.rework.2': 'What is the rework cost impact?',
    'followUps.rework.3': 'Which line produced the most rework?',
    'followUps.downtime.1': 'What maintenance tickets were opened?',
    'followUps.downtime.2': 'Which line stopped the longest?',
    'followUps.downtime.3': 'What problems happened during the stops?',

    // ---- voice ---------------------------------------------------------------
    'voice.prompt': 'What would you like to know?',
    'voice.followUp': 'Anything else?',
    'voice.notUnderstood': 'I did not catch a production question. Name a day, a shift, a line or an error code.',
    'voice.silence': 'I did not hear anything.',
    'voice.example.1': 'What problems did we have on Friday?',
    'voice.example.2': 'Summarize the early shift on {date}',
    'voice.example.3': 'How many vehicles were reworked yesterday?',
    'voice.example.4': "What's in my inbox?",
    'voice.example.5': 'Give me my daily briefing',

    // ---- units ---------------------------------------------------------------
    'unit.hour': 'hour|hours',
    'unit.minute': 'minute|minutes',
  },

  de: {
    'greeting.intro':
      '{prompt} Ich beantworte Fragen zu Produktionsproblemen, Nacharbeit, Schichten, Linien, Fahrzeugmodellen, Fehlercodes, Teilen, Prüfpunkten, Wartung und Stillständen und nenne zu jeder Zahl das System, aus dem sie stammt. Außerdem lese ich Ihren Posteingang und Kalender, entwerfe Antworten, setze Erinnerungen, stelle das Tagesbriefing zusammen und baue auf Wunsch einfache Dashboards.',
    'capabilities.headline': 'Was ich heute beantworten kann',
    'capabilities.intro':
      'Ich verbinde die Historie der Produktionsprobleme, die Power-BI-Kennzahlen, die Wartungstickets aus dem Integral Portal und die MQTT-Stillstandsignale zu einer Antwort und nenne jede Quelle. Als Ihr Sekretär kümmere ich mich außerdem um E-Mails, Kalender, Erinnerungen, das Tagesbriefing und Dashboards auf Wunsch.',
    'capabilities.item.problems': 'Produktionsprobleme für einen Tag, eine Schicht, eine Linie oder ein Fahrzeugmodell',
    'capabilities.item.causes': 'Fehlercodes, Symptome, Teile, Kostenstellen und Prüfpunkte hinter den Problemen',
    'capabilities.item.rework': 'Nacharbeitszahlen, einschließlich aus der Linie genommener Fahrzeuge',
    'capabilities.item.shifts': 'Tages- und Schichtzusammenfassungen für 06:00-14:00, 14:00-22:00 und 22:00-06:00',
    'capabilities.item.maintenance': 'Wartungstickets und erfasste Stillstände im gleichen Zeitraum',
    'capabilities.item.links': 'Ein Link zurück zum Power-BI-Bericht oder zur Anwendung, der die Zahlen gehören',
    'capabilities.item.mail': 'Ihr Posteingang: ungelesene E-Mails, was eine Antwort braucht, ein Antwortentwurf (gesendet nur nach Ihrer Bestätigung)',
    'capabilities.item.calendar': 'Ihr Kalender für heute oder morgen, Erinnerungen und das Morgenbriefing',
    'capabilities.item.dashboards': 'Eine Power-BI-Kennzahl nach Namen oder ein einfaches Dashboard zu Ihrer Frage',
    'unknown.headline': 'Dazu brauche ich etwas mehr',
    'unknown.narrative':
      'Ich konnte nicht erkennen, was ich für diese Frage abrufen soll. Nennen Sie einen Zeitraum, eine Linie, eine Schicht, ein Modell oder einen Fehlercode, zum Beispiel "welche Probleme hatten wir am Freitag auf Final Assembly 1?". Sie können auch nach Ihrem Posteingang, Ihrem Kalender, dem Tagesbriefing oder einer Erinnerung fragen.',

    'period.on': 'am {period}',
    'period.onRange': 'für {period}',
    'period.for': ' für {scope}',
    'period.today': 'heute ({date})',
    'period.yesterday': 'gestern ({date})',
    'period.dayBefore': 'vorgestern ({date})',
    'period.tomorrow': 'morgen ({date})',
    'period.lastWeek': 'letzte Woche ({from} bis {to})',
    'period.thisWeek': 'diese Woche ({from} bis {to})',
    'period.lastDays': 'die letzten {days} Tage',
    'period.month': 'die letzten 28 Tage',
    'period.assumed': 'heute ({date}, angenommen)',
    'severity.suffix': 'Schweregrad {severity}',
    'count.issue': '{count} Problem|{count} Probleme',
    'count.issueDative': '{count} Problem|{count} Problemen',
    'count.issueEvent': '{count} Problemereignis|{count} Problemereignisse',
    'count.problem': '{count} Problem|{count} Probleme',
    'count.vehicle': '{count} Fahrzeug|{count} Fahrzeuge',
    'count.stop': '{count} Stillstand|{count} Stillstände',
    'count.ticket': '{count} Wartungsticket|{count} Wartungstickets',
    'count.occurrence': '{count} Vorkommen|{count} Vorkommen',
    'summary.none.headline': 'Keine Probleme erfasst {on}{scope}',
    'summary.headline': '{issues} erfasst {on}{scope}',
    'summary.none': 'Für {period}{scope} ist in der Problemhistorie nichts erfasst.',
    'summary.narrative':
      '{On}{scope} enthält die Problemhistorie {issues}, betroffen sind {vehicles}. {removed} davon wurden aus der Linie genommen und {rework} Nacharbeit wurden gebucht.',
    'summary.dominant': 'Die dominierenden Probleme waren {codes}.',
    'summary.heaviestShift': 'Stärkste Schicht: {shift} mit {issues}',
    'summary.mostAffectedLine': 'Am stärksten betroffene Linie: {line} ({count} Probleme)',
    'summary.downtime': '{minutes} Stillstand über {stops} (MQTT)',
    'summary.maintenance': '{tickets} im Integral Portal, {open} noch offen',
    'codes.headline': '{count} Fehlercode {on}{scope}|{count} verschiedene Fehlercodes {on}{scope}',
    'codes.none': 'Für {period}{scope} wurden keine Fehlercodes erfasst.',
    'codes.narrative':
      '{issues} {on}{scope} verteilen sich auf {count} Fehlercode. Am häufigsten: {codes}.|{issues} {on}{scope} verteilen sich auf {count} verschiedene Fehlercodes. Am häufigsten: {codes}.',
    'lines.headline': '{line} hatte die meisten Probleme {on}',
    'lines.none.headline': 'Keine Linienaktivität erfasst {on}',
    'lines.none': 'Für {period}{scope} wurden auf keiner Linie Probleme erfasst.',
    'lines.narrative': '{On}{scope}: {lines}. {line} führt mit {issues} und {rework} Nacharbeit.',
    'lines.longestDowntime': 'Längster Stillstand: {line}, {minutes}',
    'issues.none.headline': 'Keine Probleme erfasst {on}{scope}',
    'issues.headline': '{problems} erfasst {on}{scope}',
    'issues.none': 'Für {period}{scope} wurde nichts erfasst.',
    'issues.narrative':
      '{On}{scope} gab es {issues}, betroffen waren {vehicles}. {removed} Fahrzeuge wurden aus der Linie genommen und {rework} Nacharbeit wurden gebucht.',
    'issues.biggest': 'Größter Verursacher war {code} mit {occurrences}; das Gesamtbild: {codes}.',
    'issues.removed': '{vehicles} aus der Linie genommen',

    'count.ticketShort': '{count} Ticket|{count} Tickets',
    'count.stopEvent': '{count} Stillstandsereignis|{count} Stillstandsereignisse',
    'models.headline': '{count} Fahrzeugmodell betroffen {on}{scope}|{count} Fahrzeugmodelle betroffen {on}{scope}',
    'models.none': 'Für {period}{scope} waren keine Fahrzeugmodelle betroffen.',
    'models.narrative': '{models} - insgesamt {vehicles}{scope}.',
    'models.causes': 'Hinter diesen Modellen standen vor allem {codes}.',
    'parts.headline': '{count} Teil beteiligt {on}{scope}|{count} Teile beteiligt {on}{scope}',
    'parts.none': 'Für {period}{scope} wurden keine Teile zu Problemen erfasst.',
    'parts.narrative': 'Am häufigsten traten diese Komponenten auf: {parts}.',
    'parts.codes': 'Sie hängen mit {codes} zusammen.',
    'vehicles.headline': '{count} Fahrzeug betroffen {on}{scope}|{count} Fahrzeuge betroffen {on}{scope}',
    'vehicles.narrative':
      '{vehicles} waren {on}{scope} betroffen. {reworked} brauchten Nacharbeit und {removed} wurden aus der Linie genommen.',
    'vehicles.byModel': 'Nach Modell: {models}.',
    'rework.headline': '{count} Fahrzeug nachgearbeitet {on}{scope}|{count} Fahrzeuge nachgearbeitet {on}{scope}',
    // Durations end in "Min." and never close a German sentence, or the
    // abbreviation's own full stop doubles up.
    'rework.narrative':
      '{vehicles} durchliefen {on}{scope} die Nacharbeit, davon wurden {removed} aus der Linie genommen. Als Nacharbeitszeit wurden {minutes} gebucht.',
    'rework.byCategory': 'Nach Kategorie: {categories}.',
    'checkpoints.headline':
      '{count} Prüfpunkt hat Probleme erkannt {on}{scope}|{count} Prüfpunkte haben Probleme erkannt {on}{scope}',
    'checkpoints.none': 'Für {period}{scope} wurden keine Erkennungen an Prüfpunkten erfasst.',
    'checkpoints.narrative': 'Die Erkennungen kamen von {checkpoints}.',
    'cost.headline': 'Kostenstellenauswirkung für {period}{scope}',
    'cost.restricted':
      'Die Kostenwerte liegen im zugriffsbeschränkten Bericht des Finance-Arbeitsbereichs. Ihre Rolle sieht die Verteilung der Probleme auf die Kostenstellen, aber nicht die Geldbeträge.',
    'cost.distribution': 'Die Probleme verteilen sich auf {centers}.',
    'cost.rework': 'Hinter diesen Problemen stehen insgesamt {minutes} Nacharbeitsaufwand.',
    'maintenance.headline': '{count} Wartungsticket {on}{scope}|{count} Wartungstickets {on}{scope}',
    'maintenance.narrative': 'Das Integral Portal enthält {tickets} für {period}{scope}; {open} davon sind noch offen.',
    'maintenance.downtime': 'Die Telemetrie hat im gleichen Zeitfenster {minutes} Stillstand über {stops} erfasst.',
    'downtime.headline': '{minutes} Stillstand {on}{scope}',
    'downtime.narrative': '{events} mit insgesamt {minutes} wurden {on}{scope} an den Broker gemeldet.',
    'downtime.byLine': 'Nach Linie: {lines}.',
    'downtime.maintenance': '{tickets} im gleichen Zeitraum gebucht',
    'trend.headline': 'Problemverlauf für {range}{scope}',
    'trend.narrative': 'Über {days} Tage liegt der Durchschnitt bei {average} Problemen pro Tag{peak}.',
    'trend.peak': ', mit dem Höchstwert von {count} am {date}',
    'trend.drivers': 'Der Verlauf wird vor allem von {codes} bestimmt.',
    'reports.headline': '{count} Power-BI-Bericht deckt das ab|{count} Power-BI-Berichte decken das ab',
    'reports.narrative':
      'Power BI bleibt das führende System. Das sind die Berichte, denen die Zahlen gehören, mit den aktuellen Kopfwerten über die API gelesen.',
    'reports.hidden': '{count} Bericht für Ihre Rolle ausgeblendet|{count} Berichte für Ihre Rolle ausgeblendet',

    'metric.issuesTotal': 'Erfasste Probleme',
    'metric.vehiclesAffected': 'Betroffene Fahrzeuge',
    'metric.vehiclesReworked': 'Nachgearbeitete Fahrzeuge',
    'metric.vehiclesRemoved': 'Aus der Linie genommen',
    'metric.reworkMinutes': 'Nacharbeitszeit',
    'metric.firstPassYield': 'First Pass Yield (geschätzt)',
    'metric.reworkCost': 'Geschätzte Nacharbeitskosten',
    'metric.downtime': 'Erfasster Stillstand',
    'metric.maintenanceOpen': 'Offene Wartungstickets',
    'metric.mailUnread': 'Ungelesene E-Mails',
    'metric.mailNeedsReply': 'Antwort ausstehend',
    'dimension.default': 'Dimension',
    'dimension.date': 'Datum',
    'dimension.shiftId': 'Schicht',
    'dimension.lineId': 'Linie',
    'dimension.modelId': 'Fahrzeugmodell',
    'dimension.errorCode': 'Fehlercode',
    'dimension.partId': 'Teil',
    'dimension.costCenter': 'Kostenstelle',
    'dimension.checkpointId': 'Prüfpunkt',
    'dimension.severity': 'Schweregrad',
    'dimension.reworkCategoryId': 'Nacharbeitskategorie',
    'dimension.category': 'Problemkategorie',
    'dimension.status': 'Status',
    'column.issues': 'Probleme',
    'column.vehicles': 'Fahrzeuge',
    'column.reworkMinutes': 'Nacharbeitszeit',
    'column.detected': 'Erkannt',
    'column.code': 'Code',
    'column.symptom': 'Symptom',
    'column.line': 'Linie',
    'column.model': 'Modell',
    'column.severity': 'Schweregrad',
    'column.rework': 'Nacharbeit',
    'column.ticket': 'Ticket',
    'column.asset': 'Anlage',
    'column.work': 'Arbeit',
    'column.priority': 'Priorität',
    'column.status': 'Status',
    'column.topic': 'Topic',
    'column.reason': 'Grund',
    'column.duration': 'Dauer',
    'column.report': 'Bericht',
    'column.workspace': 'Arbeitsbereich',
    'column.measures': 'Kennzahlen',
    'table.byErrorCode': 'Probleme nach Fehlercode',
    'table.byShift': 'Probleme nach Schicht',
    'table.byLine': 'Probleme nach Linie',
    'table.byModel': 'Probleme nach Fahrzeugmodell',
    'table.byPart': 'Probleme nach Teil',
    'table.byCheckpoint': 'Erkennungen nach Prüfpunkt',
    'table.byCostCenter': 'Probleme nach Kostenstelle',
    'table.byRework': 'Nacharbeitskategorien',
    'table.issuesPerDay': 'Probleme pro Tag',
    'table.issueRecords': 'Repräsentative Problemdatensätze',
    'table.maintenance': 'Wartungstickets (Integral Portal)',
    'table.downtime': 'Stillstandsereignisse (MQTT)',
    'table.reports': 'Power-BI-Berichte',
    'link.open': '{source} öffnen',
    'redaction.vehicle': 'Fahrzeugkennungen',
    'redaction.supplier': 'Lieferantennamen',
    'redaction.finance': 'Kostenwerte und Kostenstellenaufschlüsselung',
    'redaction.columns': '{count} Spalte zurückgehalten|{count} Spalten zurückgehalten',

    'inbox.headline': '{unread} ungelesen, {needsReply} warten auf eine Antwort',
    'inbox.narrative':
      'Ihr Posteingang enthält {total} Nachrichten aus den letzten fünf Tagen: {unread} ungelesene und {needsReply}, die noch eine Antwort von Ihnen brauchen.',
    'inbox.filtered': 'Angezeigt: {count} {filter} Nachrichten.',
    'inbox.filter.unread': 'ungelesene',
    'inbox.filter.needsReply': 'zu beantwortende',
    'inbox.filter.flagged': 'markierte',
    'inbox.filter.all': 'aktuelle',
    'inbox.top': 'Antwort nötig: {items}.',
    'inbox.empty': 'In Ihrem Posteingang hat nichts gepasst.',
    'inbox.mode': 'Postfachmodus: {mode}.',
    'mail.search.headline': '{count} Nachricht gefunden|{count} Nachrichten gefunden',
    'mail.search.none.headline': 'Keine passende Nachricht',
    'mail.search.narrative': 'Bester Treffer: "{subject}" von {from}, eingegangen {received}.',
    'mail.search.none': 'Ich habe Absender, Betreff und Text nach "{query}" durchsucht und in den letzten fünf Tagen nichts gefunden.',
    'calendar.headline': '{count} Termin {day}|{count} Termine {day}',
    'calendar.none.headline': 'Keine Termine {day}',
    'calendar.narrative': 'Ihr Kalender {day}: {items}.',
    'calendar.none': 'Es gibt keine Termine {day}.',
    'calendar.today': 'heute',
    'calendar.tomorrow': 'morgen',
    'calendar.on': 'am {date}',
    'calendar.tasksDue': '{count} Aufgabe an dem Tag fällig|{count} Aufgaben an dem Tag fällig',
    'briefing.headline': 'Ihr Briefing für {date}',
    'briefing.greeting': '{greeting} Das ist heute wichtig.',
    'reminder.headline': 'Erinnerung gesetzt: {title}',
    'reminder.narrative.due': 'Ich erinnere Sie am {due} daran: {title}. Die Aufgabe steht offen in Ihrer Aufgabenliste.',
    'reminder.narrative.noDue': 'Ich habe "{title}" ohne Fälligkeit in Ihre Aufgabenliste aufgenommen. Sagen Sie mir wann, und ich trage es ein.',
    'reminder.failed.headline': 'Ich konnte diese Erinnerung nicht anlegen',
    'reminder.failed': 'Sagen Sie mir, woran ich Sie erinnern soll, zum Beispiel "erinnere mich morgen um 9 daran, den Lieferanten anzurufen".',
    'draft.headline': 'Antwortentwurf zu "{subject}"',
    'draft.narrative': 'Ich habe eine {tone} Antwort an {from} vorbereitet. Prüfen Sie sie und bestätigen Sie, bevor etwas gesendet wird - ich sende nie von selbst.',
    'draft.none.headline': 'Ich konnte die zu beantwortende Nachricht nicht finden',
    'draft.none': 'Nennen Sie den Absender oder den Betreff, zum Beispiel "antworte auf die Liefer-E-Mail von Nordkabel".',
    'measure.headline': '{name}: {value}',
    'measure.narrative': '{name} beträgt {value} für {period}{scope}, wie im Power-BI-Bericht "{report}" veröffentlicht.',
    'measure.none.headline': 'Keine Power-BI-Kennzahl passt zu "{query}"',
    'measure.none': 'Die Berichte stellen bereit: {available}.',
    'dashboard.headline': 'Dashboard erstellt: {title}',
    'dashboard.narrative':
      'Ich habe ein Dashboard mit {count} Kacheln für {period}{scope} gebaut: {widgets}. Sie finden es in der Dashboard-Liste; die Zahlen werden bei jedem Aufruf neu aus der Datenquelle berechnet.',
    'dashboard.failed.headline': 'Ich konnte dieses Dashboard nicht bauen',
    'dashboard.failed': 'Sagen Sie mir, was es zeigen soll, zum Beispiel "erstelle ein Dashboard für Probleme auf der Lackierlinie diese Woche".',
    'automate.headline': 'Bereit zum Start: {label}',
    'automate.narrative': 'Ich kann den Ablauf "{label}" mit den Angaben aus Ihrer Anfrage starten.',
    'automate.confirm':
      'Es wird nichts ausgeführt, bis Sie bestätigen - starten Sie ihn über die Schaltfläche Ausführen (ruft POST /api/automate/trigger mit confirm: true auf).',
    'automate.simulated': 'Diese Umgebung läuft im Mock-Modus, daher wird der Lauf nur simuliert und im Audit-Protokoll vermerkt.',
    'automate.none.headline': 'Welchen Ablauf soll ich starten?',
    'automate.none': 'Ich kann diese Abläufe starten: {flows}. Sagen Sie mir welchen, zum Beispiel "Qualitätsproblem eskalieren".',
    'automate.label.escalate-quality-issue': 'Qualitätsproblem eskalieren',
    'automate.label.request-maintenance-visit': 'Wartungsbesuch anfordern',
    'automate.label.daily-report-distribution': 'Tagesbericht verteilen',
    'automate.phrase.escalate-quality-issue': 'Qualitätsproblem eskalieren',
    'automate.phrase.request-maintenance-visit': 'Starte die Wartungsanfrage',
    'automate.phrase.daily-report-distribution': 'Verteile den Tagesbericht',
    'withheld.tool': '{tool} zurückgehalten: Ihre Rolle hat die Berechtigung {permission} nicht',
    'withheld.headline': 'Für Ihre Rolle nicht verfügbar',
    'withheld.narrative':
      'Ihre Rolle ({role}) hat die dafür nötige Berechtigung nicht ({permissions}). Es wurde nichts gelesen. Wenden Sie sich an einen Administrator, wenn Sie Zugriff brauchen.',

    'followUps.inbox.1': 'Entwirf eine Antwort auf die Lieferanten-E-Mail',
    'followUps.inbox.2': 'Was steht heute in meinem Kalender?',
    'followUps.inbox.3': 'Gib mir mein Tagesbriefing',
    'followUps.calendar.1': 'Was steht morgen in meinem Kalender?',
    'followUps.calendar.2': 'Erinnere mich um 13:00 daran, die Schichtzahlen vorzubereiten',
    'followUps.calendar.3': 'Welche E-Mails brauchen eine Antwort?',
    'followUps.briefing.1': 'Welche E-Mails brauchen eine Antwort?',
    'followUps.briefing.2': 'Welche Probleme hatten wir in der Nachtschicht?',
    'followUps.briefing.3': 'Erstelle ein Dashboard für kritische Probleme diese Woche',
    'followUps.reminder.1': 'Was steht auf meiner Aufgabenliste?',
    'followUps.reminder.2': 'Was steht morgen in meinem Kalender?',
    'followUps.reminder.3': 'Was ist in meinem Posteingang?',
    'followUps.draft.1': 'Welche E-Mails brauchen eine Antwort?',
    'followUps.draft.2': 'Erinnere mich morgen um 9 daran, hier nachzufassen',
    'followUps.draft.3': 'Gib mir mein Tagesbriefing',
    'followUps.measure.1': 'Zeig mir die Kennzahl First Pass Yield',
    // "Power BI" unhyphenated: the NLU's report-lookup trigger does not accept "Power-BI-".
    'followUps.measure.2': 'Welcher Bericht in Power BI hat die Nacharbeitszahlen?',
    'followUps.measure.3': 'Erstelle ein Dashboard für diese Woche',
    'followUps.dashboard.1': 'Erstelle ein Dashboard für Fehlercodes auf Paint Line 2 diese Woche',
    'followUps.dashboard.2': 'Wie hoch ist die OEE in Power BI?',
    'followUps.dashboard.3': 'Welche Linie hatte die meisten Probleme?',
    'followUps.default.1': 'Welche Probleme hatten wir am Freitag?',
    'followUps.default.2': 'Fasse die Frühschicht von gestern zusammen',
    'followUps.default.3': 'Welche Fehlercodes traten diese Woche auf?',
    'followUps.issues.1': 'Welche Fahrzeugmodelle waren betroffen?',
    'followUps.issues.2': 'Wie viele Fahrzeuge wurden nachgearbeitet?',
    'followUps.issues.3': 'Welche Prüfpunkte haben die Probleme erkannt?',
    'followUps.daily.1': 'Schlüssle das nach Schicht auf',
    'followUps.daily.2': 'Welche Linie hatte die meisten Probleme?',
    'followUps.daily.3': 'Zeig die Wartungsarbeiten für denselben Tag',
    'followUps.shift.1': 'Welche Probleme hatte die Spätschicht?',
    'followUps.shift.2': 'Welche Teile waren beteiligt?',
    'followUps.shift.3': 'Wie viel Stillstand wurde erfasst?',
    'followUps.codes.1': 'Welche Teile sind bei E-4120 beteiligt?',
    'followUps.codes.2': 'Welche Modelle waren betroffen?',
    'followUps.codes.3': 'Zeig den Trend der letzten 7 Tage',
    'followUps.lines.1': 'Welche Probleme hatten wir auf dieser Linie?',
    'followUps.lines.2': 'Wie viel Stillstand hatte diese Linie?',
    'followUps.lines.3': 'Welche Fehlercodes traten dort auf?',
    'followUps.rework.1': 'Welche Fahrzeuge wurden aus der Linie genommen?',
    'followUps.rework.2': 'Welche Kostenstellen waren betroffen?',
    'followUps.rework.3': 'Welche Linie hatte die meisten Probleme?',
    'followUps.downtime.1': 'Welche Wartungstickets wurden eröffnet?',
    'followUps.downtime.2': 'Welche Linie hatte den längsten Stillstand?',
    'followUps.downtime.3': 'Welche Probleme gab es im gleichen Zeitraum?',

    'voice.prompt': 'Was möchten Sie wissen?',
    'voice.followUp': 'Noch etwas?',
    'voice.notUnderstood': 'Ich habe keine Produktionsfrage verstanden. Nennen Sie einen Tag, eine Schicht, eine Linie oder einen Fehlercode.',
    'voice.silence': 'Ich habe nichts gehört.',
    'voice.example.1': 'Welche Probleme hatten wir am Freitag?',
    'voice.example.2': 'Fasse die Frühschicht vom {date} zusammen',
    'voice.example.3': 'Wie viele Fahrzeuge wurden gestern nachgearbeitet?',
    'voice.example.4': 'Was ist in meinem Posteingang?',
    'voice.example.5': 'Gib mir mein Tagesbriefing',

    'unit.hour': 'Stunde|Stunden',
    'unit.minute': 'Minute|Minuten',
  },
};

const fill = (template, vars) =>
  template.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])));

/**
 * @param {'en'|'de'} language
 * @param {string} key
 * @param {object} [vars] placeholder values; `count` selects the plural form when the string has one ("a|b")
 */
export const t = (language, key, vars = {}) => {
  const lang = normalizeLanguage(language);
  const template = STRINGS[lang]?.[key] ?? STRINGS.en[key];
  if (template === undefined) return key;
  const forms = template.split('|');
  const chosen = forms.length > 1 ? (Number(vars.count) === 1 ? forms[0] : forms[1]) : forms[0];
  return fill(chosen, vars);
};

/** "{count} issue(s)" style counts in one call. */
export const tCount = (language, key, count) => t(language, key, { count });

export const hasKey = (key) => key in STRINGS.en;

// Reverse index of plain (non-templated) phrase -> key, per language. Lets a
// known suggestion phrase (a follow-up, a prompt) be re-expressed in another
// language. Built once, lazily.
let phraseIndex = null;
const buildPhraseIndex = () => {
  const index = { en: new Map(), de: new Map() };
  for (const lang of LANGUAGES) {
    for (const [key, value] of Object.entries(STRINGS[lang] ?? {})) {
      if (typeof value !== 'string' || value.includes('{') || value.includes('|')) continue;
      index[lang].set(value.trim().toLowerCase(), key);
    }
  }
  return index;
};

/**
 * Re-expresses a known UI phrase (a follow-up suggestion, a prompt) in the
 * target language by matching it back to its string key. Free-typed text that
 * matches no key is returned unchanged.
 * @param {string} text
 * @param {'en'|'de'} language
 */
export const localizePhrase = (text, language) => {
  const input = String(text ?? '').trim();
  if (!input) return input;
  if (!phraseIndex) phraseIndex = buildPhraseIndex();
  const needle = input.toLowerCase();
  const key = phraseIndex.en.get(needle) ?? phraseIndex.de.get(needle);
  if (!key) return input;
  return t(normalizeLanguage(language), key) || input;
};

const WEEKDAYS = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
};

export const weekdayLabel = (iso, language) => {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return WEEKDAYS[normalizeLanguage(language)][date.getUTCDay()];
};

/** "Monday 2026-10-13" / "Montag 2026-10-13". */
export const dateLabel = (iso, language) => `${weekdayLabel(iso, language)} ${iso}`;

/** "09:00" from an ISO timestamp; the plant runs on the timestamps' own clock. */
export const timeLabel = (iso) => String(iso ?? '').slice(11, 16);

/** "Monday 2026-10-13 09:00" / "Montag 2026-10-13 09:00". */
export const dateTimeLabel = (iso, language) =>
  iso ? `${dateLabel(String(iso).slice(0, 10), language)} ${timeLabel(iso)}` : '';

/** "33.7" as "33,7" for German readers; English keeps the figure as it came. */
export const numberLabel = (value, language) =>
  normalizeLanguage(language) === 'de' ? String(value).replace('.', ',') : String(value);

/** "64 h 43 min" the way the synthesizer writes it, in either language. */
export const minutesLabel = (minutes, language) => {
  const lang = normalizeLanguage(language);
  if (!minutes || minutes <= 0) return lang === 'de' ? '0 Min.' : '0 min';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  const h = lang === 'de' ? 'Std.' : 'h';
  const m = lang === 'de' ? 'Min.' : 'min';
  if (hours === 0) return `${rest} ${m}`;
  if (rest === 0) return `${hours} ${h}`;
  return `${hours} ${h} ${rest} ${m}`;
};
