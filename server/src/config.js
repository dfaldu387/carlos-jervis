import 'dotenv/config';

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

/** Comma-separated env value -> trimmed, lower-cased, non-empty entries. */
const list = (value) =>
  String(value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

/** JSON object from an env value; anything else (unset, invalid, array) -> {}. */
const jsonObject = (value) => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4010),

  // The data layer is deliberately indirected: the prototype answers from the
  // bundled synthetic warehouse, and the real database drops in behind the same
  // repository contract (see src/data/repository.js).
  dataSource: process.env.JERVIS_DATA_SOURCE ?? 'memory',
  databaseUrl: process.env.DATABASE_URL ?? '',

  llm: {
    provider: process.env.JERVIS_LLM_PROVIDER ?? 'deterministic',
    model: process.env.JERVIS_LLM_MODEL ?? 'claude-opus-5-5',
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  },

  // Text-to-speech via ElevenLabs. The API key stays on the server; the browser
  // only receives the generated audio. Set the voice id to a Jackie Shroff
  // voice from your ElevenLabs account (a cloned voice or one you have rights
  // to use). Empty key or voice id falls back to the browser's own voice.
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY ?? '',
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? '',
    model: process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2',
  },

  // Every connector below is live only when its credentials are present. Until
  // then the mock implementation answers, which is what the security
  // constraints in the requirements expect during discovery.
  connectors: {
    databricks: {
      host: process.env.DATABRICKS_HOST ?? '',
      token: process.env.DATABRICKS_TOKEN ?? '',
      warehouseId: process.env.DATABRICKS_WAREHOUSE_ID ?? '',
    },
    powerbi: {
      tenantId: process.env.POWERBI_TENANT_ID ?? '',
      clientId: process.env.POWERBI_CLIENT_ID ?? '',
      clientSecret: process.env.POWERBI_CLIENT_SECRET ?? '',
      workspaceId: process.env.POWERBI_WORKSPACE_ID ?? '',
    },
    integralPortal: {
      baseUrl: process.env.INTEGRAL_PORTAL_BASE_URL ?? '',
      apiKey: process.env.INTEGRAL_PORTAL_API_KEY ?? '',
    },
    mqtt: {
      brokerUrl: process.env.MQTT_BROKER_URL ?? '',
      username: process.env.MQTT_USERNAME ?? '',
      password: process.env.MQTT_PASSWORD ?? '',
    },
  },

  audit: {
    enabled: bool(process.env.JERVIS_AUDIT_ENABLED, true),
    retainEntries: Number(process.env.JERVIS_AUDIT_RETAIN ?? 500),
  },

  // Authentication. Sessions are server-side; the browser holds only an opaque
  // httpOnly cookie. The header-role override is a development and test
  // convenience and is refused in production, where a real session is the only
  // way in.
  auth: {
    sessionTtlHours: Number(process.env.JERVIS_SESSION_TTL_HOURS ?? 8),
    cookieName: process.env.JERVIS_SESSION_COOKIE ?? 'jervis_session',
    cookieSecure: bool(process.env.JERVIS_COOKIE_SECURE, (process.env.NODE_ENV ?? '') === 'production'),
    allowHeaderRole: bool(
      process.env.JERVIS_ALLOW_HEADER_ROLE,
      (process.env.NODE_ENV ?? 'development') !== 'production',
    ),
    loginMaxAttempts: Number(process.env.JERVIS_LOGIN_MAX_ATTEMPTS ?? 10),
    loginWindowMinutes: Number(process.env.JERVIS_LOGIN_WINDOW_MINUTES ?? 5),
  },

  // Single sign-on (OpenID Connect, Microsoft Entra ID). Off unless the
  // provider is 'entra' and tenant, client id and client secret are all set;
  // the demo password accounts keep working either way. The role map ties
  // Entra group ids or app-role values to Jervis roles; anything unmapped gets
  // the default role. See docs/ACCESS-MODEL.md, "SSO (Entra ID)".
  sso: {
    provider: process.env.JERVIS_SSO_PROVIDER ?? '',
    tenantId: process.env.JERVIS_SSO_TENANT_ID ?? '',
    clientId: process.env.JERVIS_SSO_CLIENT_ID ?? '',
    clientSecret: process.env.JERVIS_SSO_CLIENT_SECRET ?? '',
    // The browser reaches the API through the UI's proxy (Vite dev server on
    // 5180, nginx on 80), so the redirect URI is the UI origin + the callback
    // path, and it must be registered on the Entra app exactly like this.
    redirectUri: process.env.JERVIS_SSO_REDIRECT_URI ?? 'http://127.0.0.1:5180/api/auth/sso/callback',
    roleMap: jsonObject(process.env.JERVIS_SSO_ROLE_MAP),
    defaultRole: process.env.JERVIS_SSO_DEFAULT_ROLE ?? 'viewer',
    allowedDomains: list(process.env.JERVIS_SSO_ALLOWED_DOMAINS),
  },

  // "Today" is pinned so the synthetic data set and the demo questions line up.
  // Unset it to follow the real clock.
  referenceDate: process.env.JERVIS_REFERENCE_DATE ?? '',
};

export const llmEnabled = () =>
  config.llm.provider === 'claude' && Boolean(config.llm.apiKey);

export const elevenLabsEnabled = () =>
  Boolean(config.elevenlabs.apiKey && config.elevenlabs.voiceId);

export const ssoEnabled = () =>
  config.sso.provider === 'entra' &&
  Boolean(config.sso.tenantId && config.sso.clientId && config.sso.clientSecret);
