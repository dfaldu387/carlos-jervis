/**
 * Integration definitions.
 *
 * One entry per system Jervis connects to: which settings it needs, which of
 * them are secrets, and which environment variable seeds each one. The
 * Integrations page is rendered from this table, the settings store validates
 * against it, and the connector registry reads credentials through it - so
 * adding a system is one entry here plus its connector module.
 *
 * `secret: true` fields are never returned to the browser; the API reports only
 * whether they are set and their last four characters.
 */

export const INTEGRATIONS = [
  {
    id: 'databricks',
    name: 'Databricks',
    docsUrl: 'https://docs.databricks.com/api/workspace/statementexecution',
    summary:
      'SQL warehouse holding the production issue events. Jervis runs read-only statements through the Statement Execution API.',
    fields: [
      {
        key: 'host',
        label: 'Workspace host',
        env: 'DATABRICKS_HOST',
        placeholder: 'adb-1234567890123456.7.azuredatabricks.net',
        help: 'Host name only, without https://.',
        required: true,
      },
      {
        key: 'token',
        label: 'Access token',
        env: 'DATABRICKS_TOKEN',
        secret: true,
        help: 'Personal access token or service-principal token with read scopes.',
        required: true,
      },
      {
        key: 'warehouseId',
        label: 'SQL warehouse ID',
        env: 'DATABRICKS_WAREHOUSE_ID',
        placeholder: 'abcdef0123456789',
        required: true,
      },
      {
        key: 'catalog',
        label: 'Catalog',
        env: 'DATABRICKS_CATALOG',
        placeholder: 'main',
        help: 'Unity Catalog name the production schemas live in.',
      },
      {
        key: 'schema',
        label: 'Schema',
        env: 'DATABRICKS_SCHEMA',
        placeholder: 'prod_quality',
        help: 'Schema with issue_events, tickets and downtime_events (see db/schema.sql).',
      },
    ],
    probe: 'Reads the warehouse status, then runs SELECT 1 through the Statement Execution API.',
    liveBehaviour:
      'When selected as the data source, every production question is answered with SQL against the warehouse instead of the synthetic data set.',
  },
  {
    id: 'powerbi',
    name: 'Power BI',
    docsUrl: 'https://learn.microsoft.com/rest/api/power-bi/datasets/execute-queries',
    summary:
      'Management dashboards. Jervis reads the workspace report list for deep links and, when a DAX query is configured, the published measures.',
    fields: [
      {
        key: 'tenantId',
        label: 'Tenant ID',
        env: 'POWERBI_TENANT_ID',
        placeholder: '00000000-0000-0000-0000-000000000000',
        required: true,
      },
      {
        key: 'clientId',
        label: 'Application (client) ID',
        env: 'POWERBI_CLIENT_ID',
        placeholder: '00000000-0000-0000-0000-000000000000',
        required: true,
      },
      {
        key: 'clientSecret',
        label: 'Client secret',
        env: 'POWERBI_CLIENT_SECRET',
        secret: true,
        required: true,
      },
      {
        key: 'workspaceId',
        label: 'Workspace (group) ID',
        env: 'POWERBI_WORKSPACE_ID',
        placeholder: '00000000-0000-0000-0000-000000000000',
        required: true,
      },
      {
        key: 'datasetId',
        label: 'Dataset ID for measures',
        env: 'POWERBI_DATASET_ID',
        help: 'Optional. Enables executeQueries for the KPI measures.',
      },
      {
        key: 'measuresQuery',
        label: 'DAX measures query',
        env: 'POWERBI_MEASURES_DAX',
        multiline: true,
        placeholder:
          'EVALUATE ROW("issues_total", [Issues], "vehicles_reworked", [Vehicles Reworked])',
        help: 'Optional. Must return one row; column names map to measure keys (issues_total, vehicles_affected, vehicles_reworked, vehicles_removed, rework_minutes, first_pass_yield, rework_cost).',
      },
    ],
    probe: 'Acquires an Entra ID token with the app registration, then lists the reports in the workspace.',
    liveBehaviour:
      'Report links in answers point at the real workspace. Measures come from the DAX query when one is configured, otherwise they are computed from the active data source.',
  },
  {
    id: 'integral_portal',
    name: 'Integral Portal',
    docsUrl: null,
    summary: 'Maintenance portal. Jervis lists tickets for the period a question covers.',
    fields: [
      {
        key: 'baseUrl',
        label: 'Base URL',
        env: 'INTEGRAL_PORTAL_BASE_URL',
        placeholder: 'https://integral.internal',
        required: true,
      },
      {
        key: 'apiKey',
        label: 'API key',
        env: 'INTEGRAL_PORTAL_API_KEY',
        secret: true,
        help: 'Sent as Authorization: Bearer and as x-api-key.',
        required: true,
      },
      {
        key: 'ticketsPath',
        label: 'Tickets endpoint path',
        env: 'INTEGRAL_PORTAL_TICKETS_PATH',
        placeholder: '/api/tickets',
        help: 'Receives from, to and line as query parameters. Default /api/tickets.',
      },
      {
        key: 'healthPath',
        label: 'Health check path',
        env: 'INTEGRAL_PORTAL_HEALTH_PATH',
        placeholder: '/health',
        help: 'Used by Test connection. Default /health.',
      },
    ],
    probe: 'Calls the health check path with the API key and reports the HTTP status.',
    liveBehaviour:
      'Maintenance questions read tickets from the portal; the synthetic tickets are used only when the call fails.',
  },
  {
    id: 'mqtt',
    name: 'MQTT Explorer',
    docsUrl: 'https://mqtt.org/mqtt-specification/',
    summary:
      'Line telemetry broker. Jervis subscribes to the state topics and turns stop/run transitions into downtime events.',
    fields: [
      {
        key: 'brokerUrl',
        label: 'Broker URL',
        env: 'MQTT_BROKER_URL',
        placeholder: 'mqtt://broker.internal:1883',
        help: 'mqtt:// or mqtts://.',
        required: true,
      },
      { key: 'username', label: 'Username', env: 'MQTT_USERNAME' },
      { key: 'password', label: 'Password', env: 'MQTT_PASSWORD', secret: true },
      {
        key: 'topic',
        label: 'Topic filter',
        env: 'MQTT_TOPIC',
        placeholder: 'plant1/+/+/state',
        help: 'Default plant1/+/+/state. Payload "stopped"/"running" or JSON {state, reason, line}.',
      },
    ],
    probe: 'Opens a TCP or TLS session, sends MQTT CONNECT and waits for CONNACK.',
    liveBehaviour:
      'A persistent subscription records downtime as it happens; downtime questions read those events first.',
  },
  {
    id: 'microsoft365',
    name: 'Microsoft 365 (mail and calendar)',
    docsUrl: 'https://learn.microsoft.com/graph/api/resources/mail-api-overview',
    summary:
      'Mailbox and calendar of the signed-in production manager. Jervis reads mail and events through Microsoft Graph and drafts replies; sending always needs an explicit confirmation.',
    fields: [
      {
        key: 'tenantId',
        label: 'Tenant ID',
        env: 'MS365_TENANT_ID',
        placeholder: '00000000-0000-0000-0000-000000000000',
        required: true,
      },
      {
        key: 'clientId',
        label: 'Application (client) ID',
        env: 'MS365_CLIENT_ID',
        placeholder: '00000000-0000-0000-0000-000000000000',
        help: 'App registration with Mail.ReadWrite, Mail.Send and Calendars.Read application permissions.',
        required: true,
      },
      {
        key: 'clientSecret',
        label: 'Client secret',
        env: 'MS365_CLIENT_SECRET',
        secret: true,
        required: true,
      },
      {
        key: 'mailbox',
        label: 'Mailbox (user principal name)',
        env: 'MS365_MAILBOX',
        placeholder: 'production.manager@plant.example',
        help: 'The mailbox Jervis reads on behalf of the user. Scoped with an application access policy in Exchange Online.',
        required: true,
      },
      {
        key: 'timezone',
        label: 'Mailbox time zone',
        env: 'MS365_TIMEZONE',
        placeholder: 'W. Europe Standard Time',
        help: 'Optional. Windows or IANA name used for the calendar day window and the Prefer: outlook.timezone header. Default W. Europe Standard Time.',
      },
    ],
    probe:
      'Acquires an Entra ID token with the app registration, then calls Microsoft Graph GET /users/{mailbox}/mailFolders to confirm the mailbox is reachable.',
    liveBehaviour:
      'Inbox, calendar and reply calls go to Microsoft Graph for the configured mailbox; a reply really leaves the mailbox after the explicit confirmation. Until then a synthetic mailbox answers, and replies are simulated.',
  },
  {
    id: 'power_automate',
    name: 'Power Automate',
    docsUrl: 'https://learn.microsoft.com/power-automate/triggers-introduction',
    summary:
      'Approved Power Automate flows Jervis can start (escalations, maintenance requests, report distribution) and the inbound path flows use to ask Jervis a question. Mock mode simulates every trigger; live mode posts to the HTTP trigger of the flow after the user confirms.',
    fields: [
      {
        key: 'triggerUrl',
        label: 'Default flow trigger URL',
        env: 'POWER_AUTOMATE_TRIGGER_URL',
        secret: true,
        help: 'HTTP-trigger URL ("When an HTTP request is received") of an approved flow. Carries its signature, so it is stored as a secret. Used for every catalog flow without its own url.',
        required: true,
      },
      {
        key: 'inboundSecret',
        label: 'Inbound shared secret',
        env: 'POWER_AUTOMATE_INBOUND_SECRET',
        secret: true,
        help: 'Optional. Flows that call POST /api/automate/inbound send it as the x-jervis-automate-secret header. Inbound stays disabled (503) while it is empty.',
      },
      {
        key: 'flowCatalog',
        label: 'Flow catalog (JSON)',
        env: 'POWER_AUTOMATE_FLOWS',
        multiline: true,
        placeholder:
          '[{ "name": "escalate-quality-issue", "label": "Escalate a quality issue", "url": "https://prod-xx.westeurope.logic.azure.com/..." }]',
        help: 'Optional. The flows Jervis may start: name (slug), label, optional url (defaults to the trigger URL above) and description. Without it the three built-in sample flows are listed.',
      },
    ],
    probe:
      'Live mode only: posts { "ping": true, "source": "jervis" } to the default trigger URL and reports the HTTP status. The flow should answer a ping with 200 without doing any work. In mock mode nothing is called.',
    liveBehaviour:
      'A confirmed trigger posts { flow, payload, requestedBy, requestedAt } to the flow URL and the run id comes back from the flow. Until then triggers are simulated and only recorded in the audit trail.',
  },
  {
    id: 'legacy_chatbot',
    name: 'Existing production chatbot',
    docsUrl: null,
    summary:
      'The Databricks application in use for about a year. Registered so its URL can be linked from answers while discovery decides whether Jervis extends or wraps it.',
    fields: [
      {
        key: 'url',
        label: 'Application URL',
        env: 'LEGACY_CHATBOT_URL',
        placeholder: 'https://databricks.internal/apps/production-chatbot',
      },
    ],
    probe: 'Requests the application URL and reports whether it responds.',
    liveBehaviour: 'Link only. No data is read from the application.',
  },
];

export const integrationById = (id) => INTEGRATIONS.find((entry) => entry.id === id) ?? null;

export const SECRET_KEYS = Object.fromEntries(
  INTEGRATIONS.map((entry) => [
    entry.id,
    entry.fields.filter((field) => field.secret).map((field) => field.key),
  ]),
);
