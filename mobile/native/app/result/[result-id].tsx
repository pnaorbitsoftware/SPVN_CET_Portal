import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { assetUrl, mobileApi, type ExamAnswer, type MobileQuestion, type OptionKey, type ResultDetail } from '../../src/api';
import { Badge, Body, Button, Card, DataLine, Empty, Loading, Row, Screen, SectionTitle, Stat, Title } from '../../src/ui';
import { colors } from '../../src/theme';

const hasAnswer = (answer: ExamAnswer) => Array.isArray(answer) ? answer.length > 0 : answer !== null && answer !== undefined && answer !== '';
const optionText = (question: MobileQuestion, key: string) => ({ A:question.optionA, B:question.optionB, C:question.optionC, D:question.optionD }[key as OptionKey] || '');
const displayAnswer = (question: MobileQuestion, answer: ExamAnswer) => {
  if (!hasAnswer(answer)) return 'Not answered';
  if (Array.isArray(answer)) return answer.map((key) => `${key}) ${optionText(question, key)}`).join(' · ');
  if (question.questionType === 'NUMERICAL') return String(answer);
  if (question.questionType === 'TRUE_FALSE') return answer === 'A' ? 'True' : answer === 'B' ? 'False' : String(answer);
  return `${answer}) ${optionText(question, String(answer))}`;
};
const correctAnswer = (question: MobileQuestion) => {
  if (question.questionType === 'MULTIPLE_CORRECT') return displayAnswer(question, question.correctAnswers || []);
  if (question.questionType === 'NUMERICAL') {
    const answer = question.numericalAnswer || {};
    if (Number.isFinite(answer.value)) return String(answer.value);
    if (Number.isFinite(answer.min) && Number.isFinite(answer.max)) return `${answer.min}–${answer.max}`;
    return 'Not configured';
  }
  return displayAnswer(question, question.correctAnswer);
};
const answerMatches = (question:MobileQuestion, answer:ExamAnswer) => {
  if (!hasAnswer(answer)) return false;
  if (question.questionType === 'MULTIPLE_CORRECT') {
    const given = Array.isArray(answer) ? [...answer].sort() : [String(answer)];
    const expected = [...(question.correctAnswers || [])].sort();
    return given.length === expected.length && given.every((key,index) => key === expected[index]);
  }
  if (question.questionType === 'NUMERICAL') {
    const value = Number(answer);
    const expected = question.numericalAnswer || {};
    if (!Number.isFinite(value)) return false;
    if (Number.isFinite(expected.min) && Number.isFinite(expected.max) && value >= Number(expected.min) && value <= Number(expected.max)) return true;
    return Number.isFinite(expected.value) && Math.abs(value - Number(expected.value)) <= Number(expected.tolerance || 0);
  }
  return answer === question.correctAnswer;
};

export default function ResultRoute() {
  const params = useLocalSearchParams<{ 'result-id': string }>();
  const resultId = String(params['result-id']);
  const [detail, setDetail] = useState<ResultDetail | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { mobileApi.getResult(resultId).then(setDetail).catch((error) => Alert.alert('Unable to load result', error instanceof Error ? error.message : 'Please try again.')); }, [resultId]);
  const questions = useMemo(() => {
    if (!detail || !detail.released) return [];
    const rows = detail.result.testId?.questions || [];
    const map = new Map(rows.map((question) => [question._id, question]));
    return (detail.result.questionOrder?.length ? detail.result.questionOrder : rows.map((question) => question._id)).map((id) => map.get(String(id))).filter(Boolean);
  }, [detail]);

  if (!detail) return <Loading message="Building result report…" />;
  if (!detail.released) return <Screen>
    <Stack.Title>Submission Confirmed</Stack.Title>
    <Title>Submission Confirmed</Title>
    <Body>Your answers for {detail.submission.testTitle} were saved successfully.</Body>
    <Card><Badge tone="warning">Result Pending</Badge><DataLine label="Status" value={detail.submission.status.replaceAll('_', ' ')} /><DataLine label="Submitted" value={detail.submission.submittedAt ? new Date(detail.submission.submittedAt).toLocaleString() : 'Saved'} /><Body muted>{detail.release.message}</Body></Card>
    <Card><Body muted>Marks, answers, rank, PDF and leaderboard remain hidden until the result is released.</Body></Card>
    <Button title="Back to Student Portal" onPress={() => router.replace('/student')} />
  </Screen>;
  const { result, percentage } = detail;
  const download = async () => {
    try {
      setBusy(true);
      const uri = await mobileApi.downloadResult(resultId);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share result PDF' });
      else Alert.alert('Downloaded', uri);
    } catch (error) { Alert.alert('Download failed', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  return <Screen>
    <Stack.Title>Exam Result</Stack.Title>
    <Title>{result.testId?.title || 'Exam Result'}</Title>
    <Body muted>{result.studentId?.name || ''} · {result.studentId?.rollNo || ''}</Body>
    <Row><Stat value={`${result.score}/${result.totalMarks}`} label="Score" /><Stat value={`${percentage}%`} label="Percentage" /><Stat value={result.rank ? `#${result.rank}` : '—'} label="Rank" /></Row>
    <Row><Stat value={result.correctAnswers || 0} label="Correct" /><Stat value={result.wrongAnswers || 0} label="Wrong" /><Stat value={result.skippedAnswers || 0} label="Skipped" /></Row>
    <Card><DataLine label="Status" value={result.status || 'submitted'} /><DataLine label="Percentile" value={result.percentile ?? '—'} /><DataLine label="Time Taken" value={result.timeTaken ? `${Math.floor(result.timeTaken / 60)}m ${result.timeTaken % 60}s` : '—'} /><DataLine label="Submitted" value={result.submittedAt ? new Date(result.submittedAt).toLocaleString() : '—'} /></Card>
    <Row><View style={{ flex: 1 }}><Button title="Download / Share PDF" onPress={download} busy={busy} /></View><View style={{ flex: 1 }}><Button title="Leaderboard" variant="secondary" onPress={() => router.push({ pathname: '/leaderboard/[test-id]', params: { 'test-id': result.testId._id } })} /></View></Row>
    <SectionTitle>Subject performance</SectionTitle>
    {result.subjectScores && Object.keys(result.subjectScores).length ? Object.entries(result.subjectScores).map(([subject, score]) => <Card key={subject}><Row><Text selectable style={{ flex: 1, color: colors.label, fontWeight: '900', fontSize: 16 }}>{subject}</Text><Badge tone={score.status === 'ABSENT' ? 'danger' : 'primary'}>{score.status || 'ATTEMPTED'}</Badge></Row><Body>{score.marks} / {score.total} marks</Body><Body muted>{score.correct} correct · {score.wrong} wrong · {score.skipped} skipped</Body></Card>) : <Empty message="Subject breakdown is not available for this result." />}
    <SectionTitle>Question-by-question review</SectionTitle>
    {questions.length ? questions.map((question, index) => {
      if (!question) return null;
      const given = result.answers?.[question._id]?.answer ?? null;
      const recorded = result.perQuestionScore?.[question._id];
      const status = recorded?.status || (answerMatches(question, given) ? 'correct' : hasAnswer(given) ? 'incorrect' : 'skipped');
      const label = status === 'correct' ? 'Correct' : status === 'partial' ? 'Partially Correct' : status === 'bonus' ? 'Bonus' : status === 'skipped' ? 'Skipped' : 'Wrong';
      return <Card key={question._id}><Row><Badge tone={status === 'skipped' || status === 'partial' ? 'warning' : status === 'correct' || status === 'bonus' ? 'primary' : 'danger'}>Q{index + 1} · {label}</Badge><Body muted>{recorded ? `${recorded.awarded}/${recorded.maxScore}` : question.marks} mark(s)</Body></Row><Text selectable style={{ color: colors.label, fontWeight: '800', fontSize: 16, lineHeight: 23 }}>{question.question}</Text>{assetUrl(question.questionImage) ? <Image source={assetUrl(question.questionImage)!} style={{ height: 190, width: '100%' }} contentFit="contain" /> : null}<DataLine label="Your Answer" value={displayAnswer(question, given)} /><DataLine label="Correct Answer" value={correctAnswer(question)} />{question.explanation ? <Body muted>{question.explanation}</Body> : null}</Card>;
    }) : <Empty message="Detailed question review is unavailable for this PDF-style test." />}
  </Screen>;
}
