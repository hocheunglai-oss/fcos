import { AlertTriangle } from 'lucide-react';

export default function WorkflowValidationSummary({ issues = [], title = 'Complete the required information' }) {
  if (!issues.length) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950" role="alert">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {title}
      </div>
      <ul className="mt-2 space-y-1 pl-5">
        {issues.map((issue) => <li key={`${issue.field}:${issue.message}`} className="list-disc">{issue.message}</li>)}
      </ul>
    </div>
  );
}
