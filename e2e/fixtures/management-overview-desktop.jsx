import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ManagementOverview from '@/components/dashboard/ManagementOverview';
import '@/index.css';

window.managementOverviewFixture = {
  requests: [],
  resolve(index, data) {
    this.requests[index].resolve({ data });
  },
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MemoryRouter>
      <main className="p-6">
        <h1>Management Overview desktop fixture</h1>
        <ManagementOverview />
      </main>
    </MemoryRouter>
  </StrictMode>,
);
