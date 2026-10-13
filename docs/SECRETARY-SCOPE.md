# Jervis as an AI secretary — scope proposal

Draft for the definition conversation with Carlos. It turns the direction from
the review ("an AI secretary supporting daily work, not primarily a reporting
agent; function before visuals") into a concrete skill set, with the rules for
what Jervis may do on its own, what it must confirm, and what it must never do.
Everything marked *prototype* exists today against mock data; everything else
is the proposed next step.

## 1. What Jervis does for a user

| Skill | Examples the user can say | Status |
| --- | --- | --- |
| **Retrieve information** | "What problems did we have on Friday on Final Assembly 1?", "What is the first pass yield in Power BI?", "Which parts were involved in E-4120?" | prototype, mock sources |
| **Daily briefing** | "What do I need to know today?", "Was steht heute an?" | prototype |
| **Mail triage** | "Which emails need a reply?", "Find the email from the supplier about the delay" | prototype, mock mailbox |
| **Draft replies** | "Draft a reply to the supplier email" — the draft is shown for editing; sending asks for confirmation | prototype |
| **Calendar** | "What is on my calendar today / tomorrow?" | prototype, mock calendar |
| **Reminders and tasks** | "Remind me to call the supplier tomorrow at 9", "Mark the handover task done" | prototype |
| **Targeted Power BI figures** | "Show me the OEE measure", "Rework share this week from the dashboard" | prototype against the Power BI mock; live needs a read-only app registration |
| **Simple dashboards on request** | "Create a dashboard for Paint Line 2 this week" | prototype |
| **Spoken interaction** | "Hey Jervis …" wake word, spoken answers, hold-to-talk fallback | prototype |
| **German** | Full UI, understanding, answers and voice in German | prototype |

Proposed next skills, in the order they are likely to pay off:

1. **Meeting prep**: before a calendar entry, a one-page brief from the related mails, open issues and the last summary for that line or supplier.
2. **Follow-up tracking**: Jervis notices a mail that was answered "I'll get back to you" and creates the reminder itself.
3. **Document lookup** over approved SharePoint / file shares (needs the retrieval layer in `docs/RAG-DESIGN.md`).
4. **Power Automate hand-offs**: once Carlos's tests conclude, flows that call Jervis, or Jervis triggering an approved flow with a confirmation.

## 2. Rules of behaviour

**Jervis does on its own (read-only):** retrieve and summarise from sources the
user's role may access, read the mailbox and calendar, compose drafts, build
dashboards from already-permitted data, create reminders the user asked for.

**Jervis asks before acting (write actions):** sending any mail, accepting or
declining meetings, changing a task someone else created, triggering a Power
Automate flow. The confirmation is explicit in the UI ("Send this reply to …?")
and in voice ("Shall I send it?"), and the action is audited with who confirmed.

**Jervis never does:** send anything without a confirmation, read a source the
role is not permitted to (the tool is skipped and the answer says so), invent a
figure (every number comes from a retrieval call and names its source), keep
secrets in the browser (all credentials stay server-side), or claim a live
source while a connector is in mock mode.

## 3. Access model in one paragraph

Roles today: *Line viewer*, *Quality engineer*, *Production manager*. Each role
carries a permission set that is enforced on the server at two levels, the API
route and the individual retrieval tool, and every read and write is recorded
in the audit trail. Mail and calendar permissions are separate from production
data, so a role can be allowed to see its own inbox without seeing cost
figures. The full matrix is in `docs/ACCESS-MODEL.md`; roles will be mapped
from Entra ID group claims once SSO is agreed.

## 4. Open questions for Carlos

1. **Mail system**: Microsoft 365 / Exchange Online is assumed (Graph API).
   Correct? Is an app registration with `Mail.Read`, `Mail.Send`,
   `Calendars.Read` on a test mailbox possible for the pilot?
2. **Approved browser**: which browser and version is the standard? Hands-free
   voice needs the Web Speech API (Chrome, Edge). Others use hold-to-talk with
   server-side transcription.
3. **Identity**: Entra ID single sign-on for the pilot, and which groups map to
   which Jervis role?
4. **Power BI**: which workspace and dataset should the pilot read, and may we
   have a read-only service principal for it?
5. **Databricks**: a read-only SQL warehouse and the schema we may query.
6. **German**: German only, or German and English per user? Any plant-specific
   terms Jervis must know (line names, shift names, error-code vocabulary)?
7. **Audit retention**: how long must the question and action trail be kept,
   and who may read it?
8. **Power Automate**: what did the tests show, and should flows call Jervis or
   the other way round?

## 5. What to show Carlos first

Run the prototype locally (README, *Setup*), sign in as the manager, and walk
through: Today → Inbox (draft and the confirmation step) → "Hey Jervis, what do
I need to know today?" → "Create a dashboard for Paint Line 2 this week" →
switch to DE and ask "Welche E-Mails brauchen eine Antwort?". That covers every
item from the review in ten minutes.
