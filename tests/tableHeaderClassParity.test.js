import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Baseline static class values, in document order, before literal deduplication.
// Resolving the shared constants must preserve every class byte and occurrence.
const baseline = [
  {
    "file": "src/pages/BuyerInvoices.jsx",
    "counts": {
      "COMPACT_HEADER_LEFT": 10,
      "COMPACT_HEADER_RIGHT": 4,
      "MUTED_HEADER_LEFT": 7,
      "STANDARD_HEADER_LEFT": 5
    },
    "hash": "9f8887237ca117a67cb64f3421e758ceea3f232b2c01c63ec49d40e8160cae2b"
  },
  {
    "file": "src/components/dashboard/StemDetailModal.jsx",
    "counts": {
      "FINANCIAL_HEADER_RIGHT": 14,
      "FINANCIAL_HEADER_LEFT": 8
    },
    "hash": "69e4853a6c5be29949c42342b1799a80c4788d8e19639f8a09807fda39bf8cee"
  },
  {
    "file": "src/pages/DisputeWorkflow.jsx",
    "counts": {
      "DETAIL_HEADER_LEFT": 12,
      "DETAIL_HEADER_RIGHT": 6,
      "STICKY_HEADER_LEFT": 8
    },
    "hash": "e6b17c0afbba8504c29be07aa5d1ac06ef6eb12117d2f9b378c76c7f913cd65d"
  }
];

for (const { file, counts, hash } of baseline) {
  test(`deduplicated headers preserve every static class in ${file}`, async () => {
    let source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const [name, expectedCount] of Object.entries(counts)) {
      const declaration = source.match(new RegExp(`const ${name} = ("[^"\\n]*");`));
      assert.ok(declaration, `${name} must remain a static string for Tailwind scanning`);
      const value = JSON.parse(declaration[1]);
      const reference = `className={${name}}`;
      assert.equal(source.split(reference).length - 1, expectedCount);
      source = source.replaceAll(reference, `className="${value}"`);
    }
    const values = [...source.matchAll(/className="([^"\n]*)"/g)].map((match) => match[1]);
    assert.equal(createHash('sha256').update(JSON.stringify(values)).digest('hex'), hash);
  });
}

