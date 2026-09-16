import { AlertTriangle } from 'lucide-react';
import { useRef } from 'react';

export default function WorkflowValidationSummary({ issues = [], title = 'Complete the required information' }) {
  const summaryRef = useRef(null);
  const goToField = (event, issue) => {
    event.preventDefault();
    const scope = summaryRef.current?.closest('[role="dialog"], form, main') || document;
    const field = [...scope.querySelectorAll('[id], [name], [data-field]')].find((element) =>
      [element.id, element.getAttribute('name'), element.getAttribute('data-field')].includes(issue.field));
    if (!field) return;
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const target = field.matches('input,textarea,select,button,[tabindex]') ? field : field.querySelector('input,textarea,select,button,[tabindex]');
    target?.focus({ preventScroll: true });
  };
  if (!issues.length) return null;
  return (
    <div ref={summaryRef} tabIndex={-1} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950" role="alert">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {title}
      </div>
      <ul className="mt-2 space-y-1 pl-5">
        {issues.map((issue) => <li key={`${issue.field}:${issue.message}`} className="list-disc"><a className="underline underline-offset-2" href={`#${encodeURIComponent(issue.field)}`} onClick={(event) => goToField(event, issue)}>{issue.message}</a></li>)}
      </ul>
    </div>
  );
}
