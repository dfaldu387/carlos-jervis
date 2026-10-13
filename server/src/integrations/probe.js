import net from 'node:net';
import tls from 'node:tls';
import { performance } from 'node:perf_hooks';
import { resolve_, isConfigured } from './store.js';
import { logger } from '../utils/logger.js';

/**
 * Connection probes.
 *
 * Each probe makes the smallest real call that proves the credentials reach
 * the system - a token request, a status read, an MQTT handshake - and returns
 * a uniform result. Nothing here reads production data; a probe only answers
 * "can Jervis reach this system with what it has been given".
 *
 *   { ok, status, detail, latencyMs }
 */

const TIMEOUT_MS = 8000;

const timed = async (fn) => {
  const started = performance.now();
  try {
    const result = await fn();
    return { latencyMs: Math.round(performance.now() - started), ...result };
  } catch (error) {
    return {
      ok: false,
      status: error.statusCode ?? null,
      detail: error.message,
      latencyMs: Math.round(performance.now() - started),
    };
  }
};

/** fetch with an AbortController timeout so a dead host cannot hang the probe. */
const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`No response within ${(options.timeoutMs ?? TIMEOUT_MS) / 1000}s`);
    }
    throw new Error(error.cause?.code ? `${error.message} (${error.cause.code})` : error.message);
  } finally {
    clearTimeout(timer);
  }
};

const probes = {
  async databricks(values) {
    const host = values.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const base = `https://${host}`;
    const headers = { authorization: `Bearer ${values.token}` };

    const warehouse = await fetchWithTimeout(
      `${base}/api/2.0/sql/warehouses/${encodeURIComponent(values.warehouseId)}`,
      { headers },
    );
    if (warehouse.status === 401 || warehouse.status === 403) {
      return { ok: false, status: warehouse.status, detail: 'Token rejected by the workspace.' };
    }
    if (!warehouse.ok) {
      return { ok: false, status: warehouse.status, detail: `Warehouse lookup returned ${warehouse.status}.` };
    }
    // A 200 is not enough: a parked domain or a proxy can return an HTML page.
    // Require a response that actually looks like the Statement/Warehouse API.
    const body = await warehouse.json().catch(() => null);
    if (!body || (body.id === undefined && body.state === undefined)) {
      return {
        ok: false,
        status: warehouse.status,
        detail: 'Host answered but did not return a Databricks warehouse. Check the host name.',
      };
    }
    return {
      ok: true,
      status: warehouse.status,
      detail: `Warehouse "${body.name ?? values.warehouseId}" is ${body.state ?? 'reachable'}.`,
    };
  },

  async powerbi(values) {
    const tokenResponse = await fetchWithTimeout(
      `https://login.microsoftonline.com/${encodeURIComponent(values.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: values.clientId,
          client_secret: values.clientSecret,
          scope: 'https://analysis.windows.net/powerbi/api/.default',
        }),
      },
    );
    const token = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      return {
        ok: false,
        status: tokenResponse.status,
        detail: token.error_description?.split('\n')[0] ?? 'Token request failed.',
      };
    }

    const reports = await fetchWithTimeout(
      `https://api.powerbi.com/v1.0/myorg/groups/${encodeURIComponent(values.workspaceId)}/reports`,
      { headers: { authorization: `Bearer ${token.access_token}` } },
    );
    if (!reports.ok) {
      return { ok: false, status: reports.status, detail: `Workspace read returned ${reports.status}.` };
    }
    const list = await reports.json().catch(() => ({ value: [] }));
    return {
      ok: true,
      status: reports.status,
      detail: `Authenticated; ${list.value?.length ?? 0} reports in the workspace.`,
    };
  },

  async integral_portal(values) {
    const base = values.baseUrl.replace(/\/$/, '');
    const path = values.healthPath || '/health';
    const response = await fetchWithTimeout(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
      headers: {
        authorization: `Bearer ${values.apiKey}`,
        'x-api-key': values.apiKey,
        accept: 'application/json',
      },
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, detail: 'API key rejected by the portal.' };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, detail: `Health check returned ${response.status}.` };
    }
    return { ok: true, status: response.status, detail: 'Portal health check passed.' };
  },

  async mqtt(values) {
    return mqttConnect(values);
  },

  async microsoft365(values) {
    const tokenResponse = await fetchWithTimeout(
      `https://login.microsoftonline.com/${encodeURIComponent(values.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: values.clientId,
          client_secret: values.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        }),
      },
    );
    const token = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      return {
        ok: false,
        status: tokenResponse.status,
        detail: token.error_description?.split('\n')[0] ?? 'Token request failed.',
      };
    }

    const folders = await fetchWithTimeout(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(values.mailbox)}/mailFolders`,
      { headers: { authorization: `Bearer ${token.access_token}` } },
    );
    if (folders.status === 401 || folders.status === 403) {
      return { ok: false, status: folders.status, detail: 'Graph rejected the token for this mailbox.' };
    }
    if (!folders.ok) {
      return { ok: false, status: folders.status, detail: `Mailbox read returned ${folders.status}.` };
    }
    const list = await folders.json().catch(() => ({ value: [] }));
    return {
      ok: true,
      status: folders.status,
      detail: `Authenticated; ${list.value?.length ?? 0} mail folders visible.`,
    };
  },

  async legacy_chatbot(values) {
    if (!values.url) return { ok: false, detail: 'No application URL configured.' };
    const response = await fetchWithTimeout(values.url, { method: 'GET' });
    return {
      ok: response.ok || response.status === 401 || response.status === 403,
      status: response.status,
      detail:
        response.status === 401 || response.status === 403
          ? 'Application responds (sign-in required).'
          : `Application responded with ${response.status}.`,
    };
  },
};

/**
 * Minimal MQTT 3.1.1 CONNECT/CONNACK over TCP or TLS. Proves the broker is
 * reachable and the credentials are accepted, without pulling in a client
 * library for a one-shot reachability check.
 */
const mqttConnect = (values) =>
  new Promise((resolve) => {
    let url;
    try {
      url = new URL(values.brokerUrl);
    } catch {
      resolve({ ok: false, detail: 'Broker URL is not valid.' });
      return;
    }

    const secure = url.protocol === 'mqtts:' || url.protocol === 'ssl:' || url.protocol === 'tls:';
    const port = Number(url.port) || (secure ? 8883 : 1883);
    const clientId = `jervis-probe-${Math.random().toString(16).slice(2, 10)}`;

    const payloads = [Buffer.from(clientId)];
    let flags = 0x02; // clean session
    if (values.username) {
      flags |= 0x80;
      payloads.push(Buffer.from(values.username));
      if (values.password) {
        flags |= 0x40;
        payloads.push(Buffer.from(values.password));
      }
    }

    const variableHeader = Buffer.concat([
      lengthPrefixed('MQTT'),
      Buffer.from([0x04, flags, 0x00, 0x3c]), // protocol level 4, flags, keepalive 60s
    ]);
    const payload = Buffer.concat(payloads.map(lengthPrefixed));
    const remaining = variableHeader.length + payload.length;
    const packet = Buffer.concat([
      Buffer.from([0x10, ...encodeRemainingLength(remaining)]),
      variableHeader,
      payload,
    ]);

    const options = { host: url.hostname, port };
    const socket = secure
      ? tls.connect({ ...options, rejectUnauthorized: false })
      : net.connect(options);

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ ok: false, detail: `No CONNACK within ${TIMEOUT_MS / 1000}s` }),
      TIMEOUT_MS,
    );

    socket.on(secure ? 'secureConnect' : 'connect', () => socket.write(packet));
    socket.on('data', (data) => {
      clearTimeout(timer);
      if (data[0] === 0x20 && data.length >= 4) {
        const code = data[3];
        if (code === 0) finish({ ok: true, detail: `Broker accepted the connection on port ${port}.` });
        else finish({ ok: false, detail: `Broker refused the connection (CONNACK code ${code}).` });
      } else {
        finish({ ok: false, detail: 'Unexpected response; not an MQTT broker?' });
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, detail: error.code ? `${error.code}` : error.message });
    });
  });

const lengthPrefixed = (value) => {
  const buffer = Buffer.from(value);
  return Buffer.concat([Buffer.from([buffer.length >> 8, buffer.length & 0xff]), buffer]);
};

const encodeRemainingLength = (length) => {
  const bytes = [];
  let value = length;
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0);
  return bytes;
};

/**
 * Run the probe for one connector against its currently resolved settings.
 * Returns a mock-mode result when required fields are missing rather than
 * attempting a call that is certain to fail.
 */
export const testConnection = async (integrationId) => {
  const probe = probes[integrationId];
  if (!probe) {
    return { ok: false, mode: 'unknown', detail: 'No probe is defined for this integration.' };
  }
  if (!isConfigured(integrationId)) {
    return {
      ok: false,
      mode: 'mock',
      detail: 'Required credentials are not set. Running on synthetic data until they are provided.',
    };
  }

  const values = resolve_(integrationId);
  logger.info('Testing integration connection', { integration: integrationId });
  const result = await timed(() => probe(values));
  return { mode: 'live', ...result };
};
