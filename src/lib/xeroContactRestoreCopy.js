export function xeroContactRestoreCopy(language) {
  return language === 'zh-Hant' ? {
    title: '恢復已核實聯絡人',
    description: '只恢復現有 Contact ID，保留帳單、付款及聯絡人資料。此操作不會自動解除文件暫停。',
    selected: (count) => `已選擇 ${count} 個恢復項目（最多 25 個）`,
    reviewed: '我已核對選定聯絡人及恢復範圍',
    select: '選擇恢復', clear: '清除恢復選擇',
    limit: '每次最多選擇 25 個聯絡人。',
    readOnly: '聯絡人寫入閘門未啟用，暫時只供檢視。',
    completed: '聯絡人恢復結果已核實',
    verify: '請核實聯絡人恢復結果',
    uncertain: '結果未能確定。請重新執行預覽並檢查選定聯絡人，然後才考慮下一步；不會自動重試。',
    refreshFailed: '恢復結果已收到，但重新預覽失敗。請手動執行預覽。',
    outcome: (s) => `${s.restored} 個已恢復 · ${s.alreadyActive} 個原已啟用 · ${s.blocked} 個受阻 · ${s.uncertain} 個結果未確定`,
  } : {
    title: 'Restore verified contacts',
    description: 'Restores the existing Contact ID only and preserves bills, payments and contact details. Document holds are not cleared automatically.',
    selected: (count) => `${count} selected for restoration (maximum 25)`,
    reviewed: 'I reviewed the selected contacts and restoration scope',
    select: 'Select for restoration', clear: 'Clear restoration selection',
    limit: 'Select at most 25 contacts per restoration.',
    readOnly: 'Contact writes are disabled; restoration is read-only.',
    completed: 'Contact restoration outcomes verified',
    verify: 'Verify Contact restoration outcomes',
    uncertain: 'The outcome is uncertain. Run Preview again and inspect the selected contacts before considering another action. No automatic retry will run.',
    refreshFailed: 'Restoration outcomes were received, but refreshing the preview failed. Run Preview manually.',
    outcome: (s) => `${s.restored} restored · ${s.alreadyActive} already active · ${s.blocked} blocked · ${s.uncertain} uncertain`,
  };
}
