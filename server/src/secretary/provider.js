import { isLive } from '../integrations/store.js';
import { mockMailProvider } from './mailbox.js';
import { liveMailProvider } from '../connectors/microsoft365.connector.js';

/**
 * Picks the mailbox implementation the same way the other connectors do: the
 * live Microsoft Graph path only when credentials are set AND the connector
 * is enabled on the Integrations page; the synthetic mailbox otherwise.
 */
export const mailProvider = () => (isLive('microsoft365') ? liveMailProvider : mockMailProvider);

export const mailMode = () => mailProvider().mode;
