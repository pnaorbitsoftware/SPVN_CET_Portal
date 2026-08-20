import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { assetUrl, mobileApi, type ResultDetail } from '../../src/api';
import { Badge, Body, Button, Card, DataLine, Empty, Loading, Row, Screen, SectionTitle, Stat, Title } from '../../src/ui';
import { colors } from '../../src/theme';

export default function ResultRoute() {
  const params = useLocalSearchParams<{ 'result-id': string }>();
  const resultId = String(params['result-id']);
  const [detail, setDetail] = useState<ResultDetail | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { mobileApi.getResult(resultId).then(setDetail).catch((error) => Alert.alert('Unable to load result', error instanceof Error ? error.message : 'Please try again.')); }, [resultId]);
  const questions = useMemo(() => {
    if (!detail) return [];
    const rows = detail.result.testId?.questions || [];
    const map = new Map(rows.map((question) => [question._id, question]));
    return (detail.result.questionOrder?.length ? detail.result.questionOrder : rows.map((question) => question._id)).map((id) => map.get(String(id))).filter(Boolean);
  }, [detail]);

  if (!detail) return <Loading message="Building result report…" />;
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
      const given = result.answers?.[question._id]?.answer || null;
      const correct = given === question.correctAnswer;
      return <Card key={question._id}><Row><Badge tone={!given ? 'warning' : correct ? 'primary' : 'danger'}>Q{index + 1} · {!given ? 'Skipped' : correct ? 'Correct' : 'Wrong'}</Badge><Body muted>{question.marks} mark(s)</Body></Row><Text selectable style={{ color: colors.label, fontWeight: '800', fontSize: 16, lineHeight: 23 }}>{question.question}</Text>{assetUrl(question.questionImage) ? <Image source={assetUrl(question.questionImage)!} style={{ height: 190, width: '100%' }} contentFit="contain" /> : null}<DataLine label="Your Answer" value={given ? `${given}) ${question[`option${given}` as 'optionA']}` : 'Not answered'} /><DataLine label="Correct Answer" value={`${question.correctAnswer}) ${question[`option${question.correctAnswer}` as 'optionA']}`} />{question.explanation ? <Body muted>{question.explanation}</Body> : null}</Card>;
    }) : <Empty message="Detailed question review is unavailable for this PDF-style test." />}
  </Screen>;
}
