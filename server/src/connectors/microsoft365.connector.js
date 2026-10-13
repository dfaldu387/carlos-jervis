import { resolve_ } from '../integrations/store.js';

/**
 * Microsoft 365 connector (mail and calendar via Microsoft Graph).
 *
 * Implements the same interface as the mock mailbox in secretary/mailbox.js:
 * listMail, getMail, updateMail, listEvents, sendReply. The Graph calls below
 * are the ones the live path will make, with the request shapes written out so
 * the client can review exactly what Jervis would touch:
 *
 *   token      POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *   listMail   GET  /users/{mailbox}/mailFolders/inbox/messages?$top=..&$search=..
 *   getMail    GET  /users/{mailbox}/messages/{id}
 *   updateMail PATCH /users/{mailbox}/messages/{id}   { isRead, flag }
 *   listEvents GET  /users/{mailbox}/calendarView?startDateTime=..&endDateTime=..
 *   sendReply  POST /users/{mailbox}/messages/{id}/reply   { comment }
 *
 * LIVE MODE IS NOT WIRED. Until the operator supplies credentials on the
 * Integrations page (and enables the connector), the registry in
 * secretary/provider.js never returns this object, and even then every method
 * below refuses rather than sending a request, because the mailbox scope and
 * the application access policy still have to be agreed with the client. The
 * probe in integrations/probe.js is the only Graph call that exists today.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';

const notWired = (operation) =>
  Object.assign(
    new Error(
      `Microsoft 365 live mode is configured but not wired for ${operation}; the Graph call is stubbed until the mailbox scope is agreed.`,
    ),
    { statusCode: 501, code: 'ms365_not_wired' },
  );

/** Resolved settings (includes the secret; server-side only). */
const settings = () => resolve_('microsoft365') ?? {};

/** Where each call would go, for the trace and the docs. Never executed here. */
export const graphEndpoints = () => {
  const mailbox = encodeURIComponent(settings().mailbox || '{mailbox}');
  return {
    listMail: `${GRAPH}/users/${mailbox}/mailFolders/inbox/messages`,
    getMail: `${GRAPH}/users/${mailbox}/messages/{id}`,
    updateMail: `${GRAPH}/users/${mailbox}/messages/{id}`,
    listEvents: `${GRAPH}/users/${mailbox}/calendarView`,
    sendReply: `${GRAPH}/users/${mailbox}/messages/{id}/reply`,
  };
};

/**
 * Maps a Graph message resource onto the Mail shape the API publishes, so the
 * UI never sees a Graph-specific field. Kept here (even though unused until
 * live mode) so the mapping is reviewed together with the calls.
 */
export const fromGraphMessage = (message) => ({
  id: message.id,
  from: {
    name: message.from?.emailAddress?.name ?? '',
    email: message.from?.emailAddress?.address ?? '',
  },
  to: (message.toRecipients ?? []).map((recipient) => recipient.emailAddress?.address).filter(Boolean),
  subject: message.subject ?? '',
  receivedAt: message.receivedDateTime,
  preview: message.bodyPreview ?? '',
  body: message.body?.content ?? '',
  read: Boolean(message.isRead),
  flagged: message.flag?.flagStatus === 'flagged',
  needsReply: !message.isRead || message.flag?.flagStatus === 'flagged',
  replied: false,
  category: 'other',
  attachments: (message.attachments ?? []).map((attachment) => ({
    name: attachment.name,
    size: attachment.size ?? 0,
  })),
});

export const liveMailProvider = {
  mode: 'live',

  async listMail() {
    throw notWired('listMail');
  },

  async getMail() {
    throw notWired('getMail');
  },

  async updateMail() {
    throw notWired('updateMail');
  },

  async listEvents() {
    throw notWired('listEvents');
  },

  async sendReply() {
    throw notWired('sendReply');
  },
};
