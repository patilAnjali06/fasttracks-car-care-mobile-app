// Formatting helpers for the Overview screen — same output as the dashboard's
// dashboard/page.tsx (formatINR, formatDate, IST "today").

export function formatINR(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// "Today" in India, as YYYY-MM-DD, whatever the phone's own time zone is —
// the dashboard builds it the same way.
export function istToday() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function fromYmd(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toYmd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function longDate(ymd: string) {
  return fromYmd(ymd).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function shortDate(ymd: string) {
  return fromYmd(ymd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

type StatusLook = { variant: 'success' | 'danger' | 'muted' | 'purple' | 'blue' | 'orange'; label: string };

// Dashboard StatusBadge map; anything else falls back to a muted badge with the raw status.
const STATUS_LOOKS: Record<string, StatusLook> = {
  ACTIVE: { variant: 'success', label: 'Active' },
  DRAFT: { variant: 'muted', label: 'Draft' },
  PAID: { variant: 'success', label: 'Paid' },
  CANCELLED: { variant: 'danger', label: 'Cancelled' },
  IN_PROGRESS: { variant: 'purple', label: 'In Progress' },
  COMPLETED: { variant: 'success', label: 'Completed' },
  CLOSED: { variant: 'muted', label: 'Closed' },
  NEW_ENQUIRY: { variant: 'blue', label: 'New Enquiry' },
  QUOTED: { variant: 'purple', label: 'Quoted' },
  CONFIRMED: { variant: 'blue', label: 'Confirmed' },
  FOLLOW_UP_NEEDED: { variant: 'orange', label: 'Follow-up Needed' },
};

export function statusLook(status: string): StatusLook {
  return STATUS_LOOKS[status] ?? { variant: 'muted', label: status };
}

// Dashboard DailyBreakdown "Jobs by Status" dot colours.
export const JOB_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  IN_PROGRESS: { label: 'In Progress', color: '#6366f1' },
  READY: { label: 'Ready', color: '#f59e0b' },
  RELEASED: { label: 'Released', color: '#10b981' },
  WALKED_OUT: { label: 'Walked Out', color: '#ef4444' },
};
