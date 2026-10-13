import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { ROLES } from '../security/roles.js';

/**
 * User store (in-memory).
 *
 * Seeded with one demo account per role so the login flow and per-role answers
 * can be exercised without a database. Passwords are scrypt-hashed with a
 * per-user salt; the plain text lives only in the demo seed below and is never
 * stored or logged. Moves to the database (audit.users) with the rest of the
 * persistence layer - the shape here matches db/schema.sql.
 */

const hashPassword = (password) => {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
};

export const verifyPassword = (password, stored) => {
  if (typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  let derived;
  try {
    derived = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  } catch {
    return false;
  }
  return expected.length === derived.length && timingSafeEqual(expected, derived);
};

/**
 * Demo accounts. These credentials are intentionally visible - they unlock a
 * synthetic data set on a local prototype, nothing more - and are shown on the
 * sign-in screen as quick-fill buttons. Replace this seed with real identities
 * (SSO / Entra ID) before any deployment.
 */
const DEMO_USERS = [
  {
    email: 'manager@jervis.local',
    name: 'Mara Keller',
    jobTitle: 'Production manager',
    role: 'manager',
    password: 'Manager!2026',
  },
  {
    email: 'engineer@jervis.local',
    name: 'Jonas Vogel',
    jobTitle: 'Quality engineer',
    role: 'engineer',
    password: 'Engineer!2026',
  },
  {
    email: 'viewer@jervis.local',
    name: 'Lena Brandt',
    jobTitle: 'Line viewer',
    role: 'viewer',
    password: 'Viewer!2026',
  },
];

const users = new Map();

for (const seed of DEMO_USERS) {
  users.set(seed.email.toLowerCase(), {
    id: `usr_${seed.role}`,
    email: seed.email,
    name: seed.name,
    jobTitle: seed.jobTitle,
    role: seed.role,
    passwordHash: hashPassword(seed.password),
  });
}

/** Public, browser-safe demo account list (no secrets beyond the demo password). */
export const demoAccounts = () =>
  DEMO_USERS.map((seed) => ({
    email: seed.email,
    name: seed.name,
    role: seed.role,
    roleName: ROLES[seed.role]?.name ?? seed.role,
    password: seed.password,
  }));

export const findUserByEmail = (email) =>
  email ? users.get(String(email).trim().toLowerCase()) ?? null : null;

export const findUserById = (id) =>
  [...users.values()].find((user) => user.id === id) ?? null;

/** Update the display name and job title of a user (demo in-memory store). */
export const updateUserProfile = (id, { name, jobTitle } = {}) => {
  const user = findUserById(id);
  if (!user) return null;
  if (typeof name === 'string' && name.trim()) user.name = name.trim();
  if (typeof jobTitle === 'string') user.jobTitle = jobTitle.trim();
  return user;
};

/** Replace a user's password with a freshly hashed one. */
export const updateUserPassword = (id, newPassword) => {
  const user = findUserById(id);
  if (!user) return false;
  user.passwordHash = hashPassword(newPassword);
  return true;
};

/** The user shape safe to return to the client - never the password hash. */
export const publicUser = (user) =>
  user
    ? {
        id: user.id,
        email: user.email,
        name: user.name,
        jobTitle: user.jobTitle,
        role: user.role,
        roleName: ROLES[user.role]?.name ?? user.role,
      }
    : null;
