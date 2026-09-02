import { ShieldCheck } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PAYMENT_DATA_RELIABILITY_LABEL } from '@/lib/paymentDataReliability';
import { cn } from '@/lib/utils';

export default function PaymentDataReliabilityBadge({ className, excludedCount = null }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-900', className)}>
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {PAYMENT_DATA_RELIABILITY_LABEL}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          Earlier obligations are company-confirmed settled, but their Salesforce payment details are incomplete. FCOS excludes them from payment figures, reminders, forecasts, reconciliation, and exports.
          {Number(excludedCount) > 0 ? ` ${Number(excludedCount).toLocaleString()} legacy record${Number(excludedCount) === 1 ? '' : 's'} were excluded from this view.` : ''}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
