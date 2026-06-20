import { useEffect, useState } from 'react';
import { format, isValid, parse } from 'date-fns';
import { Input } from '@/components/ui/input';

const DISPLAY_FORMAT = 'dd MMM yyyy';
const ISO_FORMAT = 'yyyy-MM-dd';

function parseDateText(text) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const parsedDisplay = parse(trimmed, DISPLAY_FORMAT, new Date());
  if (isValid(parsedDisplay)) return format(parsedDisplay, ISO_FORMAT);
  const parsedIso = parse(trimmed, ISO_FORMAT, new Date());
  if (isValid(parsedIso)) return format(parsedIso, ISO_FORMAT);
  return null;
}

function formatDateText(value) {
  if (!value) return '';
  const parsed = parse(String(value).slice(0, 10), ISO_FORMAT, new Date());
  return isValid(parsed) ? format(parsed, DISPLAY_FORMAT) : String(value);
}

export default function DateInput({ value, onChange, placeholder = '07 Jun 2026', className = '', ...props }) {
  const [text, setText] = useState(formatDateText(value));

  useEffect(() => {
    setText(formatDateText(value));
  }, [value]);

  const commit = () => {
    const parsed = parseDateText(text);
    if (parsed === '') {
      onChange('');
      return;
    }
    if (parsed) {
      onChange(parsed);
      setText(formatDateText(parsed));
    }
  };

  return (
    <Input
      {...props}
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={e => {
        setText(e.target.value);
        if (!e.target.value) onChange('');
      }}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={className}
    />
  );
}