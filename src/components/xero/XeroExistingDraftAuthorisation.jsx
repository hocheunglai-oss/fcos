import { useEffect, useRef, useState } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { invokeExistingDraftAction } from '@/lib/xeroExistingDraftExecutionGate';
export default function XeroExistingDraftAuthorisation({disabled=false,beforeMutation,onBusyChange}) {
  const [scope,setScope]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[outcomes,setOutcomes]=useState([]);
  const busyRef=useRef(false);
  useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
  const invoke=(name,payload={})=>invokeExistingDraftAction((...args)=>appClient.functions.invoke(...args),beforeMutation,name,payload);
  const refresh=async()=>{const next=await invoke('xeroExistingDraftAuthorisationApprovedScope');setScope(next);return next;};
  const run=async()=>{
    if(disabled||busyRef.current)return;busyRef.current=true;
    setBusy(true);setMessage('Reading the fixed approved scope…');
    try {
      const initial=await refresh();
      if(initial.executionHeld)throw Error('An interrupted intent requires readback before further authorisation.');
      const pending=initial.rows.filter(r=>r.status==='DRAFT');let done=initial.completed;
      let offset=0,current=initial;
      while(offset<pending.length){
        if(!current.maxSafeCohort)throw Error(`The remaining shared allowance cannot cover another complete preview, authorisation and recovery above the ${current.allowance?.reserve ?? 'Unknown'}-call reserve.`);
        if(offset===0&&initial.completed===0&&current.maxSafeCohort<Math.min(5,pending.length))throw Error('The first verified cohort requires enough capacity for five drafts, including recovery.');
        const cohort=pending.slice(offset,offset+current.maxSafeCohort);offset+=cohort.length;setMessage(`Checking approved drafts ${offset-cohort.length+1}–${offset} of ${pending.length}…`);
        const preview=await invoke('xeroExistingDraftAuthorisationPreview',{targetIds:cohort.map(r=>r.targetId)});
        const selectedItemIds=preview.rows.filter(r=>r.status==='eligible'&&r.blockers.length===0).map(r=>r.id);
        const held=preview.rows.filter(r=>!selectedItemIds.includes(r.id));
        if(held.length)setOutcomes(old=>[...old,...held.map(r=>({...r,status:'held'}))]);
        if(!selectedItemIds.length){current=await refresh();continue;}
        setMessage(`Authorising ${selectedItemIds.length} unchanged approved drafts…`);
        const applied=await invoke('xeroExistingDraftAuthorisationApply',{runId:preview.run.id,revision:preview.run.revision,reviewed:true,selectedItemIds});
        setOutcomes(old=>[...old,...applied.outcomes]);done+=applied.financialWrites;
        setMessage(`${done} of 54 authorised. PDF verification remains deferred.`);current=await refresh();
        if(current.executionHeld)throw Error('An unresolved intent requires readback before the next cohort.');
      }
      await refresh();setMessage(`${done} of 54 authorised; held records remain for review.`);
    }catch(error){setMessage(`${error.message} No uncertain status update will be resent.`);await refresh().catch(()=>{});}
    finally{busyRef.current=false;setBusy(false);}
  };
  const recover=async(claimId)=>{
    if(disabled||busyRef.current)return;busyRef.current=true;
    setBusy(true);try{const result=await invoke('xeroExistingDraftAuthorisationRecover',{claimId});setMessage(`Readback: ${result.status}. No status update was resent.`);await refresh();}
    catch(error){setMessage(error.message);}finally{busyRef.current=false;setBusy(false);}
  };
  const load=async()=>{if(disabled||busyRef.current)return;busyRef.current=true;setBusy(true);try{await refresh();setMessage('Scope loaded from FCOS. No Xero requests were made.');}catch(error){setMessage(error.message);}finally{busyRef.current=false;setBusy(false);}};
  return <section className="rounded-lg border p-4 space-y-3" aria-label="Approved existing drafts">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">Approved existing drafts</h3><p className="text-sm text-muted-foreground">Status only. Existing financial details remain unchanged; PDFs stay unverified.</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={load} disabled={disabled||busy}>Read progress</Button>
        <Button onClick={run} disabled={disabled||busy||!scope||scope.executionHeld||!scope.rows.some(r=>r.status==='DRAFT')}>Run approved drafts</Button></div></div>
    {message&&<p role="status" className="text-sm">{message}</p>}
    {scope&&<><p className="text-sm">{scope.completed} of 54 authorised · {scope.allowance.spendableCalls ?? 'Unknown'} calls above the {scope.allowance.reserve ?? 'Unknown'}-call reserve</p>
      {scope.unresolved.map(r=><Button key={r.claimId} variant="outline" disabled={busy||disabled} onClick={()=>recover(r.claimId)}>Read back interrupted record</Button>)}
      <div className="max-h-80 overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th>Invoice / bill</th><th>Company</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>{scope.rows.map(r=><tr key={r.targetId} className="border-t"><td className="py-2">{r.direction} · {r.sourceNumber}</td><td>{r.company}</td><td>{r.currency} {Number(r.total).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td>{r.status}</td></tr>)}</tbody></table></div></>}
    {outcomes.length>0&&<details><summary>Batch outcomes ({outcomes.length})</summary>{outcomes.map((r,i)=><p key={`${r.targetId||r.id}:${i}`} className="text-sm">{r.sourceNumber} · {r.status}{r.blockers?.length?` · ${r.blockers.join('; ')}`:''}</p>)}</details>}
  </section>;
}
