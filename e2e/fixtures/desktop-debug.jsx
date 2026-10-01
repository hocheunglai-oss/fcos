import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import WorkNotifications from '@/components/WorkNotifications';
import { useDeskData } from '@/hedge/hooks/useDeskData';
import '@/index.css';

function Desk() {
  const data = useDeskData();
  return <section><button onClick={() => data.reload({ silent: true }).catch(() => {})}>Refresh fixture desk</button><p data-testid="desk-value">{data.physicals[0]?.id || 'empty'}</p><p data-testid="desk-loading">{String(data.loading || data.refreshing)}</p><p data-testid="desk-error">{data.error?.message || ''}</p></section>;
}
function Fixture() {
  const [visible, setVisible] = useState(true);
  return <MemoryRouter><main className="p-6"><h1>FCOS desktop regression fixture</h1><button onClick={() => setVisible(false)}>Unmount fixture</button>{visible && <><WorkNotifications /><Desk /></>}</main></MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
