const GATE_DEFINITIONS = Object.freeze({
  salesforce_write: {
    envName: 'FCOS_DISABLE_SALESFORCE_WRITE',
    defaultEnabled: true,
    label: 'Salesforce writeback',
    description: 'Live Salesforce record and file creation, update, and deletion.',
  },
  google_drive: {
    envName: 'FCOS_DISABLE_GOOGLE_DRIVE',
    defaultEnabled: true,
    label: 'Google Drive archive',
    description: 'Google Drive report upload, download, rename, restore, and trash actions.',
  },
  email_delivery: {
    envName: 'FCOS_DISABLE_EMAIL_DELIVERY',
    defaultEnabled: true,
    label: 'Email delivery',
    description: 'Manual and scheduled SMTP email delivery.',
  },
  bank_execution: {
    envName: 'FCOS_ENABLE_BANK_EXECUTION',
    defaultEnabled: false,
    label: 'Bank execution',
    description: 'External bank instruction or execution.',
  },
  payment_promotion: {
    envName: 'FCOS_ENABLE_PAYMENT_PROMOTION',
    defaultEnabled: false,
    label: 'Payment promotion',
    description: 'Promotion of reviewed drafts into authoritative payment records.',
  },
});

function enabledValue(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function definitionEnabled(definition, env) {
  return definition.defaultEnabled
    ? !enabledValue(env[definition.envName])
    : enabledValue(env[definition.envName]);
}

export function externalActionGates(env = process.env) {
  return Object.fromEntries(Object.entries(GATE_DEFINITIONS).map(([key, definition]) => [key, {
    key,
    label: definition.label,
    description: definition.description,
    enabled: definitionEnabled(definition, env),
    expectedState: definition.defaultEnabled ? 'live' : 'uat_gated',
    control: definition.defaultEnabled ? 'emergency_kill_switch' : 'explicit_enablement',
  }]));
}

export function isExternalActionEnabled(key, env = process.env) {
  const definition = GATE_DEFINITIONS[key];
  if (!definition) return false;
  return definitionEnabled(definition, env);
}

export function requireExternalActionGate(key, env = process.env) {
  const definition = GATE_DEFINITIONS[key];
  if (!definition) {
    const error = new Error('Unknown FCOS external-action gate.');
    error.status = 500;
    error.code = 'UNKNOWN_EXTERNAL_ACTION_GATE';
    throw error;
  }
  if (isExternalActionEnabled(key, env)) return;
  const error = new Error(definition.defaultEnabled
    ? `${definition.label} has been paused by an emergency operational control.`
    : `${definition.label} is disabled until its business UAT gate is approved.`);
  error.status = 409;
  error.code = 'EXTERNAL_ACTION_GATE_DISABLED';
  error.gate = key;
  throw error;
}
