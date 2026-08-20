import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { mobileApi, SmartScanDraft, SmartScanQuestion } from './api';

type ScanAsset = { uri: string; name: string; mimeType?: string | null };

export function SmartScannerScreen({ onClose, embedded = false }: { onClose: () => void; embedded?: boolean }) {
  const [draft, setDraft] = useState<SmartScanDraft | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const scanAssets = async (assets: ScanAsset[]) => {
    setFileNames(assets.map((asset) => asset.name));
    const data = new FormData();
    assets.forEach((asset) => data.append('questionFiles', { uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' } as unknown as Blob));
    try {
      setBusy(true);
      const response = await mobileApi.scanAdminQuestions(data);
      setDraft(response.draft);
    } catch (error) {
      Alert.alert('Scan failed', error instanceof Error ? error.message : 'Unable to scan selected files.');
    } finally { setBusy(false); }
  };

  const selectAndScan = async () => {
    const selection = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
    if (selection.canceled) return;
    await scanAssets(selection.assets);
  };

  const captureAndScan = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert('Camera permission required', 'Allow camera access to scan a handwritten question page.');
    const capture = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (capture.canceled) return;
    const asset = capture.assets[0];
    await scanAssets([{ uri: asset.uri, name: asset.fileName || `question_${Date.now()}.jpg`, mimeType: asset.mimeType || 'image/jpeg' }]);
  };

  const updateQuestion = (index: number, field: keyof SmartScanQuestion, value: string | boolean) => {
    if (!draft) return;
    const questions = [...draft.questions];
    questions[index] = { ...questions[index], [field]: value };
    setDraft({ ...draft, questions });
  };

  const commit = async () => {
    if (!draft) return;
    try {
      setBusy(true);
      const response = await mobileApi.commitSmartScan(draft._id, draft.questions);
      Alert.alert('Saved', `${response.imported} scanned questions were added to Question Bank.`);
      onClose();
    } catch (error) { Alert.alert('Save failed', error instanceof Error ? error.message : 'Review all selected questions.'); }
    finally { setBusy(false); }
  };

  const discard = async () => {
    if (!draft) return onClose();
    try { await mobileApi.discardSmartScan(draft._id); onClose(); }
    catch (error) { Alert.alert('Discard failed', error instanceof Error ? error.message : 'Please try again.'); }
  };

  const content = <>
    <Text style={styles.title}>Smart Question Scanner</Text>
    <Text style={styles.help}>Select images, PDFs, Word files or spreadsheets. The scanner identifies questions, options and hierarchy automatically.</Text>
    {!draft ? <><Pressable style={styles.primary} onPress={selectAndScan} disabled={busy}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Select Files & Scan</Text>}</Pressable><Pressable style={styles.secondary} onPress={captureAndScan} disabled={busy}><Text style={styles.secondaryText}>Camera Scan</Text></Pressable>{fileNames.length ? <Text style={styles.files}>Selected: {fileNames.join(', ')}</Text> : null}</> : <>
      <Text style={styles.status}>{draft.questions.length} questions found · {draft.extractionMethod}</Text>
      {draft.warnings.map((warning, index) => <Text key={`${warning}-${index}`} style={styles.warning}>• {warning}</Text>)}
      {draft.questions.map((question, index) => <View key={`${question.question}-${index}`} style={styles.card}>
        <View style={styles.row}><Text style={styles.cardTitle}>Question {index + 1}</Text><Pressable onPress={() => updateQuestion(index, 'isSelected', !question.isSelected)}><Text style={question.isSelected ? styles.selected : styles.unselected}>{question.isSelected ? 'Selected' : 'Skipped'}</Text></Pressable></View>
        <TextInput style={styles.input} multiline value={question.question} onChangeText={(value) => updateQuestion(index, 'question', value)} placeholder="Question" />
        {(['optionA', 'optionB', 'optionC', 'optionD'] as const).map((field) => <TextInput key={field} style={styles.input} value={question[field]} onChangeText={(value) => updateQuestion(index, field, value)} placeholder={field.replace('option', 'Option ')} />)}
        <TextInput style={styles.input} value={question.correctAnswer} onChangeText={(value) => updateQuestion(index, 'correctAnswer', value.toUpperCase())} placeholder="Correct answer: A/B/C/D" maxLength={1} />
        <TextInput style={styles.input} value={question.subject} onChangeText={(value) => updateQuestion(index, 'subject', value)} placeholder="Subject" />
        <TextInput style={styles.input} value={question.topic || ''} onChangeText={(value) => updateQuestion(index, 'topic', value)} placeholder="Topic" />
        <TextInput style={styles.input} value={question.subtopic || ''} onChangeText={(value) => updateQuestion(index, 'subtopic', value)} placeholder="Subtopic" />
        <TextInput style={styles.input} value={question.difficulty} onChangeText={(value) => updateQuestion(index, 'difficulty', value)} placeholder="Easy / Medium / Hard" />
        <TextInput style={styles.input} value={String(question.marks)} onChangeText={(value) => updateQuestion(index, 'marks', value)} placeholder="Marks" keyboardType="decimal-pad" />
        <TextInput style={styles.input} value={question.explanation || ''} onChangeText={(value) => updateQuestion(index, 'explanation', value)} placeholder="Explanation" multiline />
        <Text style={styles.meta}>{question.subject} · {question.topic || 'No topic'} · {question.subtopic || 'No subtopic'}</Text>
      </View>)}
      <View style={styles.actions}><Pressable style={styles.secondary} onPress={discard} disabled={busy}><Text style={styles.secondaryText}>Discard</Text></Pressable><Pressable style={styles.primary} onPress={commit} disabled={busy}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save Selected Questions</Text>}</Pressable></View>
    </>}
  </>;
  return embedded ? <View style={styles.page}>{content}</View> : <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>{content}</ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 18, gap: 12, backgroundColor: '#f3f7f4' }, title: { fontSize: 25, color: '#123c26', fontWeight: '800' }, help: { color: '#587063', lineHeight: 20 }, primary: { backgroundColor: '#075c36', padding: 14, borderRadius: 12, alignItems: 'center', minHeight: 50 }, primaryText: { color: '#fff', fontWeight: '800' }, files: { color: '#075c36', fontWeight: '700' }, status: { color: '#075c36', fontWeight: '800' }, warning: { color: '#9a5f00' }, card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 8 }, row: { flexDirection: 'row', justifyContent: 'space-between' }, cardTitle: { color: '#163b26', fontWeight: '800' }, selected: { color: '#075c36', fontWeight: '800' }, unselected: { color: '#a11d1d', fontWeight: '800' }, input: { borderWidth: 1, borderColor: '#d7e2da', borderRadius: 10, padding: 10, color: '#24372b' }, meta: { color: '#607269', fontSize: 12 }, actions: { gap: 8, marginTop: 8 }, secondary: { borderWidth: 1, borderColor: '#075c36', borderRadius: 12, padding: 14, alignItems: 'center' }, secondaryText: { color: '#075c36', fontWeight: '800' },
});
