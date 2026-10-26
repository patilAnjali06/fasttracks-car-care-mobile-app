import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openExternalUrl } from '@/lib/open-url';
import type { CardEntry, PasswordEntry } from '@/types/api';

// Exactly the dashboard's PWD_CATEGORIES (password-manager/page.tsx).
export const PWD_CATEGORIES = ['Social Media', 'Email', 'Banking', 'Work', 'Shopping', 'Streaming', 'Developer', 'Other'];

// The dashboard's CAT_COLORS (Tailwind -100 background / -700 text), as hex.
const CAT_COLORS: Record<string, { bg: string; fg: string }> = {
  'Social Media': { bg: '#fce7f3', fg: '#be185d' },
  Email: { bg: '#dbeafe', fg: '#1d4ed8' },
  Banking: { bg: '#dcfce7', fg: '#15803d' },
  Work: { bg: '#f3e8ff', fg: '#7e22ce' },
  Shopping: { bg: '#ffedd5', fg: '#c2410c' },
  Streaming: { bg: '#fee2e2', fg: '#b91c1c' },
  Developer: { bg: '#f3f4f6', fg: '#374151' },
  Other: { bg: '#fef9c3', fg: '#a16207' },
};

// The dashboard's CARD_GRADIENTS (gray-900/slate-800 for CREDIT, emerald-900/
// teal-800 for DEBIT). There is no gradient library in this app, so each card
// uses the gradient's middle colour as a solid fill.
const CARD_COLORS = { CREDIT: '#1e293b', DEBIT: '#115e59' };

export const MASK = '••••••••';

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN');
}

function SmallButton({ label, onPress, color }: { label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.smallBtn}>
      <ThemedText type="small" style={color ? { color } : undefined}>{label}</ThemedText>
    </Pressable>
  );
}

function EyeButton({ revealed, onPress, color, size = 18 }: { revealed: boolean; onPress: () => void; color: string; size?: number }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={revealed ? 'Hide' : 'Reveal'} style={styles.eye}>
      <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={size} color={color} />
    </Pressable>
  );
}

export function PasswordCard({
  entry, revealed, canManage, onReveal, onCopy, onEdit, onDelete,
}: {
  entry: PasswordEntry;
  revealed?: string;
  canManage: boolean;
  onReveal: () => void;
  onCopy: (value: string, label: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const cat = CAT_COLORS[entry.category] ?? CAT_COLORS.Developer;
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.head}>
        <View style={styles.flex1}>
          <ThemedText type="smallBold" numberOfLines={1}>{entry.title}</ThemedText>
          {entry.url ? (
            <Pressable onPress={() => openExternalUrl(entry.url!.startsWith('http') ? entry.url : `https://${entry.url}`)}>
              <ThemedText type="small" style={styles.link} numberOfLines={1}>{entry.url}</ThemedText>
            </Pressable>
          ) : null}
        </View>
        <View style={[styles.pill, { backgroundColor: cat.bg }]}>
          <ThemedText type="small" style={{ color: cat.fg, fontWeight: '600' }}>{entry.category}</ThemedText>
        </View>
      </View>

      <View style={[styles.field, { backgroundColor: theme.background }]}>
        <View style={styles.flex1}>
          <ThemedText type="small" themeColor="textSecondary">Username</ThemedText>
          <ThemedText type="small" numberOfLines={1}>{entry.username}</ThemedText>
        </View>
        <SmallButton label="Copy" onPress={() => onCopy(entry.username, 'Username')} />
      </View>

      <View style={[styles.field, { backgroundColor: theme.background }]}>
        <View style={styles.flex1}>
          <ThemedText type="small" themeColor="textSecondary">Password</ThemedText>
          <ThemedText type="small" style={styles.mono} selectable={!!revealed}>{revealed || MASK}</ThemedText>
        </View>
        <EyeButton revealed={!!revealed} onPress={onReveal} color={theme.textSecondary} />
        {revealed ? <SmallButton label="Copy" onPress={() => onCopy(revealed, 'Password')} /> : null}
      </View>

      {entry.notes ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{entry.notes}</ThemedText> : null}

      <View style={styles.footer}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.flex1}>
          By {entry.addedBy?.name || 'Unknown'} · {fmtDate(entry.createdAt)}
        </ThemedText>
        {canManage && (
          <View style={styles.actions}>
            <SmallButton label="Edit" onPress={onEdit} color="#2563eb" />
            <SmallButton label="Delete" onPress={onDelete} color="#dc2626" />
          </View>
        )}
      </View>
    </ThemedView>
  );
}

const WHITE = '#ffffff';

export function CardVisual({
  card, revealedNum, revealedCvv, canManage, onRevealNum, onRevealCvv, onCopy, onEdit, onDelete,
}: {
  card: CardEntry;
  revealedNum?: string;
  revealedCvv?: string;
  canManage: boolean;
  onRevealNum: () => void;
  onRevealCvv: () => void;
  onCopy: (value: string, label: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <View>
      <View style={[styles.visual, { backgroundColor: CARD_COLORS[card.cardType] ?? CARD_COLORS.CREDIT }]}>
        <View style={styles.visualHead}>
          <View style={styles.flex1}>
            <ThemedText type="small" style={styles.bank}>{card.bankName}</ThemedText>
            <ThemedText type="smallBold" style={styles.onCard}>{card.label}</ThemedText>
          </View>
          <View style={styles.chip}>
            <View style={styles.chipCell} /><View style={styles.chipCell} />
            <View style={styles.chipCell} /><View style={styles.chipCell} />
          </View>
        </View>

        <View style={styles.numberRow}>
          <ThemedText style={[styles.onCard, styles.number]} selectable={!!revealedNum}>{revealedNum || card.cardNumber}</ThemedText>
          <EyeButton revealed={!!revealedNum} onPress={onRevealNum} color={WHITE} />
          {revealedNum ? (
            <Pressable onPress={() => onCopy(revealedNum, 'Card number')} hitSlop={8}>
              <ThemedText type="small" style={styles.onCard}>Copy</ThemedText>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.bottomRow}>
          <View style={styles.flex1}>
            <ThemedText type="small" style={styles.caption}>CARDHOLDER</ThemedText>
            <ThemedText type="small" style={styles.onCard} numberOfLines={1}>{card.cardholderName}</ThemedText>
          </View>
          <View style={styles.mid}>
            <ThemedText type="small" style={styles.caption}>EXPIRES</ThemedText>
            <ThemedText type="small" style={styles.onCard}>{card.expiry}</ThemedText>
          </View>
          <View style={styles.mid}>
            <ThemedText type="small" style={styles.caption}>CVV</ThemedText>
            <View style={styles.cvvRow}>
              <ThemedText type="small" style={[styles.onCard, styles.mono]} selectable={!!revealedCvv}>{revealedCvv || '•••'}</ThemedText>
              <EyeButton revealed={!!revealedCvv} onPress={onRevealCvv} color={WHITE} size={14} />
              {revealedCvv ? (
                <Pressable onPress={() => onCopy(revealedCvv, 'CVV')} hitSlop={8}>
                  <ThemedText type="small" style={styles.onCard}>Copy</ThemedText>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.flex1}>
          Added by {card.addedBy?.name || 'Unknown'} · {fmtDate(card.createdAt)}
        </ThemedText>
        {canManage && (
          <View style={styles.actions}>
            <SmallButton label="Edit" onPress={onEdit} color="#2563eb" />
            <SmallButton label="Delete" onPress={onDelete} color="#dc2626" />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  link: { color: '#3b82f6' },
  pill: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Spacing.four },
  field: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  mono: { fontFamily: 'monospace' },
  eye: { padding: Spacing.half },
  smallBtn: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.one },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  actions: { flexDirection: 'row', gap: Spacing.two },
  visual: { borderRadius: 16, padding: Spacing.four, minHeight: 200, gap: Spacing.three },
  visualHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  bank: { color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 1 },
  onCard: { color: WHITE },
  chip: { width: 40, height: 28, borderRadius: 4, backgroundColor: '#facc15', flexDirection: 'row', flexWrap: 'wrap', padding: 4, gap: 2 },
  chipCell: { width: '47%', height: '45%', borderRadius: 2, backgroundColor: '#ca8a04' },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  number: { flex: 1, fontFamily: 'monospace', fontSize: 16, letterSpacing: 2 },
  bottomRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  mid: { alignItems: 'center' },
  caption: { color: 'rgba(255,255,255,0.6)', fontSize: 10, letterSpacing: 0.5 },
  cvvRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
