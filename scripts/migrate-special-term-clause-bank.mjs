import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Parser } from 'htmlparser2';
import {
  canonicalClauseKey,
  clauseHash,
  hasMaterialDifference,
  hasTopLevelListMarker,
  normalizeClauseText,
  parseLegacyClauses,
  shortNameKey,
  stripOuterClauseNumber,
  suggestClauseCategory,
  suggestClauseShortName,
} from '../api/_specialTermClauseModel.js';

const SALESFORCE_API_VERSION = 'v67.0';
const SALESFORCE_ALIAS = process.env.SALESFORCE_ORG_ALIAS || 'source-salesforce';
const EXPECTED_ORG_ID = '00D2x000000Ei4oEAC';
const APPLY = process.argv.includes('--apply');
const WITH_AI = process.argv.includes('--ai');
const DIAGNOSTICS = process.argv.includes('--diagnostics');
const INVENTORY_INDEX = process.argv.indexOf('--accept-live-inventory');
const ACCEPTED_LIVE_INVENTORY = INVENTORY_INDEX >= 0 ? Number(process.argv[INVENTORY_INDEX + 1]) : null;
const AI_MODEL = 'gpt-5.6-terra';
const MAX_AI_GROUPS = 20;
const MAX_AI_INPUT_CHARS = 65_000;
const CLAUSE_CATEGORIES = Object.freeze(['Delivery', 'Quantity and Measurement', 'Quality and Claims', 'Pricing and Payment', 'Cancellation and Penalties', 'Product and Specification', 'Operations and Logistics', 'Compliance and Warranty', 'Contract Priority', 'Other']);

const PROJECTIONS = Object.freeze([
  { key: 'termsText', value: 'Terms Text', textField: 'Terms_Text__c', enabledField: null, statusField: 'Clause_Structure_Status__c', originalField: 'Original_Terms_Text__c', batchField: 'Clause_Migration_Batch_Id__c', styleField: null, markerStyle: 'Numbered' },
  { key: 'confirmationRemark', value: 'Confirmation Remark', textField: 'Special_Remark_in_Confirmation__c', enabledField: 'Add_to_Confirmation__c', statusField: 'Confirmation_Clause_Status__c', originalField: 'Original_Confirmation_Remark__c', batchField: 'Confirmation_Migration_Batch_Id__c', styleField: 'Confirmation_Clause_Style__c', markerStyle: 'Auto' },
  { key: 'nominationRemark', value: 'Nomination Remark', textField: 'Special_Remark_in_Nomination__c', enabledField: 'Add_to_Nomination__c', statusField: 'Nomination_Clause_Status__c', originalField: 'Original_Nomination_Remark__c', batchField: 'Nomination_Migration_Batch_Id__c', styleField: 'Nomination_Clause_Style__c', markerStyle: 'Auto' },
]);

function orgIdentity() {
  const result = spawnSync('sf', ['org', 'display', '--target-org', SALESFORCE_ALIAS, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, SF_TEMP_SHOW_SECRETS: 'true' },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Salesforce CLI authentication failed.');
  const org = JSON.parse(result.stdout).result || {};
  if (org.id !== EXPECTED_ORG_ID) throw new Error(`Salesforce identity mismatch. Expected ${EXPECTED_ORG_ID}; received ${org.id || 'unknown'}.`);
  if (!org.accessToken || !org.instanceUrl) throw new Error('Salesforce CLI did not return a usable authenticated org.');
  return org;
}

async function responseJson(response) {
  const body = await response.json().catch(() => null);
  if (response.ok) return body;
  const message = Array.isArray(body)
    ? body.flatMap((item) => item?.message || []).filter(Boolean).join('; ')
    : body?.message || body?.error?.message || body?.hint || body?.details || response.statusText;
  throw new Error(message || `Request failed with status ${response.status}.`);
}

function htmlToText(value) {
  const source = String(value || '');
  if (!/<\/?[a-z][\s\S]*>/i.test(source)) return source.replaceAll('&amp;', '&');
  let output = '';
  const lists = [];
  const parser = new Parser({
    onopentag(name) {
      if (name === 'br') output += '\n';
      if (name === 'ol') lists.push({ ordered: true, index: 0 });
      if (name === 'ul') lists.push({ ordered: false, index: 0 });
      if (name === 'li') {
        if (output && !output.endsWith('\n')) output += '\n';
        const list = lists.at(-1);
        if (list?.ordered) list.index += 1;
        output += list?.ordered ? `${list.index}. ` : '- ';
      }
    },
    ontext(text) { output += text; },
    onclosetag(name) {
      if (name === 'li') output += '\n';
      else if (name === 'ol' || name === 'ul') lists.pop();
      else if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'blockquote'].includes(name)) output += '\n\n';
    },
  }, { decodeEntities: true, lowerCaseTags: true });
  parser.write(source);
  parser.end();
  return output;
}

function isHeading(block) {
  const value = block.trim();
  const words = value.split(/\s+/).filter(Boolean);
  return words.length <= 10 && value.length <= 100 && (value === value.toUpperCase() || /(?:terms|clause|charges?|ifo|mgo)$/i.test(value));
}

function foldHeadings(blocks) {
  const clauses = [];
  let heading = '';
  for (const raw of blocks) {
    const block = normalizeClauseText(raw);
    if (!block) continue;
    if (isHeading(block) && !/^[-\u2013\u2014\u2022]\s+/.test(block)) {
      heading = heading ? `${heading}\n${block}` : block;
      continue;
    }
    clauses.push(heading ? `${heading}\n${block}` : block);
    heading = '';
  }
  if (heading) {
    if (clauses.length) clauses[clauses.length - 1] = `${clauses.at(-1)}\n${heading}`;
    else clauses.push(heading);
  }
  return clauses;
}

function manualClauses(termName, projectionKey, source) {
  if (!source) return null;
  const plain = normalizeClauseText(htmlToText(source));
  if (termName === 'Yudean Special Terms' && projectionKey === 'termsText') {
    const lines = plain.split('\n').map((line) => line.trim()).filter(Boolean);
    return lines.length > 1 ? [`${lines[0]}\n${lines[1]}`, ...lines.slice(2)] : [plain];
  }
  if (termName === 'Russia Special Terms (Customs Declaration Form)' && projectionKey === 'termsText') {
    return [plain];
  }
  if (/^HONG KONG \(DENSITY RESOLUTION AGREEMENT/.test(termName) && projectionKey !== 'termsText') {
    const blocks = plain.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
    const folded = [];
    let heading = '';
    for (const block of blocks) {
      if (/^FOR (?:IFO|MGO|IFO\s*&\s*MGO)$/i.test(block)) {
        heading = block;
        continue;
      }
      const nestedSamples = /^[-\u2013\u2014\u2022]\s+ONE SAMPLE/im.test(block);
      if (nestedSamples && folded.length) folded[folded.length - 1] = `${folded.at(-1)}\n${block}`;
      else folded.push(heading ? `${heading}\n${block}` : block);
      heading = '';
    }
    return folded;
  }
  if (termName === 'HONG KONG (TS LINES)' && projectionKey !== 'termsText') {
    return [plain.replace(/^--\s*/, '')];
  }
  return null;
}

function parseProjection(term, config) {
  const source = term[config.textField] || '';
  if (!String(source).trim()) return [];
  const manual = manualClauses(term.Name, config.key, source);
  if (manual) return manual.map(normalizeClauseText).filter(Boolean);
  const parsed = parseLegacyClauses(source, { termName: config.key === 'termsText' ? term.Name : '', markerStyle: config.markerStyle });
  if (parsed.markerCount > 0) return parsed.clauses;
  const blocks = normalizeClauseText(htmlToText(source)).split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return blocks.length > 1 ? foldHeadings(blocks) : parsed.clauses;
}

function cleanClause(value) {
  let clause = normalizeClauseText(value).replace(/^[-\u2013\u2014\u2022]{1,2}\s+/, '');
  clause = stripOuterClauseNumber(clause);
  if (!clause || clause.length < 3) throw new Error('A parsed legacy clause is blank.');
  if (clause.length > 32_768) throw new Error('A parsed legacy clause exceeds the Salesforce 32,768-character limit.');
  if (hasTopLevelListMarker(clause)) throw new Error('A parsed legacy clause still contains a top-level marker.');
  return clause;
}

function compactShortName(value) {
  const words = String(value || '').replace(/^\d+[.):]\s*/, '').trim().split(/\s+/).filter(Boolean);
  while (words.length < 3) words.push(words.length === 1 ? 'Special' : 'Clause');
  return words.slice(0, 7).join(' ').slice(0, 80);
}

function uniqueShortName(proposed, group, used) {
  let candidate = compactShortName(proposed || suggestClauseShortName(group.originalText));
  let key = shortNameKey(candidate);
  if (!used.has(key)) {
    used.add(key);
    return candidate;
  }
  const suffix = createHash('sha256').update(group.canonicalKey).digest('hex').slice(0, 4).toUpperCase();
  const words = candidate.split(/\s+/).slice(0, 5);
  candidate = compactShortName(`${words.join(' ')} Variant ${suffix}`);
  key = shortNameKey(candidate);
  let sequence = 2;
  while (used.has(key)) {
    candidate = compactShortName(`${words.join(' ')} Variant ${sequence}`);
    key = shortNameKey(candidate);
    sequence += 1;
  }
  used.add(key);
  return candidate;
}

function responseOutputText(payload) {
  return (payload?.output || []).flatMap((item) => item?.content || []).filter((part) => part?.type === 'output_text').map((part) => part.text).join('');
}

async function aiBatch(groups, apiKey, reservedShortNames) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      store: false,
      max_output_tokens: 12_000,
      reasoning: { effort: 'medium' },
      safety_identifier: clauseHash(EXPECTED_ORG_ID),
      input: [
        { role: 'system', content: [{ type: 'input_text', text: 'Draft professional FCOS Special Term clause-bank proposals. Preserve the exact legal meaning and every amount, deadline, party, supplier, port, product, standard, formula, and jurisdiction. Do not add or remove obligations, merge clauses, correct ambiguous commercial facts, or parameterize wording. Use concise shall/may contractual style where suitable. Keep forms, tables, internal bullets, and bilingual text structurally intact. Do not add a top-level number or hyphen. Produce a unique 3-7 word action-oriented short name with a material qualifier when necessary. Return JSON only: {"drafts":[{"id":"...","shortName":"...","category":"...","proposedText":"...","rationale":"..."}]}. Every output is an unapproved Draft.' }] },
        { role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ categories: CLAUSE_CATEGORIES, reservedShortNames, groups: groups.map((group) => ({ id: group.canonicalKey, originalText: group.originalText })) }) }] },
      ],
      text: { format: { type: 'json_object' } },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await responseJson(response);
  const parsed = JSON.parse(responseOutputText(payload));
  if (!payload.id || !Array.isArray(parsed?.drafts) || parsed.drafts.length !== groups.length) throw new Error('OpenAI returned an incomplete clause batch.');
  return { responseId: payload.id, drafts: parsed.drafts };
}

function aiBatches(groups) {
  const batches = [];
  let current = [];
  let chars = 0;
  for (const group of groups) {
    if (current.length && (current.length >= MAX_AI_GROUPS || chars + group.originalText.length > MAX_AI_INPUT_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(group);
    chars += group.originalText.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

function assertGraph(result) {
  const graph = result?.graphs?.[0];
  if (graph?.isSuccessful === true) return;
  const responses = graph?.graphResponse?.compositeResponse || graph?.compositeResponse || [];
  const failed = responses.find((row) => Number(row.httpStatusCode) < 200 || Number(row.httpStatusCode) >= 300);
  const message = failed?.body?.[0]?.message || failed?.body?.message || 'Salesforce rejected the all-or-none migration graph.';
  throw new Error(message);
}

async function main() {
  if (WITH_AI && !String(process.env.OPENAI_API_KEY || '').trim()) throw new Error('OPENAI_API_KEY is required for --ai. Use the approved protected environment runner.');
  const org = orgIdentity();
  const headers = { Authorization: `Bearer ${org.accessToken}`, 'Content-Type': 'application/json' };
  async function sfRequest(path, options = {}) {
    return responseJson(await fetch(`${org.instanceUrl}/services/data/${SALESFORCE_API_VERSION}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } }));
  }
  async function sfQuery(soql) {
    const records = [];
    let path = `/query?q=${encodeURIComponent(soql)}`;
    while (path) {
      const page = await sfRequest(path);
      records.push(...(page.records || []));
      path = page.nextRecordsUrl ? page.nextRecordsUrl.replace(`/services/data/${SALESFORCE_API_VERSION}`, '') : '';
    }
    return records;
  }
  async function currentTerm(termId) {
    const records = await sfQuery(`SELECT Id,LastModifiedDate FROM Special_Term__c WHERE Id = '${String(termId).replaceAll("'", "\\'")}' LIMIT 1`);
    if (!records[0]) throw new Error(`Special Term ${termId} no longer exists.`);
    return records[0];
  }
  async function graph(graphId, requests) {
    const result = await sfRequest('/composite/graph', { method: 'POST', body: JSON.stringify({ graphs: [{ graphId, compositeRequest: requests }] }) });
    assertGraph(result);
    return result;
  }

  const [terms, existingClauses, existingVersions, existingAssignments] = await Promise.all([
    sfQuery('SELECT Id,Name,Terms_Text__c,Add_to_Confirmation__c,Special_Remark_in_Confirmation__c,Add_to_Nomination__c,Special_Remark_in_Nomination__c,Clause_Structure_Status__c,Confirmation_Clause_Status__c,Nomination_Clause_Status__c,Approval_Status__c,Current_Revision__c,Original_Terms_Text__c,Original_Confirmation_Remark__c,Original_Nomination_Remark__c,LastModifiedDate FROM Special_Term__c ORDER BY Name,Id'),
    sfQuery('SELECT Id,Name,Short_Name_Key__c,Canonical_Text_Key__c,Origin__c,Status__c FROM Special_Term_Clause__c'),
    sfQuery('SELECT Id,Clause__c,Revision_Number__c,Status__c,Legacy_Source_Key__c FROM Special_Term_Clause_Version__c'),
    sfQuery("SELECT Id,Special_Term__c,Projection__c,Sequence__c,State__c,Clause__c,Clause_Version__c FROM Special_Term_Clause_Assignment__c WHERE State__c = 'Proposed'"),
  ]);
  if (terms.length !== 124) throw new Error(`Live Special Term count changed. Expected 124; received ${terms.length}.`);
  if (terms.some((term) => term.Current_Revision__c || term.Approval_Status__c === 'Approved')) throw new Error('At least one Special Term is already revision-controlled. Corpus migration requires a reviewed resume procedure.');

  const groups = new Map();
  const projectionsByTerm = new Map();
  let occurrenceCount = 0;
  const occurrenceCountByProjection = Object.fromEntries(PROJECTIONS.map((config) => [config.key, 0]));
  const disabledRemarkOccurrenceCountByProjection = Object.fromEntries(PROJECTIONS.filter((config) => config.enabledField).map((config) => [config.key, 0]));
  for (const term of terms) {
    const termProjections = [];
    for (const config of PROJECTIONS) {
      const clauses = parseProjection(term, config).map(cleanClause);
      const seen = new Set();
      const occurrences = clauses.map((originalText, index) => {
        const canonicalKey = canonicalClauseKey(originalText);
        if (seen.has(canonicalKey)) throw new Error(`${term.Name} repeats equivalent wording in ${config.value}; manual boundary review is required.`);
        seen.add(canonicalKey);
        if (!groups.has(canonicalKey)) groups.set(canonicalKey, { canonicalKey, originalText, occurrences: [] });
        const occurrence = { termId: term.Id, termName: term.Name, projection: config.value, projectionKey: config.key, sequence: index + 1 };
        groups.get(canonicalKey).occurrences.push(occurrence);
        occurrenceCount += 1;
        occurrenceCountByProjection[config.key] += 1;
        if (config.enabledField && term[config.enabledField] !== true) disabledRemarkOccurrenceCountByProjection[config.key] += 1;
        return { canonicalKey, ...occurrence };
      });
      termProjections.push({ config, occurrences });
    }
    projectionsByTerm.set(term.Id, termProjections);
  }

  const orderedGroups = [...groups.values()].sort((left, right) => right.occurrences.length - left.occurrences.length || left.canonicalKey.localeCompare(right.canonicalKey));
  const clauseByCanonical = new Map(existingClauses.map((row) => [row.Canonical_Text_Key__c, row]));
  const versionByClause = new Map(existingVersions.filter((row) => row.Revision_Number__c === 1).map((row) => [row.Clause__c, row]));
  const usedShortNames = new Set(existingClauses.map((row) => shortNameKey(row.Name)));
  const draftsByKey = new Map();

  if (WITH_AI) {
    for (const batch of aiBatches(orderedGroups.filter((group) => !clauseByCanonical.has(group.canonicalKey)))) {
      const result = await aiBatch(batch, process.env.OPENAI_API_KEY, [...usedShortNames].slice(-500));
      const byId = new Map(result.drafts.map((draft) => [String(draft.id), draft]));
      for (const group of batch) {
        const draft = byId.get(group.canonicalKey);
        if (!draft) throw new Error('OpenAI omitted a requested clause proposal.');
        const proposedText = cleanClause(draft.proposedText);
        if (hasMaterialDifference(group.originalText, proposedText)) throw new Error(`AI material-preservation validation failed for clause hash ${group.canonicalKey}.`);
        const shortName = uniqueShortName(draft.shortName, group, usedShortNames);
        draftsByKey.set(group.canonicalKey, { shortName, category: CLAUSE_CATEGORIES.includes(draft.category) ? draft.category : suggestClauseCategory(group.originalText), proposedText, responseId: result.responseId, rationaleHash: clauseHash(draft.rationale || '') });
      }
    }
  }
  for (const group of orderedGroups) {
    if (clauseByCanonical.has(group.canonicalKey) || draftsByKey.has(group.canonicalKey)) continue;
    draftsByKey.set(group.canonicalKey, { shortName: uniqueShortName(suggestClauseShortName(group.originalText), group, usedShortNames), category: suggestClauseCategory(group.originalText), proposedText: group.originalText, responseId: null, rationaleHash: null });
  }

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    aiDrafting: WITH_AI,
    salesforceOrgId: org.id,
    termCount: terms.length,
    occurrenceCount,
    occurrenceCountByProjection,
    disabledRemarkOccurrenceCountByProjection,
    uniqueClauseCount: orderedGroups.length,
    exactDuplicateGroupCount: orderedGroups.filter((group) => group.occurrences.length > 1).length,
    populatedTerms: terms.filter((term) => PROJECTIONS.some((config) => String(term[config.textField] || '').trim())).length,
    emptyTerms: terms.filter((term) => PROJECTIONS.every((config) => !String(term[config.textField] || '').trim())).length,
    termsTextPopulatedTerms: terms.filter((term) => String(term.Terms_Text__c || '').trim()).length,
    termsTextEmptyTerms: terms.filter((term) => !String(term.Terms_Text__c || '').trim()).length,
    populatedTermsByProjection: Object.fromEntries(PROJECTIONS.map((config) => [config.key, terms.filter((term) => String(term[config.textField] || '').trim()).length])),
    existingClauseCount: existingClauses.length,
    existingProposedAssignmentCount: existingAssignments.length,
    newClauseCount: orderedGroups.filter((group) => !clauseByCanonical.has(group.canonicalKey)).length,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (DIAGNOSTICS) {
    console.log(JSON.stringify({
      termProjectionCounts: terms.map((term) => ({
        termId: term.Id,
        termName: term.Name,
        projections: Object.fromEntries((projectionsByTerm.get(term.Id) || []).map(({ config, occurrences }) => [config.key, occurrences.length])),
      })).sort((left, right) => Object.values(right.projections).reduce((sum, count) => sum + count, 0) - Object.values(left.projections).reduce((sum, count) => sum + count, 0)),
    }, null, 2));
  }
  if (!APPLY) return;
  if (!Number.isInteger(ACCEPTED_LIVE_INVENTORY) || ACCEPTED_LIVE_INVENTORY !== occurrenceCount) {
    throw new Error(`Live corpus contains ${occurrenceCount} clause occurrences. Re-run the reviewed apply with --accept-live-inventory ${occurrenceCount}.`);
  }

  const newGroups = orderedGroups.filter((group) => !clauseByCanonical.has(group.canonicalKey));
  for (let offset = 0; offset < newGroups.length; offset += 200) {
    const batch = newGroups.slice(offset, offset + 200);
    const requests = [];
    batch.forEach((group, index) => {
      const draft = draftsByKey.get(group.canonicalKey);
      const clauseRef = `clause${index}`;
      requests.push(
        { method: 'POST', url: `/services/data/${SALESFORCE_API_VERSION}/sobjects/Special_Term_Clause__c`, referenceId: clauseRef, body: { Name: draft.shortName, Short_Name_Key__c: shortNameKey(draft.shortName), Canonical_Text_Key__c: group.canonicalKey, Category__c: draft.category, Status__c: 'Draft', Origin__c: 'Legacy', Legacy_Original_Text__c: group.originalText, Latest_Approved_Version_Number__c: 0 } },
        { method: 'POST', url: `/services/data/${SALESFORCE_API_VERSION}/sobjects/Special_Term_Clause_Version__c`, referenceId: `version${index}`, body: { Clause__c: `@{${clauseRef}.id}`, Revision_Number__c: 1, Clause_Text__c: draft.proposedText, Content_Hash__c: clauseHash(draft.proposedText), Status__c: 'Draft', Revision_Reason__c: 'Professional proposal prepared from preserved legacy wording for authorized review.', Proposed_By_Email__c: org.username || 'fcos-migration', Draft_Source__c: WITH_AI ? 'AI Assisted' : 'Legacy Migration', AI_Model__c: WITH_AI ? AI_MODEL : null, AI_Response_Id__c: draft.responseId, Legacy_Source_Key__c: group.canonicalKey } },
      );
    });
    await graph(`legacyClauseBank${offset}`, requests);
  }

  const createdClauses = await sfQuery('SELECT Id,Name,Canonical_Text_Key__c,Legacy_Original_Text__c,Origin__c,Status__c FROM Special_Term_Clause__c');
  const createdVersions = await sfQuery('SELECT Id,Clause__c,Revision_Number__c,Status__c,Legacy_Source_Key__c FROM Special_Term_Clause_Version__c WHERE Revision_Number__c = 1');
  const liveClauseByCanonical = new Map(createdClauses.map((row) => [row.Canonical_Text_Key__c, row]));
  const liveVersionByClause = new Map(createdVersions.map((row) => [row.Clause__c, row]));
  for (const group of orderedGroups) {
    const clause = liveClauseByCanonical.get(group.canonicalKey);
    const version = clause && liveVersionByClause.get(clause.Id);
    if (!clause || !version || clause.Origin__c !== 'Legacy' || clause.Legacy_Original_Text__c !== group.originalText || version.Status__c !== 'Draft') throw new Error(`Created clause verification failed for ${group.canonicalKey}.`);
    clauseByCanonical.set(group.canonicalKey, clause);
    versionByClause.set(clause.Id, version);
  }

  const existingKeys = new Set(existingAssignments.map((row) => `${row.Special_Term__c}:${row.Projection__c}:${row.Sequence__c}`));
  for (const term of terms) {
    const refreshedTerm = await currentTerm(term.Id);
    if (refreshedTerm.LastModifiedDate !== term.LastModifiedDate) throw new Error(`${term.Name} changed after inventory review. Re-run the migration dry-run.`);
    const requests = [];
    const batchId = randomUUID();
    for (const { config, occurrences } of projectionsByTerm.get(term.Id)) {
      occurrences.forEach((occurrence) => {
        const key = `${term.Id}:${config.value}:${occurrence.sequence}`;
        if (existingKeys.has(key)) return;
        const clause = clauseByCanonical.get(occurrence.canonicalKey);
        const version = versionByClause.get(clause.Id);
        requests.push({ method: 'POST', url: `/services/data/${SALESFORCE_API_VERSION}/sobjects/Special_Term_Clause_Assignment__c`, referenceId: `assignment${requests.length}`, body: { Special_Term__c: term.Id, Projection__c: config.value, Clause__c: clause.Id, Clause_Version__c: version.Id, Sequence__c: occurrence.sequence, State__c: 'Proposed', Migration_Batch_Id__c: batchId } });
      });
    }
    const patch = { Approval_Status__c: 'Legacy' };
    for (const config of PROJECTIONS) {
      patch[config.statusField] = 'In Review';
      patch[config.originalField] = term[config.originalField] ?? term[config.textField] ?? null;
      patch[config.batchField] = batchId;
      if (config.styleField) patch[config.styleField] = 'Hyphen';
    }
    requests.push({ method: 'PATCH', url: `/services/data/${SALESFORCE_API_VERSION}/sobjects/Special_Term__c/${term.Id}`, referenceId: 'term', body: patch });
    if (requests.length > 500) throw new Error(`${term.Name} exceeds the Composite Graph operation limit.`);
    await graph(`legacyTerm${term.Id}`, requests);
  }

  const [verificationTerms, verificationClauses, verificationVersions, verificationAssignments] = await Promise.all([
    sfQuery('SELECT Id,Approval_Status__c,Clause_Structure_Status__c,Confirmation_Clause_Status__c,Nomination_Clause_Status__c,Original_Terms_Text__c,Original_Confirmation_Remark__c,Original_Nomination_Remark__c FROM Special_Term__c'),
    sfQuery("SELECT Id FROM Special_Term_Clause__c WHERE Origin__c = 'Legacy'"),
    sfQuery("SELECT Id FROM Special_Term_Clause_Version__c WHERE Status__c = 'Draft' AND Legacy_Source_Key__c != null"),
    sfQuery("SELECT Id FROM Special_Term_Clause_Assignment__c WHERE State__c = 'Proposed'"),
  ]);
  const invalidTerms = verificationTerms.filter((term) => term.Approval_Status__c !== 'Legacy' || term.Clause_Structure_Status__c !== 'In Review' || term.Confirmation_Clause_Status__c !== 'In Review' || term.Nomination_Clause_Status__c !== 'In Review');
  if (invalidTerms.length || verificationClauses.length !== orderedGroups.length || verificationVersions.length !== orderedGroups.length || verificationAssignments.length !== occurrenceCount) throw new Error('Post-migration live verification did not match the reviewed corpus inventory.');
  console.log(JSON.stringify({ success: true, verifiedTerms: verificationTerms.length, verifiedLegacyClauses: verificationClauses.length, verifiedDraftVersions: verificationVersions.length, verifiedOccurrences: verificationAssignments.length }, null, 2));
}

main().catch((error) => {
  console.error(`Special Term clause-bank migration failed: ${error.message}`);
  process.exitCode = 1;
});
