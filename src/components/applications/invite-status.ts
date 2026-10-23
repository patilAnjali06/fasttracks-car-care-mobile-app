import type { ApplicationInvite } from '@/types/api';

function fmt(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// A PENDING invite past its expiry is expired, whatever the stored status says.
export function inviteStatusLabel(inv: ApplicationInvite) {
  if (inv.status === 'USED') return `Used ${fmt(inv.usedAt)}`;
  if (inv.status === 'REVOKED') return 'Replaced by a newer invite';
  if (inv.status === 'EXPIRED' || (inv.status === 'PENDING' && new Date(inv.expiresAt) < new Date())) {
    return `Expired ${fmt(inv.expiresAt)}`;
  }
  return `Pending — expires ${fmt(inv.expiresAt)}`;
}
