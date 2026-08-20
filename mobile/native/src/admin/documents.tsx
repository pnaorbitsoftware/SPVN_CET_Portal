import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';

import { assetUrl, mobileApi, type MobileAdminDocument } from '../api';
import { Badge, Body, Button, Card, Empty, Loading, Row, SectionTitle } from '../ui';
import { colors } from '../theme';

export function AdminDocuments() {
  const [documents, setDocuments] = useState<MobileAdminDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setDocuments((await mobileApi.getAdminDocuments()).documents); }
    catch (error) { Alert.alert('Unable to load documents', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (loading) return <Loading message="Loading student documents…" />;
  const remove = (document: MobileAdminDocument) => Alert.alert('Delete document?', document.originalName, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { setBusy(true); await mobileApi.deleteAdminDocument(document._id); await load(); } catch (error) { Alert.alert('Delete failed', error instanceof Error ? error.message : 'Please try again.'); } finally { setBusy(false); } } }]);
  return <><SectionTitle>Student documents ({documents.length})</SectionTitle>{documents.length ? documents.map((document) => <Card key={document._id}><Row><Badge>{document.fileType?.includes('pdf') ? 'PDF' : 'File'}</Badge><Body muted>{document.fileSize ? `${(document.fileSize / 1024).toFixed(1)} KB` : ''}</Body></Row><Text selectable style={{ color: colors.label, fontWeight: '900', fontSize: 16 }}>{document.originalName}</Text><Body>{document.studentId?.name || 'Student'} · {document.studentId?.rollNo || ''}</Body><Body muted>{document.description || 'No description'}</Body><Row><View style={{ flex: 1 }}><Button title="Open" variant="secondary" compact onPress={() => { const url = assetUrl(document.filePath); if (url) Linking.openURL(url); }} /></View><View style={{ flex: 1 }}><Button title="Delete" variant="danger" compact disabled={busy} onPress={() => remove(document)} /></View></Row></Card>) : <Empty message="No student documents uploaded." />}</>;
}
