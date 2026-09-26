export const XERO_PORTAL_LANGUAGE_STORAGE_KEY = 'fcos:xero-portal-language:v1';

export const XERO_PORTAL_UI_LANGUAGES = Object.freeze([
  { id: 'en', label: 'English' },
  { id: 'zh-Hant', label: '繁體中文' },
]);

// Static rows keep key | English | Traditional Chinese together without repeated array syntax.
// Text with pipes/newlines and dynamic values stays in explicit array rows.
function copyRows(parts) {
  if (parts.length !== 1) throw new Error('Invalid bilingual copy row');
  return parts[0].split('\n').map((row) => {
    const fields = row.split('|');
    if (fields.length !== 3 || fields.some((field) => !field.trim())) throw new Error('Invalid bilingual copy row');
    return fields;
  });
}

// Pair each field with its English and Traditional Chinese text so keys stay explicit.
function bilingualCopy(rows, chinese) {
  return Object.fromEntries(rows.map(([key, english, translation]) =>
    [key, Array.isArray(english) ? bilingualCopy(english, chinese) : chinese ? translation : english]));
}

const COMMON_COPY = copyRows`available|Available|可用
missing|Missing|缺少
unavailable|Not available|沒有資料
unknown|Unknown|未知
notConfigured|Not configured|未設定
readWrite|Read / write|讀取／寫入
readOnly|Read only|唯讀
pending|Pending|待處理
previous|Previous|上一頁
next|Next|下一頁
clear|Clear|清除
use|Use|使用
action|Action|操作
status|Status|狀態
reason|Reason|原因
date|Date|日期
total|Total|總額
type|Type|類別
amount|Amount|金額
bank|Bank|銀行
open|Open|開啟
exact|Exact|完全相符
notSet|Not set|未設定
noClKey|No CL Key|沒有 CL Key
noStem|No STEM|沒有 STEM
noType|No type|沒有類別
noIssue|No issue|沒有問題
none|None|無`;

const CONTACTS_COPY = [
  ["kpis", copyRows`active|Non-archived Xero|未封存 Xero
archived|Archived Xero|已封存 Xero
unmatched|Unmatched active|未配對有效聯絡人
rename|Rename eligible|可重新命名
archive|Archive eligible|可封存
exceptions|Exceptions|例外`],
  ...copyRows`title|Contact Cleanup & Sync|聯絡人整理及同步
description|Matching uses Xero current name only: Salesforce Account name or the Salesforce CL Key after removing leading HK. ContactNumber and AccountNumber are reference fields only.|配對只使用 Xero 現有名稱：Salesforce Account 名稱，或移除開首 HK 後的 Salesforce CL Key。ContactNumber 及 AccountNumber 只供參考。
showAll|Show all rows|顯示所有項目
showUnmatched|Show unmatched Xero|只顯示未配對 Xero
preview|Preview|預覽
fullUsage|Full usage refresh|完整更新使用紀錄
incrementalUsage|Incremental usage refresh|增量更新使用紀錄
jsonAudit|JSON audit|JSON 審計檔
csvAudit|CSV audit|CSV 審計檔
callEstimate|Xero call estimate|Xero API 呼叫估算
verify|Verify|驗證
apply|Apply|套用
noRun|No contact lifecycle preview has been generated in FCOS yet. The KPI cards and table will populate after Preview.|FCOS 尚未建立聯絡人生命週期預覽。按「預覽」後會顯示 KPI 及表格。`,
  ["lastRun", (id, date, count) => `Last contact lifecycle run ${id} loaded ${date} with ${count} audit rows.`, (id, date, count) => `最近聯絡人生命週期批次 ${id} 於 ${date} 載入，共有 ${count} 行審計紀錄。`],
  ...copyRows`search|Search Xero, Salesforce, CL Key|搜尋 Xero、Salesforce、CL Key
allActions|All actions|所有操作
allStatuses|All statuses|所有狀態
allReasons|All reasons|所有原因`,
  ["showing", (shown, selected, eligible) => `Showing ${shown} rows. Selected ${selected} total, ${eligible} visible eligible.`, (shown, selected, eligible) => `顯示 ${shown} 行；已選取 ${selected} 行，其中畫面內有 ${eligible} 行合資格。`],
  ...copyRows`selectVisible|Select visible eligible|選取畫面中合資格項目
reviewed|Reviewed|已覆核
applySelected|Apply selected|套用所選項目
tableLabel|Xero contact lifecycle rows|Xero 聯絡人生命週期項目
xeroContact|Xero contact|Xero 聯絡人
salesforceSource|Salesforce source|Salesforce 來源
match|Match|配對方式
usage|Usage|使用紀錄
noXeroMatch|No Xero match|沒有 Xero 配對
noContactNumber|No contact no.|沒有聯絡人編號
noAccountNumber|No account no.|沒有帳戶編號
noStatus|No status|沒有狀態
noSalesforceMatch|No Salesforce match|沒有 Salesforce 配對
noRowsTitle|No matching rows|沒有符合項目
noRowsDescription|Adjust filters or run a new preview.|請調整篩選條件或重新預覽。
noPreviewTitle|No lifecycle preview|尚未建立生命週期預覽
noPreviewDescription|Run Preview to load Xero contacts, Salesforce matches, and archive exceptions.|按「預覽」載入 Xero 聯絡人、Salesforce 配對及封存例外。
noReadableUsage|No readable usage|沒有可讀取的使用紀錄
previewRequired|Preview required|需要先預覽`,
  ["usageSourceTotal", (source, count) => `${source}: ${count}`, (source, count) => `${source}：${count}`],
  ["yearUnavailable", (count) => `Year unavailable: ${count}`, (count) => `年份不明：${count}`],
  ["yearBreakdownPending", 'Year breakdown not yet scanned. Refresh Preview.', '尚未掃描年份分布。請重新按「預覽」。'],
  ["identity", copyRows`review|Review Xero-only identity|檢閱 Xero 獨有身分
title|Contact identity decision|聯絡人身分決定
description|Verify this Xero contact only when evidence shows that no Salesforce Account is required. The decision is audited and rechecked against the current contact.|只有證據顯示無需 Salesforce Account 時，才核實此 Xero 聯絡人。決定會留有審計紀錄，並以目前聯絡人資料重新核對。
current|Current audited decision|目前已審計決定
verified|Verified Xero-only|已核實為 Xero 獨有
revoked|Verification revoked|核實已撤銷
none|No decision recorded|尚未記錄決定
decision|Decision|決定
verify|Verify Xero-only|核實為 Xero 獨有
revoke|Revoke verification|撤銷核實
revision|Revision|修訂
actor|Reviewed by|檢閱者
updated|Updated|更新時間
reference|Evidence reference|證據參考
note|Evidence note|證據備註
noteRequirement|Explain the counterparty identity in at least 15 characters; include a source reference.|請至少用 15 字說明交易對手身分，並提供來源參考。
reviewed|I reviewed the current Xero contact and evidence|我已檢閱目前的 Xero 聯絡人及證據
cancel|Cancel|取消
saveFailed|The identity decision could not be saved.|無法儲存身分決定。
uncertain|The decision result is uncertain. Do not retry; refresh the contact preview and inspect the audited decision.|無法確定身分決定的結果。請勿重試；請更新聯絡人預覽並檢查審計紀錄。`],
  ["repair", [
    ["selected", (count) => `${count} missing contacts selected separately`, (count) => `另行選取 ${count} 個缺少的聯絡人`],
    ...copyRows`reviewed|I reviewed these missing Salesforce contacts|我已檢閱這些缺少的 Salesforce 聯絡人
createSelected|Create selected missing contacts|建立所選缺少的聯絡人
limit|Select no more than 25 contacts per reviewed batch.|每個已檢閱批次最多可選 25 個聯絡人。
failed|Contact repair failed|聯絡人修復失敗
completed|Contact repair reviewed; the preview will refresh.|已檢閱聯絡人修復；預覽將會更新。
uncertain|Contact creation outcome uncertain — do not retry|建立聯絡人的結果未能確定，請勿重試
uncertainDetail|The response did not confirm every selected contact. Refresh the contact preview and inspect Xero before another attempt.|回應未能確認每個所選聯絡人。再次嘗試前，請更新聯絡人預覽並在 Xero 查明結果。`,
    ["outcome", (summary) => `${summary.created || 0} created, ${summary.existing || 0} already existed, ${summary.blocked || 0} blocked, ${summary.uncertain || 0} uncertain. Resolve uncertain results in Xero before another attempt.`, (summary) => `已建立 ${summary.created || 0} 個、原已存在 ${summary.existing || 0} 個、受阻 ${summary.blocked || 0} 個、結果未明 ${summary.uncertain || 0} 個。再次嘗試前，請在 Xero 查明結果。`]
  ]]
];

const REASONS_COPY = copyRows`blank-salesforce-key|Missing Salesforce CL Key|缺少 Salesforce CL Key
blank-salesforce-name|Missing Salesforce Account name|缺少 Salesforce Account 名稱
xero-name-too-long|Salesforce name is longer than Xero allows|Salesforce 名稱超出 Xero 長度限制
duplicate-salesforce-key|Duplicate Salesforce CL Key|Salesforce CL Key 重複
duplicate-xero-name|Duplicate Xero contact name|Xero 聯絡人名稱重複
ambiguous-xero-name-match|Salesforce name and HK-stripped CL Key matched different Xero contacts|Salesforce 名稱及移除 HK 的 CL Key 分別配對至不同 Xero 聯絡人
missing-xero-contact|No Xero contact matched the Salesforce name or HK-stripped CL Key name|Salesforce 名稱或移除 HK 的 CL Key 名稱均未配對到 Xero 聯絡人
archived-only-match|Only archived Xero contacts matched|只配對到已封存的 Xero 聯絡人
unchanged-name|Xero contact already has this name|Xero 聯絡人已使用此名稱
duplicate-target-name|Multiple Salesforce rows propose the same Xero name|多個 Salesforce 項目建議使用相同 Xero 名稱
target-name-collision|Another active Xero contact already uses this name|另一個有效 Xero 聯絡人已使用此名稱
invalid-account-id|Salesforce Account ID is missing or invalid|Salesforce Account ID 缺少或無效
unsupported-source-field|Salesforce source object or Account field is not enabled for auto-create|Salesforce 來源物件或 Account 欄位未啟用自動建立
salesforce-account-not-found|Salesforce Account was not found|找不到 Salesforce Account
inactive-salesforce-account|Salesforce Account is inactive or suspended|Salesforce Account 已停用或暫停
unsupported-salesforce-record-type|Salesforce Account record type is not enabled for Xero contacts|此 Salesforce Account Record Type 未啟用 Xero 聯絡人
non-hk-cl-key|Salesforce CL Key does not start with HK|Salesforce CL Key 並非以 HK 開始
duplicate-create-name|Multiple missing Salesforce Accounts would create the same Xero contact name|多個缺少的 Salesforce Account 會建立相同 Xero 聯絡人名稱
xero-contact-exists|Matching active Xero contact already exists|相符的有效 Xero 聯絡人已存在
xero-contact-created|Created in Xero|已在 Xero 建立
xero-create-failed|Xero contact create failed|建立 Xero 聯絡人失敗
xero-not-connected|Xero is not connected with accounting.contacts|Xero 未連接 accounting.contacts
unused-unmatched-xero-contact|Unused Xero contact has no Salesforce match|未使用的 Xero 聯絡人沒有 Salesforce 配對
used-unmatched-xero-contact|Used Xero contact has no Salesforce match|已使用的 Xero 聯絡人沒有 Salesforce 配對
nonzero-balance|Xero contact has a nonzero balance|Xero 聯絡人仍有非零結餘
ambiguous-salesforce-match|Xero contact is protected by an ambiguous Salesforce match|此 Xero 聯絡人因 Salesforce 配對不明確而受保護
already-archived|Xero contact is already archived|Xero 聯絡人已封存
blocked-scope|Xero scope cannot read this usage source|Xero 授權範圍無法讀取此使用來源
usage-scan-incomplete|Readable Xero usage scan is incomplete|可讀取的 Xero 使用掃描並不完整
stale-preview|Xero contact changed after preview|Xero 聯絡人在預覽後已變更
not-selected|Eligible row was not selected for apply|套用時未有選取此合資格項目
verified-xero-only|Verified Xero-only counterparty; no Salesforce Account is required|已核實為 Xero 獨有交易對手；無需 Salesforce Account
verification-stale|Xero-only identity changed; verify it again|Xero 獨有身分已變更；請重新核實`;

const FINANCIAL_COPY = [
  ...copyRows`loadingTitle|Loading accounting controls|正在載入會計控制項
loadingDescription|Loading mappings and the Xero Chart of Accounts.|正在載入對應設定及 Xero 會計科目表。
gateEnabled|Financial write gate enabled|財務寫入閘門已啟用
gateLocked|Financial write gate locked|財務寫入閘門已鎖定
mappings|Mappings|對應設定
preview|Build read-only preview|建立唯讀預覽
reconnect|Reconnect Xero once to grant accounting.settings.read and the write-capable accounting.payments scope.|請重新授權 Xero，以授予 accounting.settings.read 及可寫入的 accounting.payments 授權範圍。
reconciliationTitle|Salesforce → Xero reconciliation|Salesforce → Xero 對帳
fixedScope|Fixed scope: from 1 Jan 2026|固定範圍：由 2026 年 1 月 1 日起
reconciliationDescription|Compare all in-scope Salesforce invoices, bills, credit notes and payments with Xero. Records created since 1 Jan 2026 with missing dates, and unsupported or incomplete payments, remain exceptions.|一次檢查會把範圍內所有 Salesforce 買方發票、供應商帳單、貸項通知單及付款，與已連接的 Xero 機構比較。2026 年 1 月 1 日起建立但欠缺會計日期的紀錄，以及不支援或資料不完整的付款，均會保留為例外。
checkEverything|Check everything|檢查全部
checkingEverything|Checking documents and payments…|正在檢查文件及付款…
completion|Verified completion|已驗證完成度
salesforceRecords|Salesforce records|Salesforce 紀錄
correctInXero|Correct in Xero|Xero 資料正確
awaitingSync|Awaiting sync|等候同步
exceptions|Exceptions|例外
setupTitle|Advanced mapping setup|進階對應設定
setupDescription|Open only when an exception asks for a Product, tax, or bank mapping.|只在例外要求設定產品、稅務或銀行對應時才需要開啟。`,
  ["reconciliationStatuses", copyRows`not_checked|Not checked|尚未檢查
incomplete_check|Check incomplete|檢查未完成
attention_required|Action required|需要處理
sync_required|Ready for reviewed sync|可供覆核同步
reconciled|100% reconciled|100% 已對帳`],
  ["reconciliationDescriptions", copyRows`not_checked|Run Check everything to compare Salesforce and Xero.|按「檢查全部」建立完整 Salesforce 及 Xero 控制總數。
incomplete_check|Completion requires successful document and payment checks.|文件及付款均成功核對後，才會顯示完成度。
attention_required|Resolve the exceptions. Protected Xero history stays unchanged; differences remain visible for Finance review.|請先解決所有例外。受保護的 Xero 會計紀錄不會被覆寫；任何差異會保留供財務部處理。
sync_required|Review and authorise pending actions, then run them. FCOS rechecks Xero automatically.|所有紀錄已分類。請覆核及授權待處理的文件及付款，執行後 FCOS 會自動重新檢查 Xero。
reconciled|All records match or have accepted legacy differences. Retained differences remain visible; no blockers remain.|所有範圍內紀錄已配對或明確核准舊差異；保留的差異仍可查閱，沒有待處理阻礙。`],
  ["mappingTitle", 'Finance-approved Product mappings', '財務部核准的產品對應'],
  ["mappingDescription", 'Default tax is NONE. Buyer sales and supplier costs are mapped independently. Legacy suggestions are never approved automatically.', '預設稅務類別為 NONE。買方銷售及供應商成本會分開對應；系統不會自動核准舊系統建議。'],
  ["savedMappings", (count) => `${count} saved mappings`, (count) => `已儲存 ${count} 個對應`],
  ["proposalSummary", (proposed, conflicts) => `${proposed} evidence-backed suggestions · ${conflicts} conflicts`, (proposed, conflicts) => `${proposed} 個有證據的建議 · ${conflicts} 個衝突`],
  ["mappingRange", (from, to, total) => `Mappings ${from}–${to} of ${total} · suggestions first`, (from, to, total) => `對應 ${from}–${to}／共 ${total} 個 · 建議優先`],
  ...copyRows`productMappingsLabel|Xero product mappings|Xero 產品對應
direction|Direction|方向
salesforceProduct|Salesforce Product|Salesforce 產品
xeroAccount|Xero account|Xero 帳戶
taxType|Tax type|稅務類別
action|Action|操作
noProducts|Build the first preview to load every Product used by 2026 financial documents.|建立首次預覽，以載入 2026 年財務文件使用的所有產品。
bankTitle|Payment bank mappings|付款銀行對應
bankDescription|Exact Salesforce Receivable/Payable payments remain blocked until Finance maps each source bank to one Xero bank account.|在財務部把每個 Salesforce 收款／付款銀行對應至一個 Xero 銀行帳戶前，精確付款仍會被封鎖。
reviewTitle|Finance batch review|財務批次覆核`,
  ["runSummary", (id, status, selected, eligible) => `Run ${id} · ${status} · ${selected} selected of ${eligible} eligible.`, (id, status, selected, eligible) => `批次 ${id} · ${status} · 已選 ${selected}／${eligible} 個合資格項目。`],
  ["selectEligible", 'Select eligible', '選取合資格項目'],
  ["authorise", 'Authorise batch', '授權批次'],
  ["rowRange", (from, to, total) => `Rows ${from}–${to} of ${total}`, (from, to, total) => `第 ${from}–${to} 行／共 ${total} 行`],
  ...copyRows`documentTableLabel|Xero financial cutover classifications|Xero 財務切換分類
salesforceDocument|Salesforce document|Salesforce 文件
accountStem|Account / STEM|Account／STEM
due|Due|到期日
noActiveMatch|No active match|沒有有效配對`,
  ["differenceCount", (count) => `${count} Salesforce difference(s)`, (count) => `${count} 項 Salesforce 差異`],
  ...copyRows`paymentsTitle|Exact payment allocations|精確付款分配
paymentsDescription|Available only after the matching Xero invoice or bill is authorised. Remittances, deposits, charges, write-offs and ambiguous allocations remain exceptions.|只在相符的 Xero 發票或帳單獲授權後可用。匯款、按金、費用、撇帳及不明確分配仍列為例外。
previewPayments|Preview payments|預覽付款`,
  ["paymentSummary", (total, eligible) => `${total} classified · ${eligible} exact allocations eligible.`, (total, eligible) => `已分類 ${total} 項 · ${eligible} 項精確付款合資格。`],
  ...copyRows`financeReviewedPayments|Finance reviewed payments|財務部已覆核付款
applyPayments|Apply exact payments|套用精確付款
reviewPaymentReference|Review retained reference|檢閱保留的參考資料
paymentReferenceTitle|Review retained Xero payment reference|檢閱保留的 Xero 付款參考資料
paymentReferenceDescription|The Salesforce payment has no explicit reference. Confirm the exact invoice, bank, date, amount and currency before linking this existing Xero payment. This records an FCOS mapping only; it does not create or change a Xero payment.|Salesforce 付款沒有明確參考資料。連結現有 Xero 付款前，請核對確切發票、銀行、日期、金額及幣別。此操作只記錄 FCOS 對應，不會建立或更改 Xero 付款。
sourceReference|Salesforce explicit reference|Salesforce 明確參考資料
sourceFallbackReference|Salesforce payment name fallback|Salesforce 付款名稱備用值
retainedXeroReference|Retained Xero reference|保留的 Xero 參考資料
xeroPaymentId|Xero payment ID|Xero 付款 ID
xeroInvoice|Xero invoice or bill|Xero 發票或帳單
bankAccountId|Xero bank account ID|Xero 銀行帳戶 ID
missingReference|Absent|沒有
paymentReferenceEvidenceMissing|Payment evidence is incomplete or changed. Recheck everything before approval.|付款證據不完整或已變更。核准前請重新完整核對。
paymentReferenceLinked|Existing payment reference linked|已連結現有付款參考資料
paymentReferenceStopped|Payment reference link stopped safely|付款參考資料連結已安全停止
paymentReferenceOutcomeMissing|The server did not confirm a linked outcome. Recheck before retrying.|伺服器未確認連結成功。重試前請重新核對。
approvePaymentReference|Approve link only|只核准連結
paymentTableLabel|Exact Xero payment classifications|精確 Xero 付款分類`,
  ["fileDiscovery", [
    ...copyRows`title|Attached PDF candidates|附加 PDF 候選文件
description|Only file details have been checked; invoice contents are unverified.|只核對了文件資料；發票內容尚未核實。
captured|Lookup captured (Hong Kong)|查閱時間（香港）
stale|Saved preview observation; attachments may have changed.|已儲存預覽的觀察資料；附件可能已變更。
complete|Complete direct-link lookup|直接連結查閱完整
empty|Complete lookup found no directly linked PDFs.|完整查閱未找到直接連結的 PDF。
partial|Incomplete lookup; this is not a full candidate list.|查閱不完整；此候選清單並不完整。
unavailable|Attachment metadata was unavailable; absence is not established.|附件中繼資料未能取得；不能確定沒有附件。
not_checked|Not checked in this saved preview.|此已儲存預覽尚未查閱附件。`,
    ["count", (count) => `${count} PDF candidate(s) observed`, (count) => `已觀察到 ${count} 份 PDF 候選文件`],
    ["displayLimit", (shown, count) => `Showing ${shown} of ${count} observed candidates.`, (shown, count) => `顯示 ${count} 份已觀察候選文件中的 ${shown} 份。`],
    ["inspect", 'Inspect STEM documents', '查看 STEM 文件']
  ]],
  ["paymentHoldsTitle", 'Xero payment evidence requiring review', '需要覆核的 Xero 付款證據'],
  ["paymentHoldsCount", (count) => `${count} Xero payment record${count === 1 ? '' : 's'} held for separate review`, (count) => `${count} 筆 Xero 付款紀錄待個別覆核`],
  ...copyRows`paymentHoldsDescription|These records remain unresolved and cannot be selected for automatic linking or payment. Other verified invoice payments can still be reviewed.|這些紀錄尚未解決，不能選作自動連結或付款。其他已核實的發票付款仍可覆核。
paymentHoldsDetails|Show held payment records|顯示待覆核付款紀錄
paymentHoldRefundReason|Finance must verify the refund and its original credit, prepayment or overpayment before resolving it.|財務部須核實退款及其原始貸項、預付款或溢付款，才可解決此紀錄。
paymentHoldInvalidReason|The payment association is incomplete or conflicting. Finance must resolve its transaction identity.|付款的關聯資料不完整或有衝突。財務部須確認其交易身份。`,
  ["paymentHoldKinds", copyRows`credit_note|Credit-note refund|貸項退款
prepayment|Prepayment refund|預付款退款
overpayment|Overpayment refund|溢付款退款
invoice|Invoice payment evidence|發票付款證據
unknown|Unresolved payment evidence|未解決的付款證據`],
  ...copyRows`payment|Payment|付款
actionReason|Action / reason|操作／原因
noPaymentPreview|No payment preview loaded.|尚未載入付款預覽。
noPreviewTitle|No accounting preview yet|尚未建立會計預覽
noPreviewDescription|Approve Product mappings as they are discovered, then rerun until every 2026 document is classified exactly once.|產品出現後逐一核准對應，再重新預覽，直至每份 2026 年文件只被分類一次。
selectAccount|Select Xero account|選擇 Xero 帳戶
selectBank|Select Xero bank account|選擇 Xero 銀行帳戶
approveMapping|Approve mapping|核准對應
updateApproval|Update approval|更新核准
mappingSaveFailed|Mapping save failed|儲存對應失敗
mappingSaved|Product mapping saved|產品對應已儲存
bankSaveFailed|Bank mapping save failed|儲存銀行對應失敗`,
  ["bankSaved", (bank) => `${bank} bank mapping saved`, (bank) => `${bank} 銀行對應已儲存`],
  ["approved", 'Approved', '已核准'],
  ["approvedBy", (email) => `Approved by ${email}`, (email) => `由 ${email} 核准`],
  ["suggested", (count, basis) => `Suggested from ${count} exact matched legacy document${count === 1 ? '' : 's'} · ${basis}`, (count, basis) => `根據 ${count} 份完全配對的舊系統文件建議 · ${basis}`],
  ["conflicting", (items) => `Conflicting legacy evidence: ${items}`, (items) => `舊系統證據有衝突：${items}`],
  ["noSuggestion", 'No exact legacy suggestion', '沒有完全配對的舊系統建議'],
  ["basis", copyRows`exact_line|line coding matched|明細編碼相符
uniform_document|uniform document coding|整份文件使用同一編碼
default|consistent line/document coding|明細／文件編碼一致`],
  ["directions", copyRows`buyer|Buyer|買方
supplier|Supplier|供應商`],
  ...copyRows`batchCompleted|Xero document batch completed|Xero 文件批次已完成
paymentPreviewFailed|Payment preview failed|付款預覽失敗
paymentStopped|Payment apply stopped safely|套用付款已安全停止
paymentsApplied|Exact Xero payments applied|已套用精確 Xero 付款`,
  ["outcome", (summary) => `${summary.created || 0} created, ${summary.updated || 0} updated, ${summary.linked || 0} linked, ${summary.applied || 0} payments, ${summary.failed || 0} failed.`, (summary) => `建立 ${summary.created || 0} 項、更新 ${summary.updated || 0} 項、連結 ${summary.linked || 0} 項、付款 ${summary.applied || 0} 項、失敗 ${summary.failed || 0} 項。`],
  ["documentKinds", copyRows`buyer_invoice|Buyer invoice|買方發票
supplier_bill|Supplier bill|供應商帳單
buyer_credit_note|Buyer credit note|買方貸項通知單
supplier_credit_note|Supplier credit note|供應商貸項通知單`],
  ["actions", copyRows`create_draft|Create draft|建立草稿
safe_update|Safe update|安全更新
protected_legacy|Protected legacy|受保護舊紀錄
link_exact|Link exact match|連結完全相符項目
blocked|Blocked|已封鎖
payment_apply|Apply payment|套用付款
payment_reference_link|Retained reference · link only|保留參考資料 · 只連結
payment_link|Linked payment|已連結付款`]
];

const HEADER_COPY = copyRows`title|Xero Portal|Xero Portal
connected|Connected|已連線
disconnected|Disconnected|未連線
writesEnabled|Xero writes enabled|Xero 寫入已啟用
writesGated|Xero writes gated|Xero 寫入已鎖定
subtitle|Finance-reviewed Salesforce accounting sync, receipt draft bills, Account contact sync, unused-contact review, and automation audit.|經財務部覆核的 Salesforce 會計同步、收據草稿供應商帳單、Account 聯絡人同步、未使用聯絡人覆核及自動化審計。
manual|User manual|使用手冊
refresh|Refresh|重新整理
reconnect|Reconnect scopes|重新授權
disconnect|Disconnect|中斷連線
connect|Connect Xero|連接 Xero
loadingTitle|Loading Xero Portal|正在載入 Xero Portal
loadingDescription|FCOS is reading the Xero connection, receipt audit, and latest contact lifecycle run.|FCOS 正在讀取 Xero 連線、收據審計及最新聯絡人生命週期批次。`;

const PANELS_COPY = copyRows`tenant|Xero tenant|Xero 機構
organisation|Organisation|機構
notConnected|Not connected|未連線
tenantId|Tenant ID|Tenant ID
tokenExpires|Token expires|權杖到期時間
redirectUri|Redirect URI|重新導向 URI
scopes|Xero scopes|Xero 授權範圍
contacts|Contacts|聯絡人
invoices|Invoices|發票及帳單
attachments|Attachments|附件
payments|Payments|付款
accountingSettings|Accounting settings|會計設定
salesforce|Salesforce source|Salesforce 來源
auth|Auth|驗證方式
instance|Instance|執行個體
clKey|CL Key|CL Key
hkOnly|HK* only|只限 HK*
deliveryFrom|Delivery from|交付日期起點
automation|Latest automation|最新自動化
run|Run|批次
event|Event|事件
created|Created|已建立
skippedFailed|Skipped / failed|略過／失敗
noRun|No run|沒有批次`;

const STATUSES_COPY = copyRows`eligible|Eligible|合資格
blocked|Blocked|已封鎖
kept|Kept|已保留
updated|Updated|已更新
archived|Archived|已封存
failed|Failed|失敗
complete|Complete|完成
missing|Missing|缺少
pending|Pending|待處理
created|Created|已建立
skipped|Skipped|已略過
already-exists|Already exists|已存在
not-selected|Not selected|未選取
protected|Protected|受保護
authorised|Authorised|已授權
partial|Partial|部分完成
ready_for_review|Ready for review|可供覆核
synced|Synced|已同步
unknown|Unknown|未知`;

const STATUSDESCRIPTIONS_COPY = copyRows`eligible|Safe to apply after review and selection.|覆核及選取後可安全套用。
blocked|Cannot be applied automatically; review the reason and map or correct the data first.|不可自動套用；請覆核原因並先完成對應或修正資料。
kept|No Xero mutation is needed; the contact remains active.|不需要更改 Xero；聯絡人維持有效。
not-selected|The row was eligible in preview but was not selected in the apply step.|此行在預覽中合資格，但套用時未有選取。
updated|The selected Xero contact rename was applied.|已套用所選 Xero 聯絡人重新命名。
archived|The selected Xero contact was archived in Xero.|已在 Xero 封存所選聯絡人。
failed|The row was selected but Xero or validation rejected the mutation.|已選取此行，但 Xero 或驗證拒絕更改。`;

const TOASTS_COPY = copyRows`connected|Xero connected|Xero 已連線
connectedDescription|FCOS can now read and update the connected Xero organisation.|FCOS 現可讀取及更新已連接的 Xero 機構。
connectionFailed|Xero connection failed|Xero 連線失敗
connectionFailedDescription|Check the Xero app settings and try again.|請檢查 Xero 應用程式設定後再試。
connectionUnavailable|Xero connection unavailable|Xero 連線暫不可用
disconnectFailed|Disconnect failed|中斷連線失敗
disconnected|Xero disconnected|Xero 已中斷連線
previewFailed|Preview failed|預覽失敗
applyFailed|Apply failed|套用失敗
changesApplied|Xero contact changes applied|已套用 Xero 聯絡人更改
ocrImagesOnly|OCR supports image receipts|OCR 只支援圖片收據
ocrImagesOnlyDescription|PDF receipts can still be saved and synced after entering the fields manually.|PDF 收據仍可在手動輸入資料後儲存及同步。
ocrFailed|OCR failed|OCR 失敗
ocrFailedDescription|Enter the receipt fields manually.|請手動輸入收據資料。
fileRequired|Receipt file required|必須提供收據檔案
fileRequiredDescription|Choose an image or PDF receipt first.|請先選擇圖片或 PDF 收據。
receiptSyncFailed|Receipt sync failed|收據同步失敗
receiptSaveFailed|Receipt save failed|收據儲存失敗
receiptSent|Receipt sent to Xero|收據已傳送至 Xero
receiptSaved|Receipt saved|收據已儲存
receiptSentDescription|A draft bill was created and the file attached.|已建立草稿供應商帳單並附上原始檔案。
receiptSavedDescription|The receipt is stored in FCOS.|收據已儲存於 FCOS。`;

const RECEIPTS_COPY = copyRows`title|Scan Receipt|掃描收據
file|Receipt file|收據檔案
chooseFile|Choose file|選擇檔案
noFile|No file selected|尚未選擇檔案
ocr|OCR image|OCR 圖片
reset|Reset|重設
merchant|Merchant|商戶
date|Date|日期
total|Total|總額
currency|Currency|貨幣
account|Account|會計科目
tax|Tax|稅務類別
category|Category|分類
notes|Notes / OCR text|備註／OCR 文字
save|Save draft|儲存草稿
createBill|Create Xero draft bill|建立 Xero 草稿供應商帳單
auditTitle|Receipt Audit|收據審計
auditLabel|Receipt audit|收據審計
receipt|Receipt|收據
status|Status|狀態
xero|Xero|Xero
updated|Updated|更新時間
action|Action|操作
draftBill|Draft bill|草稿供應商帳單
notSynced|Not synced|未同步
sync|Sync|同步
emptyTitle|No receipts stored|沒有已儲存收據
emptyDescription|Upload a receipt to create the first draft audit row.|上載收據以建立第一行草稿審計紀錄。`;

const AUTOMATION_COPY = copyRows`title|Salesforce Trigger Contact Creation|Salesforce 觸發建立聯絡人
description|FCOS records every signed Salesforce event that checks for newly used Account names missing from Xero.|FCOS 會記錄每個已簽署的 Salesforce 事件，以檢查新使用的 Account 名稱是否尚未存在於 Xero。
pending|Pending|待處理
created|Created|已建立
alreadyExists|Already exists|已存在
failed|Failed|失敗
tableLabel|Auto-created Xero contact rows|自動建立的 Xero 聯絡人項目
salesforceAccount|Salesforce Account|Salesforce Account
xeroContact|Xero Contact|Xero 聯絡人
match|Match|配對方式
reason|Reason|原因
noAccount|No Account|沒有 Account
noXeroContact|No Xero contact|沒有 Xero 聯絡人
emptyTitle|No automation audit run yet|尚未有自動化審計批次
emptyDescription|A Salesforce trigger run will appear here after a signed event reaches FCOS.|當已簽署的 Salesforce 事件到達 FCOS 後，批次會顯示於此。`;

const TABS_COPY = copyRows`contacts|Contacts|聯絡人
accounting|Salesforce → Xero|會計同步
receipts|Receipts|收據
automation|Auto-Created Contacts|自動建立聯絡人
manual|User Manual|使用手冊`;
const MANUAL_COPY = copyRows`loadingTitle|Loading Xero Portal manual|正在載入 Xero Portal 使用手冊
loadingDescription|FCOS is loading the English and Traditional Chinese user guide.|FCOS 正在載入英文及繁體中文使用指引。`;
const ACTIONS_COPY = copyRows`archive|Archive|封存
rename|Rename|重新命名
exception|Exception|例外
keep|Keep|保留
unknown|Unknown|未知`;
const MATCH_FIELDS_COPY = copyRows`SalesforceName|Salesforce name|Salesforce 名稱
ClKeyWithoutHk|CL key without HK|移除 HK 的 CL Key
SalesforceNameAndClKeyWithoutHk|Salesforce name + CL key without HK|Salesforce 名稱及移除 HK 的 CL Key`;
const USAGE_SOURCES_COPY = copyRows`invoices|Invoices and bills|發票及帳單
credit-notes|Credit notes|貸項通知單
bank-transactions|Bank transactions|銀行交易
payments|Payments|付款
overpayments|Overpayments|多付金額
prepayments|Prepayments|預付款
expense-claims|Expense claims|費用申報
receipts|Receipts|收據`;
const RECORD_TYPES_COPY = copyRows`Buyer|Buyer|買方
Supplier|Supplier|供應商
Buyer_Supplier|Buyer & Supplier|買方及供應商
Broker|Broker|經紀`;

function buildCopy(chinese) {
  return {
    locale: chinese ? 'zh-HK' : 'en-GB',
    languageLabel: chinese ? 'Xero Portal 語言' : 'Xero Portal language',
    common: bilingualCopy(COMMON_COPY, chinese),
    header: bilingualCopy(HEADER_COPY, chinese),
    tabs: bilingualCopy(TABS_COPY, chinese),
    toasts: bilingualCopy(TOASTS_COPY, chinese),
    panels: bilingualCopy(PANELS_COPY, chinese),
    contacts: bilingualCopy(CONTACTS_COPY, chinese),
    receipts: bilingualCopy(RECEIPTS_COPY, chinese),
    automation: bilingualCopy(AUTOMATION_COPY, chinese),
    manual: bilingualCopy(MANUAL_COPY, chinese),
    actions: bilingualCopy(ACTIONS_COPY, chinese),
    statuses: bilingualCopy(STATUSES_COPY, chinese),
    statusDescriptions: bilingualCopy(STATUSDESCRIPTIONS_COPY, chinese),
    reasons: bilingualCopy(REASONS_COPY, chinese),
    matchFields: bilingualCopy(MATCH_FIELDS_COPY, chinese),
    usageSources: bilingualCopy(USAGE_SOURCES_COPY, chinese),
    recordTypes: bilingualCopy(RECORD_TYPES_COPY, chinese),
    financial: bilingualCopy(FINANCIAL_COPY, chinese),
  };
}

const EN = buildCopy(false);
const ZH_HANT = buildCopy(true);

export const XERO_PORTAL_UI_COPY = Object.freeze({ en: EN, 'zh-Hant': ZH_HANT });

export function normalizeXeroPortalLanguage(value) {
  return value === 'zh-Hant' ? 'zh-Hant' : 'en';
}

export function xeroPortalUiCopy(language) {
  return XERO_PORTAL_UI_COPY[normalizeXeroPortalLanguage(language)];
}
