import { useEffect, useState } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';

export default function DisputeSettlementSuggestions({ actionId, instructionId, onUse }) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let active = true;
    setResult(null);
    appClient.functions.invoke('disputeWorkflowSettlementEvidence', { actionId, instructionId }, { force: true, cache: false })
      .then((response) => { if (active) setResult(response.data); })
      .catch(() => { if (active) setResult({ error: 'Evidence could not be checked. Enter the settlement reference or retry.' }); });
    return () => { active = false; };
  }, [actionId, instructionId]);
  return <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm md:col-span-2">
    <b>Existing settlement evidence</b>
    {!result ? <p>Checking matching credits and refunds…</p> : result.error ? <p>{result.error}</p>
      : !result.candidates?.length ? <p>No exact existing settlement was found. Add its reference or supporting document.</p>
        : result.candidates.map((evidence) => <div key={evidence.id} className="mt-2 flex flex-wrap items-center justify-between gap-2"><div>{evidence.source} · {evidence.reference}<div>{evidence.currency} {evidence.amount.toFixed(2)} · {evidence.date}</div></div><Button type="button" size="sm" variant="outline" onClick={() => onUse(evidence)}>Use verified details</Button></div>)}
  </div>;
}
