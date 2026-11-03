import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import BrokerFilters from '@/components/brokers/BrokerFilters';
import '@/index.css';

function Fixture() {
  const [search, setSearch] = useState('');
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedBrokerNames, setSelectedBrokerNames] = useState([]);
  const [selectedHiddenBrokerFlags, setSelectedHiddenBrokerFlags] = useState([]);
  const [fromDate, setFromDate] = useState('2026-09-01');
  const [toDate, setToDate] = useState('2026-09-30');

  return <main className="mx-auto max-w-5xl p-6">
    <h1 className="mb-4 text-xl font-semibold">Broker date range fixture</h1>
    <BrokerFilters
      search={search}
      setSearch={setSearch}
      selectedTypes={selectedTypes}
      setSelectedTypes={setSelectedTypes}
      brokerNames={['Atlas Broker']}
      selectedBrokerNames={selectedBrokerNames}
      setSelectedBrokerNames={setSelectedBrokerNames}
      selectedHiddenBrokerFlags={selectedHiddenBrokerFlags}
      setSelectedHiddenBrokerFlags={setSelectedHiddenBrokerFlags}
      fromDate={fromDate}
      setFromDate={setFromDate}
      toDate={toDate}
      setToDate={setToDate}
    />
    <output aria-label="Selected ISO date range">{fromDate || 'empty'} | {toDate || 'empty'}</output>
  </main>;
}

createRoot(document.getElementById('root')).render(<Fixture />);
