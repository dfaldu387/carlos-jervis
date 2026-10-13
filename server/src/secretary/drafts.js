import { MAILBOX_OWNER } from './mailbox.js';
import { draftReplyWithClaude } from '../agent/llm.js';
import { normalizeLanguage } from '../agent/i18n.js';

/**
 * Reply drafts.
 *
 * A deterministic template answers first: it acknowledges the message by
 * subject and category and proposes the next step the category usually calls
 * for. When Claude narration is enabled the template is handed over for a
 * better-worded version, with the same rule as everywhere else - no facts the
 * mail did not contain. Drafts are never sent from here; sending is a separate
 * route that requires an explicit confirmation.
 */

const INTERNAL_DOMAIN = MAILBOX_OWNER.email.split('@')[1];

const toneFor = (mail) => {
  const internal = mail.from.email.endsWith(`@${INTERNAL_DOMAIN}`) || mail.from.email.endsWith('@integral.internal');
  return internal && ['quality', 'meeting', 'maintenance', 'other'].includes(mail.category) ? 'friendly' : 'formal';
};

const firstName = (name) => String(name ?? '').split(' ')[0];

const NEXT_STEP = {
  en: {
    supplier:
      'Please confirm the revised schedule in writing and let us know the earliest date for the full delivery. We will plan the line against the dates you confirm.',
    maintenance:
      'Thank you for the update. Please add the follow-up to the ticket so the shift leads can see it in the Integral Portal.',
    quality:
      'Agreed - go ahead with the containment you propose and keep the affected vehicles on hold until the check is complete. Please send me the result after the next shift.',
    hr: 'I will review the document and come back to you with the confirmation by the deadline you mention.',
    meeting: 'Thank you for the invitation. I will attend and bring the current shift figures.',
    it: 'Noted, thank you for the notice.',
    other: 'I will put the figures together and send them to you ahead of the meeting.',
  },
  de: {
    supplier:
      'Bitte bestätigen Sie den geänderten Zeitplan schriftlich und nennen Sie uns den frühestmöglichen Termin für die vollständige Lieferung. Wir planen die Linie nach den von Ihnen bestätigten Terminen.',
    maintenance:
      'Vielen Dank für die Rückmeldung. Bitte tragen Sie die Nacharbeit im Ticket ein, damit die Schichtleiter sie im Integral Portal sehen.',
    quality:
      'Einverstanden - setzen Sie die vorgeschlagene Eindämmung um und lassen Sie die betroffenen Fahrzeuge bis zum Abschluss der Prüfung gesperrt. Bitte senden Sie mir das Ergebnis nach der nächsten Schicht.',
    hr: 'Ich prüfe das Dokument und melde mich bis zur genannten Frist mit der Bestätigung.',
    meeting: 'Vielen Dank für die Einladung. Ich nehme teil und bringe die aktuellen Schichtzahlen mit.',
    it: 'Verstanden, danke für den Hinweis.',
    other: 'Ich stelle die Zahlen zusammen und sende sie Ihnen vor dem Termin zu.',
  },
};

const GREETING = {
  en: { formal: (mail) => `Dear ${mail.from.name},`, friendly: (mail) => `Hi ${firstName(mail.from.name)},` },
  de: {
    formal: (mail) => `Sehr geehrte Damen und Herren, sehr geehrte/r ${mail.from.name},`,
    friendly: (mail) => `Hallo ${firstName(mail.from.name)},`,
  },
};

const ACK = {
  en: (mail) => `thank you for your message regarding "${mail.subject}".`,
  de: (mail) => `vielen Dank für Ihre Nachricht zu "${mail.subject}".`,
};

const SIGNOFF = {
  en: { formal: 'Kind regards', friendly: 'Best' },
  de: { formal: 'Mit freundlichen Grüßen', friendly: 'Viele Grüße' },
};

export const composeDraft = (mail, { instructions = '', language = 'en' } = {}) => {
  const lang = normalizeLanguage(language);
  const tone = toneFor(mail);
  const category = NEXT_STEP[lang][mail.category] ? mail.category : 'other';
  const note = String(instructions ?? '').trim();

  const paragraphs = [
    GREETING[lang][tone](mail),
    '',
    ACK[lang](mail),
    '',
    NEXT_STEP[lang][category],
  ];
  if (note) {
    // The user's instruction is carried verbatim as its own paragraph; the
    // template does not try to paraphrase it.
    paragraphs.push('', note);
  }
  paragraphs.push('', SIGNOFF[lang][tone], MAILBOX_OWNER.name);

  return {
    subject: /^re:/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`,
    body: paragraphs.join('\n'),
    tone,
    language: lang,
    provider: 'deterministic',
  };
};

/** Deterministic draft, then the optional Claude rewording. */
export const draftReply = async (mail, options = {}) => {
  const draft = composeDraft(mail, options);
  const reworded = await draftReplyWithClaude({ mail, draft, instructions: options.instructions, language: draft.language });
  if (reworded?.body) {
    return { ...draft, body: reworded.body, provider: 'claude', model: reworded.model ?? null };
  }
  return draft;
};
