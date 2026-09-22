import { useEffect, useState } from 'react';
import { formatXeroAllowanceCountdown, formatXeroAllowanceDate } from '@/lib/xeroDailyAllowance';

const COPY = {
  en: ['Daily allowance', 'Calls remaining', 'Daily reset (Hong Kong time)', 'Not supplied by Xero', 'Resets in',
    'Reset time passed; confirm with the next check.'],
  zh: ['每日限額', '剩餘呼叫次數', '每日重設（香港時間）', 'Xero 未有提供', '距離重設尚餘',
    '重設時間已過；請於下次檢查時確認。'],
};

export default function XeroDailyAllowance({ snapshot, language = 'en' }) {
  const chinese = language === 'zh-Hant' || language === 'zh-HK';
  const copy = COPY[chinese ? 'zh' : 'en'];
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const resetAt = Date.parse(snapshot?.dayResetAt);
    let timer;
    const refresh = () => {
      const next = Date.now();
      setNow(next);
      if (timer && resetAt <= next) { clearInterval(timer); timer = null; }
    };
    refresh();
    if (resetAt > Date.now()) timer = setInterval(refresh, 1000);
    return () => { if (timer) clearInterval(timer); };
  }, [snapshot?.dayResetAt]);
  const resetDate = formatXeroAllowanceDate(snapshot?.dayResetAt, language);
  const countdown = resetDate ? formatXeroAllowanceCountdown(snapshot.dayResetAt, now, chinese ? 'zh' : 'en') : null;
  const remaining = snapshot?.dayRemaining == null ? copy[3] : Number(snapshot.dayRemaining).toLocaleString(chinese ? 'zh-HK' : 'en-HK');
  return (
    <aside aria-label={copy[0]} className="rounded-lg border border-sky-200 bg-white/90 p-3 text-sm">
      <div className="font-semibold">{copy[0]}</div>
      <dl className="mt-2 grid grid-cols-2 gap-1">
        <dt className="text-muted-foreground">{copy[1]}</dt><dd className="text-right font-semibold tabular-nums">{remaining}</dd>
        <dt className="text-muted-foreground">{copy[2]}</dt><dd className="text-right font-medium">{resetDate || copy[3]}</dd>
      </dl>
      {resetDate && <p className="mt-1.5 text-xs text-sky-800">{countdown ? `${copy[4]} ${countdown}` : copy[5]}</p>}
    </aside>
  );
}
