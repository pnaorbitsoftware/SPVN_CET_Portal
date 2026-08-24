import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, assetUrl, mobileApi, type ExamQuestionState } from '../../src/api';
import { Badge, Body, Button, Loading, Row } from '../../src/ui';
import { colors } from '../../src/theme';

export default function ExamRoute() {
  const params = useLocalSearchParams<{ 'test-id': string }>();
  const testId = String(params['test-id']);
  const [state, setState] = useState<ExamQuestionState | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [markedForReview, setMarkedForReview] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [violations, setViolations] = useState(0);
  const questionOpenedAt = useRef(Date.now());
  const submitting = useRef(false);
  const latest = useRef({ state, selectedAnswer, markedForReview });
  latest.current = { state, selectedAnswer, markedForReview };

  const autoSubmit = useCallback(async (message: string) => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const current = latest.current;
      if (current.state) await mobileApi.saveStudentAnswer(testId, { questionId: current.state.question.id, answer: current.selectedAnswer, markForReview: current.markedForReview, timeSpent: Math.floor((Date.now() - questionOpenedAt.current) / 1000) });
      const response = await mobileApi.submitStudentTest(testId, true);
      Alert.alert('Exam submitted', message, [{ text: 'View Result', onPress: () => router.replace({ pathname: '/result/[result-id]', params: { 'result-id': response.result._id } }) }]);
    } catch (error) {
      submitting.current = false;
      Alert.alert('Submission pending', error instanceof Error ? error.message : 'Reconnect and submit immediately.');
    }
  }, [testId]);

  const loadQuestion = useCallback(async (number: number) => {
    try {
      setLoading(true);
      const next = await mobileApi.getStudentQuestion(testId, number);
      setState(next); setSelectedAnswer(next.selectedAnswer); setMarkedForReview(next.markedForReview); setRemainingSeconds(next.remainingSeconds); questionOpenedAt.current = Date.now();
    } catch (error) {
      if (error instanceof ApiError && error.status === 408) {
        const resultId = String(error.details?.resultId || '');
        if (resultId) {
          Alert.alert('Exam submitted', 'Time ended, so the exam was submitted automatically.', [{ text:'Continue', onPress:() => router.replace({ pathname:'/result/[result-id]', params:{ 'result-id':resultId } }) }]);
          return;
        }
        return autoSubmit('Time ended, so the exam was submitted automatically.');
      }
      Alert.alert('Question unavailable', error instanceof Error ? error.message : 'Please try again.');
    } finally { setLoading(false); }
  }, [autoSubmit, testId]);

  useEffect(() => {
    mobileApi.startStudentTest(testId).then((session) => loadQuestion(session.firstQuestionNumber)).catch((error) => { setLoading(false); Alert.alert('Unable to start exam', error instanceof Error ? error.message : 'Please try again.', [{ text: 'Back', onPress: () => router.back() }]); });
  }, [loadQuestion, testId]);

  useEffect(() => {
    const timer = setInterval(() => setRemainingSeconds((seconds) => seconds === null ? null : Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { if (state && remainingSeconds === 0) autoSubmit('Time ended, so the exam was submitted automatically.'); }, [autoSubmit, remainingSeconds, state]);

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', async (next) => {
      if (previous === 'active' && next !== 'active' && !submitting.current) {
        try {
          const response = await mobileApi.reportViolation(testId, 'focusLoss');
          setViolations(response.violations);
          if (response.autoSubmit) autoSubmit('The violation limit was reached.');
        } catch { /* Progress remains locally visible; the next request retries normal exam state. */ }
      }
      previous = next;
    });
    return () => subscription.remove();
  }, [autoSubmit, testId]);

  const persist = useCallback(async () => {
    const current = latest.current;
    if (!current.state) return;
    await mobileApi.leaveStudentTest(testId, { questionId: current.state.question.id, answer: current.selectedAnswer, markForReview: current.markedForReview, timeSpent: Math.floor((Date.now() - questionOpenedAt.current) / 1000) });
  }, [testId]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert('Leave exam?', 'Your current answer will be saved. The timer continues until you resume.', [{ text: 'Stay', style: 'cancel' }, { text: 'Leave', onPress: async () => { await persist().catch(() => {}); router.back(); } }]);
      return true;
    });
    return () => subscription.remove();
  }, [persist]);

  const saveAndGo = async (questionNumber: number) => {
    if (!state || busy) return;
    try {
      setBusy(true);
      await mobileApi.saveStudentAnswer(testId, { questionId: state.question.id, answer: selectedAnswer, markForReview: markedForReview, timeSpent: Math.floor((Date.now() - questionOpenedAt.current) / 1000) });
      await loadQuestion(questionNumber);
    } catch (error) { Alert.alert('Unable to save answer', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const submit = () => Alert.alert('Submit exam?', 'Answers cannot be changed after submission.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Submit', style: 'destructive', onPress: async () => {
    if (!state || submitting.current) return;
    try {
      submitting.current = true; setBusy(true);
      await mobileApi.saveStudentAnswer(testId, { questionId: state.question.id, answer: selectedAnswer, markForReview: markedForReview, timeSpent: Math.floor((Date.now() - questionOpenedAt.current) / 1000) });
      const response = await mobileApi.submitStudentTest(testId);
      router.replace({ pathname: '/result/[result-id]', params: { 'result-id': response.result._id } });
    } catch (error) { submitting.current = false; Alert.alert('Submit failed', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  } }]);

  if (loading || !state) return <Loading message="Preparing secure exam…" />;
  const image = assetUrl(state.question.questionImage);

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Pressable onPress={() => Alert.alert('Leave exam?', 'Progress is saved and the timer continues.', [{ text: 'Stay', style: 'cancel' }, { text: 'Leave', onPress: async () => { await persist().catch(() => {}); router.back(); } }])}><Text style={styles.headerAction}>Exit</Text></Pressable>
      <Text selectable style={styles.timer}>Q {state.questionNumber}/{state.totalQuestions} · {remainingSeconds === null ? 'No limit' : `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`}</Text>
      <Pressable onPress={submit}><Text style={styles.submit}>Submit</Text></Pressable>
    </View>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <Row wrap><Badge>{state.question.subject}</Badge>{state.question.topic ? <Badge>{state.question.topic}</Badge> : null}{violations ? <Badge tone="warning">Violations {violations}</Badge> : null}</Row>
      {state.sections.length ? <View style={styles.sections}>{state.sections.map((section) => <Badge key={section.name} tone={section.locked ? 'warning' : 'primary'}>{section.name}{section.locked ? ' 🔒' : ''}</Badge>)}</View> : null}
      <Text selectable style={styles.question}>{state.question.question}</Text>
      {image ? <Image source={image} style={styles.questionImage} contentFit="contain" /> : null}
      {state.question.options.map((option) => {
        const optionImage = assetUrl(option.image);
        return <Pressable key={option.key} onPress={() => setSelectedAnswer(option.key)} style={[styles.option, selectedAnswer === option.key && styles.optionSelected]}>
          <View style={styles.optionKey}><Text style={styles.optionKeyText}>{option.key}</Text></View>
          <View style={{ flex: 1, gap: 8 }}><Text selectable style={styles.optionText}>{option.value}</Text>{optionImage ? <Image source={optionImage} style={styles.optionImage} contentFit="contain" /> : null}</View>
        </Pressable>;
      })}
      <Text selectable style={styles.paletteTitle}>Question palette</Text>
      <View style={styles.palette}>{state.palette.map((item) => <Pressable key={item.number} disabled={state.sections.some((section) => section.locked && section.questionNumbers.includes(item.number))} onPress={() => saveAndGo(item.number)} style={[styles.paletteItem, item.visited && styles.paletteVisited, item.answered && styles.paletteAnswered, item.marked && styles.paletteMarked, item.number === state.questionNumber && styles.paletteCurrent]}><Text style={styles.paletteText}>{item.number}</Text></Pressable>)}</View>
      <Button title={markedForReview ? 'Remove Review Mark' : 'Mark for Review'} variant="secondary" onPress={() => setMarkedForReview((value) => !value)} />
      <Row><View style={{ flex: 1 }}><Button title="Previous" variant="secondary" disabled={state.questionNumber <= 1 || busy} onPress={() => saveAndGo(state.questionNumber - 1)} /></View><View style={{ flex: 1 }}><Button title={state.questionNumber === state.totalQuestions ? 'Save Answer' : 'Save & Next'} busy={busy} onPress={() => saveAndGo(Math.min(state.totalQuestions, state.questionNumber + 1))} /></View></Row>
      <Body muted>Green: answered · Gold: review · Outline: current. App switching is recorded during the exam.</Body>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary, minHeight: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerAction: { color: '#d9eee2', fontWeight: '900' }, submit: { color: '#f7d75c', fontWeight: '900' }, timer: { color: colors.white, fontWeight: '900', fontVariant: ['tabular-nums'] },
  content: { padding: 18, paddingBottom: 42, gap: 14 }, sections: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, question: { color: colors.label, fontSize: 19, lineHeight: 28, fontWeight: '800' }, questionImage: { width: '100%', height: 230, backgroundColor: colors.card, borderRadius: 14 },
  option: { flexDirection: 'row', gap: 12, padding: 14, borderWidth: 1, borderColor: colors.separator, borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.card, alignItems: 'center' }, optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft, borderWidth: 2 }, optionKey: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#dfeae2', alignItems: 'center', justifyContent: 'center' }, optionKeyText: { color: colors.primary, fontWeight: '900' }, optionText: { color: colors.label, fontSize: 16, lineHeight: 22 }, optionImage: { width: '100%', height: 130 },
  paletteTitle: { color: colors.label, fontWeight: '900', fontSize: 16, paddingTop: 4 }, palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, paletteItem: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e9e4' }, paletteVisited: { borderWidth: 1, borderColor: '#8da096' }, paletteAnswered: { backgroundColor: '#9de2b5' }, paletteMarked: { backgroundColor: '#f7d75c' }, paletteCurrent: { borderWidth: 3, borderColor: colors.primary }, paletteText: { color: colors.label, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
