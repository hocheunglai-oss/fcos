import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCOUNT_PIC_CSV_HEADERS,
  ACCOUNT_PIC_MAX_CELL_LENGTH,
  ACCOUNT_PIC_MAX_ROWS,
  accountPicCsvText,
  accountPicSaveRows,
  parseAccountPicCsv,
} from '../src/lib/accountPicCsv.js';

function csvWithRows(rows) {
  return `\uFEFF${ACCOUNT_PIC_CSV_HEADERS.join(',')}\r\n${rows.join('\r\n')}\r\n`;
}

test('browser preview preserves multiline values and round-trips the five-column format', () => {
  const source = csvWithRows(['Hong Kong,"Person One\r\nPerson Two",Team A,"Lead, East",Tanker']);
  const rows = parseAccountPicCsv(source);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].responsiblePersonnel, 'Person One\nPerson Two');
  assert.equal(rows[0].reportingSupervision, 'Lead, East');

  const exported = accountPicCsvText(rows);
  assert.ok(exported.startsWith('\uFEFF'));
  assert.ok(exported.endsWith('\r\n'));
  assert.deepEqual(accountPicSaveRows(parseAccountPicCsv(exported)), accountPicSaveRows(rows));
});

test('browser preview rejects the same malformed and oversized input as the server', () => {
  assert.throws(
    () => parseAccountPicCsv(csvWithRows(['"Hong Kong"unexpected,,,,'])),
    /after a closing quote/i,
  );
  assert.throws(
    () => parseAccountPicCsv(csvWithRows(Array.from({ length: ACCOUNT_PIC_MAX_ROWS + 1 }, (_, index) => `Region ${index},,,,`))),
    /at most 500/i,
  );
  assert.throws(
    () => parseAccountPicCsv(csvWithRows([`${'x'.repeat(ACCOUNT_PIC_MAX_CELL_LENGTH + 1)},,,,`])),
    /longer than 4000/i,
  );
  assert.throws(
    () => parseAccountPicCsv('Port / Region,Team\nHong Kong,Team A'),
    /headers must be exactly/i,
  );
});
