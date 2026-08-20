import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';

import { mobileApi, type Leaderboard } from '../../src/api';
import { Badge, Body, Card, Empty, Loading, Row, Screen, Title } from '../../src/ui';
import { colors } from '../../src/theme';

export default function LeaderboardRoute() {
  const params = useLocalSearchParams<{ 'test-id': string }>();
  const testId = String(params['test-id']);
  const [data, setData] = useState<Leaderboard | null>(null);
  useEffect(() => { mobileApi.getLeaderboard(testId).then(setData).catch((error) => Alert.alert('Unable to load leaderboard', error instanceof Error ? error.message : 'Please try again.')); }, [testId]);
  if (!data) return <Loading message="Loading leaderboard…" />;
  return <Screen>
    <Stack.Title>Leaderboard</Stack.Title>
    <Title>{data.test.title}</Title>
    <Body muted>Top {Math.min(data.results.length, 50)} submitted attempts</Body>
    {data.results.length ? data.results.map((result, index) => <Card key={result._id}><Row><Badge tone={index < 3 ? 'warning' : 'primary'}>#{index + 1}</Badge><Text selectable style={{ flex: 1, color: colors.label, fontWeight: '900', fontSize: 16 }}>{result.studentId?.name || 'Student'}</Text><Text selectable style={{ color: colors.primary, fontWeight: '900' }}>{result.score}/{result.totalMarks}</Text></Row><Body muted>{result.studentId?.rollNo || ''}{result.timeTaken ? ` · ${Math.floor(result.timeTaken / 60)}m ${result.timeTaken % 60}s` : ''}</Body></Card>) : <Empty message="No submitted attempts yet." />}
  </Screen>;
}
