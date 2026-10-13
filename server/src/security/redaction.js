/**
 * Field-level redaction applied after retrieval, before the answer leaves the
 * server. Withheld values are replaced by a marker and reported in
 * `redactions`, so the UI can tell the user something was held back instead of
 * silently showing an incomplete answer.
 */

const MASK = 'restricted';

const RULES = [
  { permission: 'vehicle:read', columns: ['vin'], reason: 'Vehicle identifiers' },
  { permission: 'supplier:read', columns: ['supplier'], reason: 'Supplier names' },
  {
    permission: 'finance:read',
    columns: ['reworkCost', 'cost'],
    metrics: ['rework_cost', 'downtime_cost'],
    tables: ['by-cost-center'],
    reason: 'Cost figures and cost center breakdown',
  },
];

export const redactAnswer = (answer, access) => {
  const redactions = [];
  const permissions = access.permissions ?? [];

  const metrics = (answer.metrics ?? []).filter((item) => {
    const rule = RULES.find((entry) => entry.metrics?.includes(item.key));
    if (rule && !permissions.includes(rule.permission)) {
      redactions.push({ element: `metric:${item.key}`, reason: rule.reason });
      return false;
    }
    return true;
  });

  const tables = (answer.tables ?? [])
    .filter((table) => {
      const rule = RULES.find((entry) => entry.tables?.includes(table.id));
      if (rule && !permissions.includes(rule.permission)) {
        redactions.push({ element: `table:${table.id}`, reason: rule.reason });
        return false;
      }
      return true;
    })
    .map((table) => {
      const blockedColumns = RULES.filter(
        (rule) => !permissions.includes(rule.permission),
      ).flatMap((rule) => rule.columns ?? []);

      if (blockedColumns.length === 0) return table;

      const columns = table.columns.filter((column) => !blockedColumns.includes(column.key));
      const removed = table.columns.length - columns.length;
      if (removed > 0) {
        redactions.push({
          element: `table:${table.id}`,
          reason: `${removed} column(s) withheld`,
        });
      }

      return {
        ...table,
        columns,
        rows: table.rows.map((row) => {
          const copy = { ...row };
          for (const key of blockedColumns) {
            if (key in copy) copy[key] = MASK;
          }
          return copy;
        }),
      };
    });

  return { ...answer, metrics, tables, redactions };
};
