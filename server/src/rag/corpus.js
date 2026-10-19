import { DocumentIndex } from './store.js';
import { logger } from '../utils/logger.js';

/**
 * Prototype document corpus.
 *
 * A small set of synthetic procedure and reference documents so document search
 * works out of the box and the ACL filter can be demonstrated with the three
 * demo roles. No Mercedes content is used. Replace `buildCorpus()` with the
 * real ingest (SharePoint / file share / mailbox via Microsoft Graph) once a
 * read-only source is agreed — the index and the tool do not change.
 *
 * ACL groups (mapped from the role until SSO/Entra group claims exist):
 *   all         — every signed-in user with documents:read
 *   engineering — quality engineers and managers
 *   management  — managers only (cost / confidential)
 */

export const groupsForRole = (role) => {
  switch (role) {
    case 'manager':
      return ['all', 'engineering', 'management'];
    case 'engineer':
      return ['all', 'engineering'];
    case 'viewer':
    default:
      return ['all'];
  }
};

const DOCUMENTS = [
  {
    id: 'proc-paint-defect',
    title: 'Escalation procedure for a paint defect',
    source: 'sharepoint',
    language: 'en',
    acl: ['all'],
    content:
      'When a paint defect is detected at a checkpoint, the line operator records the error code and ' +
      'severity in the quality system. For a high or critical severity defect the vehicle is flagged ' +
      'for rework and the shift lead is notified immediately. If more than three vehicles on the same ' +
      'shift show the same error code, raise an escalation to the paint shop supervisor and open an ' +
      'Integral Portal maintenance ticket against the affected spray booth. Critical safety defects ' +
      'always remove the vehicle from the line until signed off by a quality engineer.',
  },
  {
    id: 'proc-rework-handling',
    title: 'Rework handling and vehicle removal',
    source: 'sharepoint',
    language: 'en',
    acl: ['all', 'engineering'],
    content:
      'Rework is categorised as minor, major or vehicle-removing. Minor rework is completed in station ' +
      'within the takt time. Major rework moves the vehicle to the rework bay and is logged with the ' +
      'rework minutes. A vehicle-removing category takes the vehicle off the line entirely and requires ' +
      'a quality engineer sign-off before it can re-enter. Rework minutes feed the rework tracking ' +
      'report in Power BI and the estimated rework cost measure.',
  },
  {
    id: 'proc-line-stop',
    title: 'Line stop and downtime reporting',
    source: 'fileshare',
    language: 'en',
    acl: ['all'],
    content:
      'A line stop is any interruption longer than two minutes. The MQTT telemetry broker records the ' +
      'stop with its start time, duration and a reason code on the plant1/<line>/<asset>/state topic. ' +
      'Maintenance is notified automatically for stops longer than fifteen minutes. The downtime event ' +
      'and the related maintenance ticket are linked by asset id so the daily summary can show both.',
  },
  {
    id: 'ref-shift-model',
    title: 'Shift model and reporting windows',
    source: 'sharepoint',
    language: 'en',
    acl: ['all'],
    content:
      'The plant runs three shifts: early shift 06:00 to 14:00, late shift 14:00 to 22:00 and night ' +
      'shift 22:00 to 06:00. Daily summaries cover a calendar day; shift summaries cover one shift ' +
      'window. German reporting uses Frühschicht, Spätschicht and Nachtschicht for the three shifts.',
  },
  {
    id: 'ref-kostenstelle',
    title: 'Kostenstellen und Nacharbeitskosten',
    source: 'sharepoint',
    language: 'de',
    // Cost content is management-only, mirroring the finance:read boundary.
    acl: ['management'],
    content:
      'Jede Produktionslinie ist einer Kostenstelle zugeordnet. Die Nacharbeitskosten werden aus den ' +
      'erfassten Nacharbeitsminuten und einem Stundensatz berechnet und im Finanz-Workspace in Power BI ' +
      'ausgewiesen. Kostenkennzahlen sind nur für die Rolle Produktionsleiter sichtbar. Die ' +
      'Erstdurchlaufquote (First Pass Yield) misst den Anteil fehlerfrei gefertigter Fahrzeuge.',
  },
];

let index = null;

/** Build (once) and return the document index. */
export const getDocumentIndex = () => {
  if (index) return index;
  index = new DocumentIndex();
  index.addDocuments(DOCUMENTS);
  logger.info('Document index built', { documents: DOCUMENTS.length, chunks: index.size });
  return index;
};

export const resetDocumentIndex = () => {
  index = null;
};

export const corpusDocuments = () => DOCUMENTS;
