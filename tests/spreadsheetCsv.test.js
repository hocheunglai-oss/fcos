import assert from 'node:assert/strict';
import test from 'node:test';
import {
  spreadsheetCsvCell,
  spreadsheetCsvTextCell,
  spreadsheetLiteralText,
} from '../shared/spreadsheetCsv.js';

test('spreadsheet text cells neutralize formula prefixes without changing numeric cells', () => {
  for (const value of ['=1+1', '+SUM(A1:A2)', '-1', '@cmd', ' \t=SUM(A1:A2)', '\u0000@cmd']) {
    assert.equal(spreadsheetLiteralText(value), `'${value}`);
  }
  assert.equal(spreadsheetLiteralText("'=already-literal"), "'=already-literal");
  assert.equal(spreadsheetCsvCell(-42), '-42');
  assert.equal(spreadsheetCsvTextCell('=SUM(1,1)'), '"\'=SUM(1,1)"');
  assert.equal(spreadsheetCsvTextCell('line one\nline two'), '"line one\nline two"');
});
