const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A call that wasn't answered. Shared by the red rows and the Missed filter.
const MISSED_STATUSES = ['NO_ANSWER', 'BUSY', 'FAILED', 'CANCELED'];
export const isMissedCall = (status: string) => MISSED_STATUSES.includes(status);

export type CallGroup = 'Today' | 'Yesterday' | 'Earlier';

// Calendar-day difference in the device's local time zone (India on the
// users' phones): 0 = today, 1 = yesterday, negative = in the future.
function daysAgo(date: Date, now: Date) {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(now) - startOf(date)) / 86400000);
}

export function groupLabel(startedAt: string, now: Date = new Date()): CallGroup {
  const diff = daysAgo(new Date(startedAt), now);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return 'Earlier';
}

// Today: "10:30 AM" · Yesterday: "Yesterday" · Older: "12 Oct" ("12 Oct 2025"
// when it isn't this year).
export function formatCallTime(startedAt: string, now: Date = new Date()) {
  const date = new Date(startedAt);
  const diff = daysAgo(date, now);
  if (diff <= 0) {
    const h = date.getHours();
    const m = date.getMinutes().toString().padStart(2, '0');
    return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
  }
  if (diff === 1) return 'Yesterday';
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

export function formatCallDuration(seconds: number | null) {
  if (seconds == null) return null;
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

// Avatar colours (red, teal, orange, green, pink, blue, purple, amber), picked
// by a simple string hash so the same person always gets the same colour.
const AVATAR_COLORS = ['#E04A3F', '#0097A7', '#F57C1F', '#5FA03A', '#E91E63', '#2196F3', '#8E44AD', '#F2A900'];

export function avatarColor(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
