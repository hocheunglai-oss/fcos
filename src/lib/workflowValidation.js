function clean(value) {
  return String(value ?? '').trim();
}

export function validationIssue(field, message) {
  return { field, message };
}

export function requiredText(field, value, message) {
  return clean(value) ? null : validationIssue(field, message);
}

export function requiredDate(field, value, message) {
  if (!clean(value)) return validationIssue(field, message);
  const parsed = new Date(`${clean(value)}T00:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? validationIssue(field, message) : null;
}

export function positiveAmount(field, value, message) {
  return Number(value) > 0 ? null : validationIssue(field, message);
}

export function atLeastOne(field, values, message) {
  return values.some((value) => Boolean(value)) ? null : validationIssue(field, message);
}

export function collectValidationIssues(...issues) {
  return issues.flat(Infinity).filter(Boolean);
}

export function collectionWorkflowIssues({ form, adviceFile, existingAdviceDocumentIds = [] }) {
  if (form.status === 'Promise to Pay') {
    return collectValidationIssues(
      requiredDate('promisedPaymentDate', form.promisedPaymentDate, 'Enter the promised payment date.'),
      positiveAmount('promisedAmount', form.promisedAmount, 'Enter a promised amount greater than zero.'),
    );
  }
  if (form.status === 'On Hold') {
    return collectValidationIssues(
      requiredText('onHoldReason', form.onHoldReason, 'Explain why collection activity is on hold.'),
      requiredDate('onHoldReviewDate', form.onHoldReviewDate, 'Enter the date when the hold must be reviewed.'),
    );
  }
  if (form.status === 'Payment Advice Received') {
    return collectValidationIssues(
      requiredDate('adviceReceivedDate', form.adviceReceivedDate, 'Enter the payment advice received date.'),
      positiveAmount('adviceAmount', form.adviceAmount, 'Enter an advised amount greater than zero.'),
      requiredDate('adviceVerificationDate', form.adviceVerificationDate, 'Enter the payment verification date.'),
      atLeastOne(
        'adviceEvidence',
        [clean(form.adviceReference), adviceFile, ...(existingAdviceDocumentIds || [])],
        'Enter the buyer reference or upload the payment advice document.',
      ),
    );
  }
  return [];
}

export function unofficialCompensationClaimIssues(form) {
  return collectValidationIssues(
    requiredText('accountId', form.accountId, 'Select an active Account.'),
    positiveAmount('amount', form.amount, 'Enter an agreed amount greater than zero.'),
    requiredDate('deadlineDate', form.deadlineDate, 'Enter the recovery deadline.'),
    requiredText('pic', form.pic, 'Select the Salesforce PIC.'),
  );
}

export function unofficialCompensationRecoveryIssues({ form, eligible, preview }) {
  return collectValidationIssues(
    requiredText('claimId', form.claimId, 'Select an open agreed compensation claim.'),
    requiredText('stemId', form.stemId, 'Select a STEM.'),
    requiredText('lineItemId', form.lineItemId, 'Select an eligible STEM line item.'),
    eligible ? null : validationIssue('accountId', 'The selected Account and claim are not eligible for this STEM line item.'),
    positiveAmount('recoveryAmount', preview, 'Enter pricing that produces a recovery greater than zero.'),
  );
}

export function specialTermIssues(form) {
  return collectValidationIssues(
    requiredText('name', form?.name, 'Enter the Special Term name.'),
  );
}

export function specialTermRuleIssues(form) {
  return collectValidationIssues(
    requiredText('specialTermId', form?.specialTermId, 'Select a Special Term.'),
    atLeastOne(
      'conditions',
      [form?.account, form?.port, form?.product, form?.country && form.country !== '__any__'],
      'Add at least one Account, Port, Product, or Country condition.',
    ),
  );
}
