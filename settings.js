export const defaultSettings = {
  fontSize: 14,
  keepaliveIntervalSeconds: 30,
  disconnectTimeout: '30m',
  autoReconnect: true,
  habits: []
};

const disconnectTimeouts = new Set(['5m', '30m', '2h', 'never']);

export function normalizeSettings(input = {}) {
  return {
    fontSize: clampNumber(input.fontSize, 10, 24, defaultSettings.fontSize),
    keepaliveIntervalSeconds: clampNumber(
      input.keepaliveIntervalSeconds,
      10,
      300,
      defaultSettings.keepaliveIntervalSeconds
    ),
    disconnectTimeout: disconnectTimeouts.has(input.disconnectTimeout)
      ? input.disconnectTimeout
      : defaultSettings.disconnectTimeout,
    autoReconnect: typeof input.autoReconnect === 'boolean'
      ? input.autoReconnect
      : defaultSettings.autoReconnect,
    habits: normalizeHabits(input.habits)
  };
}

export function getDefaultStartupHabit(settings = {}) {
  const normalized = normalizeSettings(settings);
  return normalized.habits.find((habit) => habit.enabled) || null;
}

export function disconnectTimeoutToMs(value) {
  const normalized = normalizeSettings({ disconnectTimeout: value }).disconnectTimeout;
  if (normalized === 'never') return null;
  if (normalized === '5m') return 5 * 60 * 1000;
  if (normalized === '30m') return 30 * 60 * 1000;
  if (normalized === '2h') return 2 * 60 * 60 * 1000;
  return 30 * 60 * 1000;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeHabits(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((habit, index) => ({
      id: String(habit?.id || `habit-${index + 1}`).trim(),
      name: String(habit?.name || '').trim(),
      command: String(habit?.command || '').trim(),
      priority: clampNumber(habit?.priority, 1, 999, index + 1),
      enabled: habit?.enabled !== false
    }))
    .filter((habit) => habit.id && habit.name && habit.command)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}
