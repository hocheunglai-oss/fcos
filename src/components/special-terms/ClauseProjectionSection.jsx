import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import ClauseComposer from '@/components/special-terms/ClauseComposer';
import MigrationReviewPanel from '@/components/special-terms/MigrationReviewPanel';
import { richTextToCopyText } from '@/lib/specialTermsText';

function ClauseProjectionSection({
  detail,
  projection,
  canManage = false,
  canApprove = false,
  categoryOptions = [],
  onAssignmentsChange,
  onChanged,
  onError,
  wholeTermRevision = false,
}) {
  const sourceProjection = detail?.projections?.[projection];
  const projectionDetail = sourceProjection ? {
    ...sourceProjection,
    activeAssignments: sourceProjection.assignments || sourceProjection.draftAssignments || sourceProjection.rows || sourceProjection.activeAssignments || [],
    proposedAssignments: sourceProjection.proposedAssignments || [],
  } : null;
  if (!projectionDetail) return null;
  const isTermsText = projection === 'termsText';

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{projectionDetail.label}</h3>
            <Badge variant={projectionDetail.status === 'Active' ? 'default' : 'outline'}>{projectionDetail.status}</Badge>
            <Badge variant="secondary">{projectionDetail.style}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isTermsText
              ? 'Top-level row numbers are generated automatically.'
              : 'Choose numbered or hyphen bullets during reviewed migration; the marker is never stored inside clause wording.'}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{projectionDetail.activeAssignments.length} active · {projectionDetail.proposedAssignments.length} proposed</span>
      </div>

      {projectionDetail.status === 'Active' ? (
        <ClauseComposer
          assignments={projectionDetail.activeAssignments}
          onChange={(activeAssignments) => onAssignmentsChange?.(projection, activeAssignments)}
          disabled={!canManage}
          style={projectionDetail.style}
        />
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Current live Salesforce wording</p>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed">{richTextToCopyText(projectionDetail.text) || `No ${projectionDetail.label}`}</pre>
          <p className="text-xs text-muted-foreground">This wording stays read-only and live until reviewed assignments are approved and activated atomically.</p>
        </div>
      )}

      {!wholeTermRevision ? <MigrationReviewPanel
        detail={detail}
        projection={projection}
        categoryOptions={categoryOptions}
        canApprove={canApprove}
        onChanged={onChanged}
        onError={onError}
      /> : null}
    </section>
  );
}

export default memo(ClauseProjectionSection);
