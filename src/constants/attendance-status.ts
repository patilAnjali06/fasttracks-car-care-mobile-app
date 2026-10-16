import type { AttendanceStatus } from '@/types/api';

// Single source of truth for attendance status colors — the existing
// Attendance/Home screen had no color-coding before this (contrary to the
// assumption that one already existed), so this follows the same
// STATUS_COLOR convention already used in tasks.tsx and more/reminders.tsx
// (hardcoded hex, keyed by backend enum) rather than inventing a new pattern.
// Colors and labels match the dashboard's `S` status map and `statusLabel()`
// verbatim (frontend/src/app/(dashboard)/dashboard/attendance/page.tsx).
export const ATTENDANCE_STATUS_COLOR: Record<AttendanceStatus, string> = {
  PRESENT: '#22c55e',
  LATE: '#f59e0b',
  HALF_DAY: '#f97316',
  ABSENT: '#ef4444',
  LEAVE: '#3b82f6',
  WEEKEND: '#5A5A6A',
};

export const NOT_CLOCKED_IN_COLOR = '#5A5A6A';

export function attendanceStatusColor(status: AttendanceStatus | null | undefined): string {
  if (!status) return NOT_CLOCKED_IN_COLOR;
  return ATTENDANCE_STATUS_COLOR[status] ?? NOT_CLOCKED_IN_COLOR;
}

const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  HALF_DAY: 'Half Day',
  ABSENT: 'Absent',
  LEAVE: 'Leave',
  WEEKEND: 'Weekend',
};

export function attendanceStatusLabel(status: AttendanceStatus | null | undefined): string {
  if (!status) return 'Not clocked in';
  return ATTENDANCE_STATUS_LABEL[status] ?? status;
}
