// Browser- and server-safe presentation tokens for Special Terms documents.
// Keep this module data-only: the clause editor preview imports it directly and
// the Node document renderers import the same object.
export const SPECIAL_TERMS_DOCUMENT_TOKENS = Object.freeze({
  page: Object.freeze({ widthMm: 210, heightMm: 297, leftMm: 22, rightMm: 22, headerTopMm: 10, headerBottomMm: 49, contentStartMm: 61, footerRuleMm: 280, footerTextMm: 286 }),
  logo: Object.freeze({ widthMm: 64, heightMm: 22.3 }),
  colour: Object.freeze({ brandBlue: '00417B', bodyInk: '1C232A', draft: 'B7BDC5' }),
  typography: Object.freeze({ family: 'Arial', bodyPt: 10.5, lineMultiplier: 1.15, clauseAfterPt: 8, sectionLabelPt: 8.5, titlePt: 14, companyPt: 10, detailsPt: 6.5 }),
  list: Object.freeze({ hangingIndentMm: 10, nestedIndentMm: 16 }),
});
