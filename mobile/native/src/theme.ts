import { Color } from 'expo-router';
import { Platform } from 'react-native';

export const colors = {
  background: Platform.select({ ios: Color.ios.systemGroupedBackground, android: Color.android.dynamic.surface, default: '#f3f7f4' })!,
  card: Platform.select({ ios: Color.ios.secondarySystemGroupedBackground, android: Color.android.dynamic.surfaceContainer, default: '#ffffff' })!,
  label: Platform.select({ ios: Color.ios.label, android: Color.android.dynamic.onSurface, default: '#173b27' })!,
  secondaryLabel: Platform.select({ ios: Color.ios.secondaryLabel, android: Color.android.dynamic.onSurfaceVariant, default: '#617268' })!,
  separator: Platform.select({ ios: Color.ios.separator, android: Color.android.dynamic.outlineVariant, default: '#d7e2da' })!,
  primary: '#075c36',
  primarySoft: '#e8f6ed',
  gold: '#d6ab28',
  danger: '#b42318',
  dangerSoft: '#feeceb',
  warning: '#9a5f00',
  warningSoft: '#fff6d8',
  white: '#ffffff',
};
