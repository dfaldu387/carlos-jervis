import { mulberry32, pick, weightedPick } from '../utils/ids.js';
import { SHIFTS, addDays, now, toIsoDate } from '../utils/dates.js';
import {
  ASSETS,
  CHECKPOINTS,
  ERROR_CODES,
  LINES,
  MODELS,
  PARTS,
  REWORK_CATEGORIES,
} from './catalog.js';

/**
 * Builds the synthetic production warehouse the prototype answers from.
 *
 * Shape mirrors what the demonstrated system surfaces: issues carrying error
 * code, symptom, line, shift, model, part, cost center, checkpoint and rework
 * category; maintenance tickets from the Integral Portal; and MQTT downtime
 * events. Generation is seeded, so every boot produces the same data set and
 * the same question gives the same answer.
 */

const DAYS_OF_HISTORY = 28;
const SEED = 20261005; // the date of the client meeting

const VIN_PREFIX = 'WDD';

const buildVin = (rng, sequence) => {
  const body = String(100000 + Math.floor(rng() * 899999));
  return `${VIN_PREFIX}${body}${String(sequence).padStart(4, '0')}`;
};

const timestampFor = (date, shift, rng) => {
  const offsetHours = shift.startHour + Math.floor(rng() * 8);
  const minutes = Math.floor(rng() * 60);
  const stamp = new Date(date.getTime());
  // The night shift starts on the previous calendar evening and runs past
  // midnight; hours >= 24 roll into the following day automatically.
  stamp.setUTCHours(offsetHours % 24, minutes, 0, 0);
  if (shift.id === 'S3' && offsetHours >= 24) {
    stamp.setUTCDate(stamp.getUTCDate() + 1);
  }
  return stamp.toISOString();
};

/** Weekday pressure: Mondays and Fridays run hotter, weekends barely run. */
const dayLoadFactor = (date) => {
  const day = date.getUTCDay();
  if (day === 0) return 0.15;
  if (day === 6) return 0.35;
  if (day === 1) return 1.15;
  if (day === 5) return 1.3;
  return 1;
};

const severityFor = (rng, errorCode) => {
  if (errorCode.category === 'Safety') return weightedPick(rng, [['critical', 4], ['high', 5], ['medium', 2]]);
  return weightedPick(rng, [['low', 4], ['medium', 6], ['high', 3], ['critical', 1]]);
};

const reworkFor = (rng, severity) => {
  if (severity === 'critical') {
    return weightedPick(rng, [['RW-REMOVED', 5], ['RW-HOLD', 3], ['RW-OFF', 2]]);
  }
  if (severity === 'high') {
    return weightedPick(rng, [['RW-OFF', 4], ['RW-REMOVED', 3], ['RW-IN', 3]]);
  }
  return weightedPick(rng, [['RW-IN', 6], ['RW-NONE', 3], ['RW-OFF', 1]]);
};

const statusFor = (rng, date, today) => {
  const ageDays = Math.round((today.getTime() - date.getTime()) / 86400000);
  if (ageDays > 3) return weightedPick(rng, [['resolved', 9], ['in_progress', 1]]);
  if (ageDays > 1) return weightedPick(rng, [['resolved', 6], ['in_progress', 3], ['open', 1]]);
  return weightedPick(rng, [['open', 4], ['in_progress', 4], ['resolved', 2]]);
};

export const buildDataset = () => {
  const rng = mulberry32(SEED);
  const today = now();
  const issues = [];
  const vehicles = new Map();
  const maintenanceTickets = [];
  const downtimeEvents = [];

  let vehicleSequence = 0;

  for (let dayOffset = DAYS_OF_HISTORY - 1; dayOffset >= 0; dayOffset -= 1) {
    const date = addDays(today, -dayOffset);
    const dateKey = toIsoDate(date);
    const load = dayLoadFactor(date);

    // Vehicles built that day, per line. Issues are drawn from this pool so a
    // single car can collect more than one finding - which is why the vehicle
    // count and the issue count differ, as they do in the real reports.
    const dayPool = new Map();
    for (const line of LINES) {
      const modelCandidates = MODELS.filter((model) => model.lines.includes(line.id));
      const pool = [];
      for (let i = 0; i < 26; i += 1) {
        vehicleSequence += 1;
        const model = modelCandidates.length > 0 ? pick(rng, modelCandidates) : MODELS[0];
        const vin = buildVin(rng, vehicleSequence);
        pool.push({ vin, modelId: model.id });
        vehicles.set(vin, { vin, modelId: model.id, lineId: line.id, builtOn: dateKey });
      }
      dayPool.set(line.id, pool);
    }

    for (const shift of SHIFTS) {
      const shiftFactor = shift.id === 'S3' ? 0.6 : shift.id === 'S2' ? 0.9 : 1;

      for (const line of LINES) {
        const baseCount = 2 + Math.floor(rng() * 5);
        const count = Math.max(0, Math.round(baseCount * load * shiftFactor));

        for (let i = 0; i < count; i += 1) {
          const candidates = ERROR_CODES.filter((entry) => entry.lines.includes(line.id));
          if (candidates.length === 0) continue;
          const errorCode = weightedPick(
            rng,
            candidates.map((entry) => [entry, entry.weight]),
          );

          const pool = dayPool.get(line.id) ?? [];
          const vehicle = pool.length > 0 ? pick(rng, pool) : null;
          const vin = vehicle?.vin ?? buildVin(rng, (vehicleSequence += 1));
          const model =
            MODELS.find((entry) => entry.id === vehicle?.modelId) ??
            pick(rng, MODELS.filter((entry) => entry.lines.includes(line.id)));

          const partId = pick(rng, errorCode.parts);
          const part = PARTS.find((entry) => entry.id === partId) ?? PARTS[0];
          const checkpointId = pick(rng, errorCode.checkpoints);
          const checkpoint =
            CHECKPOINTS.find((entry) => entry.id === checkpointId) ?? CHECKPOINTS[0];
          const severity = severityFor(rng, errorCode);
          const reworkCategoryId = reworkFor(rng, severity);
          const reworkCategory = REWORK_CATEGORIES.find((entry) => entry.id === reworkCategoryId);
          const detectedAt = timestampFor(date, shift, rng);

          issues.push({
            id: `ISS-${String(issues.length + 1).padStart(5, '0')}`,
            date: dateKey,
            detectedAt,
            shiftId: shift.id,
            lineId: line.id,
            modelId: model.id,
            vin,
            errorCode: errorCode.code,
            errorDescription: errorCode.description,
            category: errorCode.category,
            symptom: errorCode.symptom,
            partId: part.id,
            costCenter: line.costCenter,
            checkpointId: checkpoint.id,
            severity,
            reworkCategoryId,
            vehicleRemoved: Boolean(reworkCategory?.removesVehicle),
            reworkMinutes:
              reworkCategoryId === 'RW-NONE' ? 0 : 15 + Math.floor(rng() * 150),
            status: statusFor(rng, date, today),
            source: 'databricks',
            sourceTable: 'prod_quality.issue_events',
          });
        }
      }

      // Maintenance work recorded in the Integral Portal, loosely correlated
      // with the issues above rather than generated per issue.
      if (rng() > 0.55) {
        const asset = pick(rng, ASSETS);
        const openedAt = timestampFor(date, shift, rng);
        const resolved = rng() > 0.3;
        maintenanceTickets.push({
          id: `MT-${String(maintenanceTickets.length + 1).padStart(4, '0')}`,
          date: dateKey,
          shiftId: shift.id,
          assetId: asset.id,
          assetName: asset.name,
          lineId: asset.line,
          openedAt,
          closedAt: resolved
            ? new Date(new Date(openedAt).getTime() + (30 + rng() * 300) * 60000).toISOString()
            : null,
          status: resolved ? 'closed' : 'open',
          priority: weightedPick(rng, [['low', 3], ['medium', 5], ['high', 2]]),
          description: pick(rng, [
            'Preventive maintenance on actuator',
            'Sensor replacement after signal loss',
            'Hydraulic leak repair',
            'Calibration after tool change',
            'Unplanned stop - drive fault',
          ]),
          technician: pick(rng, ['Team A', 'Team B', 'Team C']),
          source: 'integral_portal',
        });
      }

      // MQTT downtime signals per line.
      for (const line of LINES) {
        if (rng() > 0.6) {
          const asset = ASSETS.find((entry) => entry.line === line.id) ?? ASSETS[0];
          downtimeEvents.push({
            id: `DT-${String(downtimeEvents.length + 1).padStart(4, '0')}`,
            date: dateKey,
            shiftId: shift.id,
            lineId: line.id,
            assetId: asset.id,
            topic: `plant1/${line.id.toLowerCase()}/${asset.id.toLowerCase()}/state`,
            startedAt: timestampFor(date, shift, rng),
            durationMinutes: 3 + Math.floor(rng() * 55),
            reason: pick(rng, [
              'Material shortage',
              'Robot fault',
              'Conveyor jam',
              'Tool change',
              'Quality stop',
            ]),
            source: 'mqtt',
          });
        }
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    referenceDate: toIsoDate(today),
    daysOfHistory: DAYS_OF_HISTORY,
    issues,
    vehicles: [...vehicles.values()],
    maintenanceTickets,
    downtimeEvents,
  };
};
