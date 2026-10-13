/**
 * Roles and permissions.
 *
 * The requirement document is explicit that unrestricted access to internal
 * information cannot be granted, and that user roles still have to be defined.
 * This is a working placeholder with the shape the real model will need:
 * named roles, a permission set, and enforcement at retrieval time rather than
 * in the UI. Swap the role source for SSO/Entra ID claims when that is agreed.
 */

export const ROLES = {
  viewer: {
    id: 'viewer',
    name: 'Line viewer',
    description: 'Shop-floor view: issues, rework and downtime for their own lines.',
    permissions: ['production:read'],
  },
  engineer: {
    id: 'engineer',
    name: 'Quality engineer',
    description: 'Full production detail including parts, suppliers and vehicle identifiers.',
    permissions: ['production:read', 'vehicle:read', 'supplier:read', 'maintenance:read'],
  },
  manager: {
    id: 'manager',
    name: 'Production manager',
    description: 'Everything an engineer sees, plus cost figures and the query audit trail.',
    permissions: [
      'production:read',
      'vehicle:read',
      'supplier:read',
      'maintenance:read',
      'finance:read',
      'audit:read',
      'integrations:manage',
    ],
  },
};

export const DEFAULT_ROLE = 'manager';

export const resolveAccess = (roleId, userId) => {
  const role = ROLES[roleId] ?? ROLES[DEFAULT_ROLE];
  return {
    role: role.id,
    roleName: role.name,
    userId: userId ?? 'demo-user',
    permissions: role.permissions,
  };
};

export const roleList = () => Object.values(ROLES);
