import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const TYPES = ['Supplier Broker', 'Buyer Broker', 'Secondary Buyer Broker'];

export default function BrokerFilters({ search, setSearch, selectedTypes, setSelectedTypes, fromDate, setFromDate, toDate, setToDate }) {
  const toggleType = (type) => {
    setSelectedTypes(selectedTypes.includes(type)
      ? selectedTypes.filter(item => item !== type)
      : [...selectedTypes, type]);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <Input placeholder="Search stem or broker…" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        {TYPES.map(type => (
          <Button key={type} type="button" size="sm" variant={selectedTypes.includes(type) ? 'default' : 'outline'} onClick={() => toggleType(type)}>
            {type}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
      </div>
    </div>
  );
}