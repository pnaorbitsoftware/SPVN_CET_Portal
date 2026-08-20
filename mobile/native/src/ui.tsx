import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from './theme';

export function Screen({ children, refreshing = false, onRefresh, style }: PropsWithChildren<{ refreshing?: boolean; onRefresh?: () => void; style?: StyleProp<ViewStyle> }>) {
  return <ScrollView
    contentInsetAdjustmentBehavior="automatic"
    keyboardShouldPersistTaps="handled"
    refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
    contentContainerStyle={[styles.screen, style]}
  >{children}</ScrollView>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: PropsWithChildren) { return <Text selectable style={styles.title}>{children}</Text>; }
export function SectionTitle({ children }: PropsWithChildren) { return <Text selectable style={styles.sectionTitle}>{children}</Text>; }
export function Body({ children, muted = false }: PropsWithChildren<{ muted?: boolean }>) { return <Text selectable style={muted ? styles.muted : styles.body}>{children}</Text>; }

export function Button({ title, onPress, variant = 'primary', disabled = false, busy = false, compact = false }: { title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; busy?: boolean; compact?: boolean }) {
  return <Pressable
    accessibilityRole="button"
    disabled={disabled || busy}
    onPress={onPress}
    style={({ pressed }) => [styles.button, compact && styles.buttonCompact, styles[`${variant}Button`], (disabled || busy) && styles.disabled, pressed && styles.pressed]}
  >{busy ? <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? colors.white : colors.primary} /> : <Text style={[styles.buttonText, styles[`${variant}ButtonText`]]}>{title}</Text>}</Pressable>;
}

export function Field({ label, value, onChangeText, placeholder, secureTextEntry, keyboardType, multiline = false, autoCapitalize = 'sentences' }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; secureTextEntry?: boolean; keyboardType?: KeyboardTypeOptions; multiline?: boolean; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters' }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput
    value={value}
    onChangeText={onChangeText}
    placeholder={placeholder}
    placeholderTextColor="#87968c"
    secureTextEntry={secureTextEntry}
    keyboardType={keyboardType}
    multiline={multiline}
    autoCapitalize={autoCapitalize}
    style={[styles.input, multiline && styles.multiline]}
  /></View>;
}

export function Chips({ values, selected, onChange, multiple = false }: { values: string[]; selected: string[]; onChange: (selected: string[]) => void; multiple?: boolean }) {
  const toggle = (value: string) => {
    if (!multiple) return onChange([value]);
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };
  return <View style={styles.chips}>{values.map((value) => {
    const active = selected.includes(value);
    return <Pressable key={value} onPress={() => toggle(value)} style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{value}</Text></Pressable>;
  })}</View>;
}

export function Stat({ value, label }: { value: string | number; label: string }) {
  return <Card style={styles.stat}><Text selectable style={styles.statValue}>{value}</Text><Text selectable style={styles.statLabel}>{label}</Text></Card>;
}

export function Row({ children, wrap = false }: PropsWithChildren<{ wrap?: boolean }>) { return <View style={[styles.row, wrap && styles.wrap]}>{children}</View>; }
export function Empty({ message }: { message: string }) { return <Card><Body muted>{message}</Body></Card>; }
export function Loading({ message = 'Loading…' }: { message?: string }) { return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /><Body muted>{message}</Body></View>; }
export function ErrorText({ children }: PropsWithChildren) { return <Text selectable style={styles.error}>{children}</Text>; }
export function Badge({ children, tone = 'primary' }: PropsWithChildren<{ tone?: 'primary' | 'warning' | 'danger' }>) { return <View style={[styles.badge, tone === 'warning' && styles.badgeWarning, tone === 'danger' && styles.badgeDanger]}><Text style={[styles.badgeText, tone === 'warning' && styles.badgeTextWarning, tone === 'danger' && styles.badgeTextDanger]}>{children}</Text></View>; }
export function DataLine({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) { return <View style={styles.dataLine}><View style={{ flex: 1, gap: 2 }}><Text style={styles.dataLabel}>{label}</Text>{typeof value === 'string' || typeof value === 'number' ? <Text selectable style={styles.dataValue}>{value}</Text> : value}</View>{action}</View>; }

const styles = StyleSheet.create({
  screen: { padding: 18, paddingBottom: 40, gap: 12, backgroundColor: colors.background, minHeight: '100%' },
  card: { backgroundColor: colors.card, borderRadius: 18, borderCurve: 'continuous', padding: 16, gap: 8, boxShadow: '0 2px 10px rgba(7, 92, 54, 0.06)' },
  title: { color: colors.label, fontSize: 26, lineHeight: 32, fontWeight: '900' },
  sectionTitle: { color: colors.label, fontSize: 18, lineHeight: 24, fontWeight: '800', paddingTop: 6 },
  body: { color: colors.label, fontSize: 15, lineHeight: 21 },
  muted: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 48, borderRadius: 13, borderCurve: 'continuous', paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  buttonCompact: { minHeight: 38, paddingVertical: 8, paddingHorizontal: 12 },
  primaryButton: { backgroundColor: colors.primary },
  secondaryButton: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#b9d9c4' },
  dangerButton: { backgroundColor: colors.danger },
  ghostButton: { backgroundColor: 'transparent' },
  buttonText: { fontWeight: '800', fontSize: 15 },
  primaryButtonText: { color: colors.white },
  secondaryButtonText: { color: colors.primary },
  dangerButtonText: { color: colors.white },
  ghostButtonText: { color: colors.primary },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.75 },
  field: { gap: 6 }, label: { color: colors.label, fontSize: 13, fontWeight: '800' },
  input: { borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.card, color: colors.label, borderRadius: 13, borderCurve: 'continuous', paddingHorizontal: 13, minHeight: 48, fontSize: 16 },
  multiline: { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderWidth: 1, borderColor: colors.separator, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18 }, chipActive: { backgroundColor: colors.primary, borderColor: colors.primary }, chipText: { color: colors.secondaryLabel, fontWeight: '700' }, chipTextActive: { color: colors.white },
  stat: { flex: 1, minWidth: 90, alignItems: 'center' }, statValue: { color: colors.primary, fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] }, statLabel: { color: colors.secondaryLabel, fontSize: 11, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' }, wrap: { flexWrap: 'wrap' },
  loading: { flex: 1, minHeight: 320, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  badge: { alignSelf: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 }, badgeWarning: { backgroundColor: colors.warningSoft }, badgeDanger: { backgroundColor: colors.dangerSoft }, badgeText: { color: colors.primary, fontWeight: '800', fontSize: 12 }, badgeTextWarning: { color: colors.warning }, badgeTextDanger: { color: colors.danger },
  dataLine: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 4 }, dataLabel: { color: colors.secondaryLabel, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }, dataValue: { color: colors.label, fontSize: 15, fontWeight: '700' },
});
