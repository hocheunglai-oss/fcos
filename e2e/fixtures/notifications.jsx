import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/components/ui/use-toast';
import { setClientSessionOwner } from '@/lib/clientSessionState';
import { ActionsProvider, useActions } from '@/hedge/data/ActionsContext';
import DraggableWorkspaceUtility from '@/components/workspace/DraggableWorkspaceUtility';
import { Button } from '@/components/ui/button';
import { Activity } from 'lucide-react';
import '@/index.css';

// Synthetic browser verification only: no provider or business-data requests.
setClientSessionOwner('notification-fixture-a');
const reload = async () => {};
function HedgeFixture() {
  const actions = useActions();
  const [undone, setUndone] = useState(false);
  return <><Button onClick={() => { setUndone(false); actions.notify({ message: 'Test hedge created', operation: { action: 'create', entity: { delete: async () => setUndone(true) }, record: { id: 'fixture' } } }); }}>Hedge notification</Button><p>Undo result: {undone ? 'undone' : 'unchanged'}</p></>;
}
function Fixture() {
  const [page, setPage] = useState(1);
  return <main className="relative h-dvh overflow-auto p-6">
    <h1 className="mb-4 text-xl font-semibold">Notification verification</h1>
    <div className="flex max-w-xl flex-wrap gap-3">
      <Button onClick={() => toast({ title: 'Product mapping saved', description: 'Fixture only. No records changed.' })}>Saved notification</Button>
      <Button onClick={() => toast({ title: 'Mapping failed', description: 'This is a synthetic error for verification.', variant: 'destructive' })}>Error notification</Button>
      <Button onClick={() => { for (let i = 1; i <= 25; i++) toast({ title: `Batch message ${i}`, description: i === 25 ? 'Long-message-'.repeat(50) : 'Fixture only' }); }}>Many notifications</Button>
      <Button onClick={() => setPage((value) => value + 1)}>Change page</Button>
      <Button onClick={() => setClientSessionOwner('notification-fixture-b')}>Switch user</Button>
      <Button onClick={() => setClientSessionOwner(null)}>Sign out</Button>
      <ActionsProvider reload={reload}><HedgeFixture /></ActionsProvider>
    </div>
    <p className="mt-4">Page {page}</p>
    <DraggableWorkspaceUtility>{() => <Button className="app-market-pulse-trigger h-9 w-9 p-0" aria-label="Market Pulse fixture"><Activity className="h-4 w-4" /></Button>}</DraggableWorkspaceUtility>
    <Toaster />
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
