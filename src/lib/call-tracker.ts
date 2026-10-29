export type CallTrackerStatus = 'completed' | 'processing' | 'failed' | 'none';

export type CallTrackerEntry = {
  callId: string;
  salesperson: string;
  salespersonPhoneMasked: string;
  customerPhoneMasked: string;
  direction: 'INBOUND' | 'OUTBOUND';
  source: string;
  /** Local (IST) wall-clock time, "YYYY-MM-DDTHH:mm:ss" with no offset. */
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  talkTimeSeconds: number;
  recordingStatus: 'available' | 'processing' | 'missing';
  audioUrl?: string;
  transcriptStatus: CallTrackerStatus;
  summaryStatus: CallTrackerStatus;
  transcript?: string;
  summary?: string;
};

const SAMPLE_TRANSCRIPT =
  'Salesperson: Hello, this is a follow-up from FastTracks Car Care about your vehicle.\n' +
  'Customer: Yes, tell me.\n' +
  'Salesperson: Your car is ready for pickup. Would you like to collect it today?\n' +
  'Customer: I will come in the evening.';

const SAMPLE_SUMMARY =
  'Follow-up call to tell the customer the car is ready. Customer confirmed pickup in the evening.';

const SAMPLE: CallTrackerEntry[] = [
  {
    callId: '21469de064ad4f1c8b5e0a7d93c2e611',
    salesperson: 'Salesman 2',
    salespersonPhoneMasked: '****5252',
    customerPhoneMasked: '****1086',
    direction: 'OUTBOUND',
    source: 'Exotel',
    startedAt: '2026-10-28T11:34:49',
    endedAt: '2026-10-28T11:35:45',
    durationSeconds: 56,
    talkTimeSeconds: 44,
    recordingStatus: 'available',
    transcriptStatus: 'completed',
    summaryStatus: 'completed',
    transcript: SAMPLE_TRANSCRIPT,
    summary: SAMPLE_SUMMARY,
  },
  {
    callId: 'cd847b1d001d49a2a6f3e8b0c5174d92',
    salesperson: 'Salesman 2',
    salespersonPhoneMasked: '****5252',
    customerPhoneMasked: '****1086',
    direction: 'OUTBOUND',
    source: 'Exotel',
    startedAt: '2026-10-26T10:58:39',
    endedAt: '2026-10-26T10:59:13',
    durationSeconds: 35,
    talkTimeSeconds: 18,
    recordingStatus: 'available',
    transcriptStatus: 'completed',
    summaryStatus: 'completed',
    transcript: SAMPLE_TRANSCRIPT,
    summary: SAMPLE_SUMMARY,
  },
  {
    callId: '3758ae3c9be84d07b1c2f6a9e0d35c78',
    salesperson: 'Salesman 1',
    salespersonPhoneMasked: '****4902',
    customerPhoneMasked: '****1086',
    direction: 'OUTBOUND',
    source: 'Exotel',
    startedAt: '2026-10-24T17:44:13',
    endedAt: '2026-10-24T17:44:52',
    durationSeconds: 39,
    talkTimeSeconds: 17,
    recordingStatus: 'available',
    transcriptStatus: 'completed',
    summaryStatus: 'completed',
    transcript: SAMPLE_TRANSCRIPT,
    summary: SAMPLE_SUMMARY,
  },
];

// TODO: replace with a real backend API call once one exists (there is no
// call-tracker endpoint yet). Numbers must stay masked in the response.
export async function fetchCallTrackerEntries(): Promise<CallTrackerEntry[]> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return SAMPLE.map((entry) => ({ ...entry }));
}

// m:ss, e.g. 56 -> "0:56".
export function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// "2026-10-28T11:34:49" -> "28/10/2026, 11:34:49".
export function formatStamp(local: string) {
  const [date, time = ''] = local.split('T');
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}, ${time}`;
}

export function directionLabel(direction: CallTrackerEntry['direction']) {
  return direction === 'INBOUND' ? 'Incoming' : 'Outgoing';
}
