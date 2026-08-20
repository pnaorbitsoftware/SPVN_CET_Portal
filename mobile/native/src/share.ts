import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

export async function shareLocalFile(uri: string, mimeType: string, title: string) {
  if (await Sharing.isAvailableAsync()) return Sharing.shareAsync(uri, { mimeType, dialogTitle: title });
  Alert.alert('File downloaded', uri);
}
