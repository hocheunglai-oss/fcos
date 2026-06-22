import { useState } from 'react';
import { format, isValid, parse } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const ISO_FORMAT = 'yyyy-MM-dd';
const DISPLAY_FORMAT = 'dd/MM/yyyy';

function toDate(value) {
  if (!value) return undefined;
  const parsed = parse(String(value).slice(0, 10), ISO_FORMAT, new Date());
  return isValid(parsed) ? parsed : undefined;
}

export default function BrokerDatePicker({ value, onChange, placeholder, ...props }) {
  const [open, setOpen] = useState(false);
  const selectedDate = toDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            {...props}
            readOnly
            value={selectedDate ? format(selectedDate, DISPLAY_FORMAT) : ''}
            placeholder={placeholder}
            className="cursor-pointer pr-9"
          />
          <CalendarIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate}
          onSelect={date => {
            if (!date) return;
            onChange(format(date, ISO_FORMAT));
            setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}