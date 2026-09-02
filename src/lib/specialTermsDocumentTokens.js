// Browser- and server-safe presentation tokens for Special Terms documents.
// Keep this module data-only: the clause editor preview imports it directly and
// the Node document renderers import the same object.
export const SPECIAL_TERMS_DOCUMENT_TOKENS = Object.freeze({
  page: Object.freeze({ widthMm: 210, heightMm: 297, leftMm: 22, rightMm: 22, headerTopMm: 10, headerBottomMm: 49, contentStartMm: 61, footerRuleMm: 280, footerTextMm: 286 }),
  logo: Object.freeze({ widthMm: 64, heightMm: 22.3 }),
  colour: Object.freeze({ brandBlue: '00417B', bodyInk: '1C232A', draft: 'B7BDC5' }),
  typography: Object.freeze({ family: 'Arial', bodyPt: 12, lineMultiplier: 1.25, clauseAfterPt: 7, bodyAlignment: 'justify', lastLineAlignment: 'left', sectionLabelPt: 9, titlePt: 15, companyPt: 10, detailsPt: 6.5 }),
  // The marker and text positions are separate on purpose. Numbers finish at
  // one fixed edge and every clause starts at the same text column, including
  // wrapped lines and multi-digit items.
  list: Object.freeze({ markerRightMm: 6.5, markerGapMm: 2, textIndentMm: 8.5, nestedMarkerRightMm: 12.5, nestedTextIndentMm: 14.5 }),
});
