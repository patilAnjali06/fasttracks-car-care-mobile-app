// Display helpers for the Call Tracker. Timestamps are local (IST) wall-clock
// strings, "YYYY-MM-DDTHH:mm:ss", so everything here is plain string work.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dayOf = (local: string) => local.slice(0, 10);

function parts(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
}

function addDays(ymd: string, delta: number) {
  const { y, m, d } = parts(ymd);
  const date = new Date(y, m - 1, d + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// "Salesman 2" -> "S2".
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

export function dayKey(local: string) {
  return dayOf(local);
}

// "Today", "Yesterday" or "Mon, 26 Oct".
export function dayHeading(ymd: string, todayYmd: string) {
  if (ymd === todayYmd) return 'Today';
  if (ymd === addDays(todayYmd, -1)) return 'Yesterday';
  const { y, m, d } = parts(ymd);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${d} ${MONTHS[m - 1]}`;
}

// "28 Oct 2026".
export function longDay(local: string) {
  const { y, m, d } = parts(dayOf(local));
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function clock12(local: string) {
  const [h, min] = local.split('T')[1].split(':').map(Number);
  return { text: `${h % 12 === 0 ? 12 : h % 12}:${String(min).padStart(2, '0')}`, meridiem: h < 12 ? 'AM' : 'PM' };
}

// "11:34 AM".
export function timeLabel(local: string) {
  const t = clock12(local);
  return `${t.text} ${t.meridiem}`;
}

// "11:34–11:35 AM", or "11:59 AM–12:01 PM" when the meridiem changes.
export function timeRange(startLocal: string, endLocal: string) {
  const a = clock12(startLocal);
  const b = clock12(endLocal);
  return a.meridiem === b.meridiem ? `${a.text}–${b.text} ${b.meridiem}` : `${a.text} ${a.meridiem}–${b.text} ${b.meridiem}`;
}

// "24 Oct – 28 Oct" style label for the header subtitle.
export function rangeLabel(fromYmd: string, toYmd: string) {
  if (!fromYmd && !toYmd) return 'All time';
  const f = (ymd: string) => {
    const { m, d } = parts(ymd);
    return `${d} ${MONTHS[m - 1]}`;
  };
  if (fromYmd && toYmd) return `${f(fromYmd)} – ${f(toYmd)}`;
  return fromYmd ? `From ${f(fromYmd)}` : `Until ${f(toYmd)}`;
}
