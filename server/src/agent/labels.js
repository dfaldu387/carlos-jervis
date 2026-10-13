import {
  CHECKPOINTS,
  COST_CENTERS,
  ERROR_CODES,
  LINES,
  MODELS,
  PARTS,
  REWORK_CATEGORIES,
} from '../data/catalog.js';
import { SHIFTS } from '../utils/dates.js';

/** Turns a raw dimension key into the wording a manager expects to read. */
export const labelFor = (dimension, key) => {
  switch (dimension) {
    case 'shiftId': {
      const shift = SHIFTS.find((entry) => entry.id === key);
      return shift ? `${shift.name} ${shift.label}` : key;
    }
    case 'lineId':
      return LINES.find((entry) => entry.id === key)?.name ?? key;
    case 'modelId':
      return MODELS.find((entry) => entry.id === key)?.name ?? key;
    case 'errorCode': {
      const code = ERROR_CODES.find((entry) => entry.code === key);
      return code ? `${code.code} ${code.description}` : key;
    }
    case 'partId': {
      const part = PARTS.find((entry) => entry.id === key);
      return part ? part.name : key;
    }
    case 'costCenter': {
      const center = COST_CENTERS.find((entry) => entry.id === key);
      return center ? `${center.id} ${center.name}` : key;
    }
    case 'checkpointId': {
      const checkpoint = CHECKPOINTS.find((entry) => entry.id === key);
      return checkpoint ? `${checkpoint.id} ${checkpoint.name}` : key;
    }
    case 'reworkCategoryId':
      return REWORK_CATEGORIES.find((entry) => entry.id === key)?.name ?? key;
    case 'status':
      return { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' }[key] ?? key;
    case 'severity':
      return String(key).replace(/^./, (character) => character.toUpperCase());
    default:
      return key;
  }
};

export const errorCodeLabel = (code) => labelFor('errorCode', code);
export const lineLabel = (id) => labelFor('lineId', id);
export const modelLabel = (id) => labelFor('modelId', id);
export const shiftLabel = (id) => labelFor('shiftId', id);
