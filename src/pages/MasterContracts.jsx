import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  ChevronRight,
  ExternalLink,
  FileSignature,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { createLatestRequestGate } from "@/lib/latestRequest";
import PageHeader from "@/components/common/PageHeader";
import PageMethodology from "@/components/common/PageMethodology";
import StateBlock from "@/components/common/StateBlock";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MASTER_CONTRACTS_METHODOLOGY } from "@/lib/pageMethodologies";
import {
  MASTER_CONTRACT_BENCHMARKS,
  applyMasterContractPaymentTerms,
  applyMasterContractPortAssignment,
  applyMasterContractPortLocation,
  masterContractBenchmark,
  masterContractLineKey,
  masterContractPaymentTerms,
  masterContractPortAssignment,
  masterContractPortSettings,
  masterContractPricingPosition,
} from "@/lib/masterContracts";

const SALESFORCE_ORIGIN = "https://fratellicosulich.lightning.force.com";
const DEFAULT_SNAPSHOT = Object.freeze({
  ownerUserId: "",
  parties: {
    buyer: { accountId: "", name: "", clKey: "", pic: "", paymentTerm: "" },
    supplier: { accountId: "", name: "", clKey: "", confirmed: false, paymentTerm: "" },
  },
  terms: {
    don: { minDays: "", maxDays: "" },
    portAssignment: { mode: "one_port", portId: "", portName: "" },
    portSettings: [],
    variableCharges: { mode: "", supplierIds: [] },
  },
  products: [],
  deliveries: [],
  chargeRules: [],
});
const MOPS_BENCHMARK_OPTIONS = Object.values(MASTER_CONTRACT_BENCHMARKS).map(
  (benchmark) => ({ id: benchmark.key, name: benchmark.name }),
);
const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Hong_Kong",
});

function operationId(prefix) {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function internalProductKey() {
  const suffix =
    globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 16) ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `product_${suffix}`.slice(0, 40).toLowerCase();
}

function deliveryPricingDate(delivery, side) {
  return delivery?.[`${side}PricingDate`] || delivery?.donDate || "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeOptionRows(current = [], incoming = []) {
  const rows = new Map(current.map((row) => [row.id, row]));
  for (const row of incoming || []) rows.set(row.id, row);
  return [...rows.values()];
}

function displayDate(value) {
  if (!value) return "Not set";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function quantity(value) {
  return Number.isFinite(Number(value))
    ? `${formatter.format(Number(value))} MT`
    : "—";
}

function range(min, max) {
  if (min == null || max == null) return "—";
  return Number(min) === Number(max)
    ? quantity(min)
    : `${formatter.format(Number(min))}–${formatter.format(Number(max))} MT`;
}

function statusTone(status) {
  if (["active", "approved", "applied", "succeeded"].includes(status))
    return "bg-emerald-100 text-emerald-800";
  if (
    [
      "pending_supplier",
      "pending_owner",
      "reviewed",
      "queued",
      "running",
    ].includes(status)
  )
    return "bg-amber-100 text-amber-900";
  if (["failed", "uncertain", "conflict", "rejected"].includes(status))
    return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-700";
}

function setPath(source, path, value) {
  const next = clone(source);
  let cursor = next;
  for (let index = 0; index < path.length - 1; index += 1)
    cursor = cursor[path[index]];
  cursor[path[path.length - 1]] = value;
  return next;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  min,
  step,
  placeholder,
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value ?? ""}
      min={min}
      step={step}
      placeholder={placeholder}
      onInput={
        type === "date"
          ? (event) => onChange(event.currentTarget.value)
          : undefined
      }
      onChange={(event) => onChange(event.target.value)}
    />
    </div>
  );
}

function StaticSelect({
  label,
  value,
  options,
  onChange,
  renderLabel = (row) => row.name,
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Select value={String(value ?? "")} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((row) => (
            <SelectItem key={row.id} value={row.id}>
              {renderLabel(row)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SearchableEntitySelect({
  label,
  value,
  options,
  onChange,
  onSearch,
  searchScope,
  searchRole,
  placeholder = `Select ${label.toLowerCase()}`,
  searchPlaceholder = `Search ${label.toLowerCase()} by keyword`,
  emptyLabel = "No matching result.",
  renderLabel = (row) => row.name,
  selectedFallback = "",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const selected = options.find((row) => row.id === value);
  const needle = query.trim().toLocaleLowerCase();
  const visibleOptions = options.filter(
    (row) =>
      !needle ||
      row.id === value ||
      [row.name, row.clKey, row.code, row.imo, row.country, row.email, row.family, row.roleLabel]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle),
  );

  useEffect(() => {
    if (!open || !onSearch) return undefined;
    let active = true;
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      try {
        await onSearch({
          query: query.trim(),
          scope: searchScope,
          role: searchRole,
        });
      } finally {
        if (active) setSearching(false);
      }
    }, query ? 220 : 0);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [onSearch, open, query, searchRole, searchScope]);

  const selectedText = selected
    ? renderLabel(selected)
    : selectedFallback || placeholder;

  return (
    <div className="grid min-w-0 gap-1.5">
      <Label>{label}</Label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-auto min-h-10 w-full justify-between px-3 py-2 font-normal"
            title={selectedText}
          >
            <span
              className={`line-clamp-2 min-w-0 break-words text-left ${!selected && !selectedFallback ? "text-muted-foreground" : ""}`}
            >
              {selectedText}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(420px,calc(100vw-32px))] p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={searchPlaceholder}
            />
            <CommandList>
              <CommandEmpty>
                {searching ? "Searching…" : emptyLabel}
              </CommandEmpty>
              <CommandGroup>
                {visibleOptions.map((row) => (
                  <CommandItem
                    key={row.id}
                    value={row.id}
                    onSelect={() => {
                      onChange(row.id);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <Check
                      className={`h-4 w-4 ${row.id === value ? "opacity-100" : "opacity-0"}`}
                    />
                    <span className="min-w-0 break-words">{renderLabel(row)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SupplierChecklist({
  label,
  value = [],
  accounts,
  onChange,
  onSearch,
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!onSearch) return undefined;
    const timeout = window.setTimeout(
      () => onSearch({ query: query.trim(), scope: "accounts", role: "supplier" }),
      query ? 220 : 0,
    );
    return () => window.clearTimeout(timeout);
  }, [onSearch, query]);
  const suppliers = accounts.filter((row) => row.role.includes("supplier"));
  const visibleSuppliers = suppliers.filter((row) => {
    const needle = query.trim().toLocaleLowerCase();
    return (
      !needle ||
      `${row.name} ${row.clKey || ""}`.toLocaleLowerCase().includes(needle) ||
      value.includes(row.id)
    );
  });
  const selected = new Set(value);
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-9"
          placeholder="Search Supplier Account or CL Key"
        />
      </div>
      <div className="grid max-h-36 gap-1 overflow-y-auto rounded-lg border bg-background p-2 md:grid-cols-2">
        {visibleSuppliers.length ? (
          visibleSuppliers.map((supplier) => (
            <label
              key={supplier.id}
              className="flex items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
            >
              <Checkbox
                checked={selected.has(supplier.id)}
                onCheckedChange={(checked) => {
                  const next = new Set(selected);
                  if (checked === true) next.add(supplier.id);
                  else next.delete(supplier.id);
                  onChange([...next]);
                }}
              />
              <span>
                <span className="font-medium">{supplier.name}</span>
                {supplier.clKey ? (
                  <span className="ml-1 font-data text-xs text-muted-foreground">
                    {supplier.clKey}
                  </span>
                ) : null}
                {supplier.isAgent ? (
                  <span className="ml-1 text-xs text-amber-700">
                    Is Agent · always required
                  </span>
                ) : null}
              </span>
            </label>
          ))
        ) : (
          <span className="p-2 text-xs text-muted-foreground">
            Search for the exact Supplier Account above.
          </span>
        )}
      </div>
    </div>
  );
}

function ContractEditor({
  open,
  onOpenChange,
  detail,
  options,
  onOptionsQuery,
  onCreateVessel,
  onSave,
  busy,
}) {
  const existing = detail?.contract;
  const [contractKey, setContractKey] = useState("");
  const [title, setTitle] = useState("");
  const [snapshot, setSnapshot] = useState(clone(DEFAULT_SNAPSHOT));

  useEffect(() => {
    if (!open) return;
    setContractKey(existing?.contractKey || "");
    setTitle(existing?.title || "");
    const next = clone(existing?.snapshot || DEFAULT_SNAPSHOT);
    const withTerms = applyMasterContractPaymentTerms(next, masterContractPaymentTerms(next));
    setSnapshot(applyMasterContractPortAssignment(withTerms, masterContractPortAssignment(withTerms)));
  }, [existing, open]);

  const portAssignment = masterContractPortAssignment(snapshot);
  const portSettings = masterContractPortSettings(snapshot);
  const updatePortAssignment = (assignment) => {
    setSnapshot((current) => applyMasterContractPortAssignment(current, assignment));
  };

  const chooseAccount = (side, accountId) => {
    const account = options.accounts.find((row) => row.id === accountId);
    if (!account) return;
    setSnapshot((current) => {
      const next = setPath(current, ["parties", side], {
        ...current.parties[side],
        accountId: account.id,
        name: account.name,
        clKey: account.clKey || "",
        paymentTerm:
          side === "buyer"
            ? account.buyerPaymentTerm || ""
            : account.supplierPaymentTerm || "",
        ...(side === "supplier" ? { confirmed: false } : {}),
      });
      const terms = masterContractPaymentTerms(next);
      return applyMasterContractPaymentTerms(next, {
        ...terms,
        ...(side === "buyer"
          ? { buyerPaymentTerm: account.buyerPaymentTerm || "" }
          : { supplierPaymentTerm: account.supplierPaymentTerm || "" }),
      });
    });
  };
  const updateProduct = (index, patch) =>
    setSnapshot((current) => ({
      ...current,
      products: current.products.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    }));
  const updateDelivery = (index, patch) =>
    setSnapshot((current) => ({
      ...current,
      deliveries: current.deliveries.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              ...patch,
              ...(Object.prototype.hasOwnProperty.call(patch, "deliveryKey")
                ? {
                    products: (row.products || []).map((product) => ({
                      ...product,
                      contractLineKey: masterContractLineKey(
                        contractKey,
                        patch.deliveryKey,
                        product.productKey,
                      ),
                    })),
                  }
                : {}),
            }
          : row,
      ),
    }));
  const updateAllocation = (deliveryIndex, allocationIndex, patch) =>
    setSnapshot((current) => ({
      ...current,
      deliveries: current.deliveries.map((delivery, rowIndex) =>
        rowIndex === deliveryIndex
          ? {
              ...delivery,
              products: (delivery.products || []).map((row, productIndex) =>
                productIndex === allocationIndex ? { ...row, ...patch } : row,
              ),
            }
          : delivery,
      ),
    }));
  const addProduct = () =>
    setSnapshot((current) => ({
      ...current,
      products: [
        ...current.products,
        {
          productKey: internalProductKey(),
          productName: "",
          salesforceProductId: "",
          benchmarkKey: "",
          benchmarkName: "",
          benchmarkCode: "",
          benchmarkUnit: "USD/MT",
          conversionFactor: 1,
          buyPremium: 0,
          sellPremium: 0,
          contractedMinQty: 0,
          contractedMaxQty: 0,
          uom: "MT",
          sortOrder: current.products.length,
        },
      ],
    }));
  const addDelivery = () =>
    setSnapshot((current) => ({
      ...current,
      deliveries: [
        ...current.deliveries,
        {
          deliveryKey: "",
          sequence: current.deliveries.length + 1,
          vesselName: "",
          vesselImo: "",
          vesselId: "",
          portId: masterContractPortAssignment(current).portId || "",
          portName: masterContractPortAssignment(current).portName || "",
          preliminaryEta: "",
          supplyLocation: "TBD",
          buyerPaymentTerm: current.parties.buyer.paymentTerm || "",
          supplierPaymentTerm: current.parties.supplier.paymentTerm || "",
          donDate: "",
          supplierPricingDate: "",
          buyerPricingDate: "",
          variableChargeSupplierIds: [],
          products: current.products.map((product) => ({
            productKey: product.productKey,
            contractLineKey: "",
            quantityMin: 0,
            quantityMax: 0,
          })),
        },
      ],
    }));
  const addCharge = () =>
    setSnapshot((current) => ({
      ...current,
      chargeRules: [
        ...current.chargeRules,
        {
          chargeKey: `charge_${current.chargeRules.length + 1}`,
          chargeName: "",
          salesforceProductId: "",
          supplierAccountId: "",
          supplierName: "",
          appliesWhen: "every_delivery",
          fixedCost: 0,
          fixedSell: 0,
          currency: "USD",
        },
      ],
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[94vh] w-[96vw] max-w-[1600px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
          <DialogTitle>
            {existing
              ? "Amend Master Contract baseline"
              : "New Master Contract draft"}
          </DialogTitle>
          <DialogDescription>
            Saving creates an immutable draft revision. Approval and Salesforce
            synchronization are separate actions.
          </DialogDescription>
        </DialogHeader>
        <div className="grid flex-1 gap-5 overflow-y-auto px-6 py-5">
          <section className="grid gap-3 rounded-xl border p-4">
            <h3 className="font-semibold">Contract and parties</h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>Master Contract key</Label>
                <div className="min-h-10 rounded-md border bg-muted/40 px-3 py-2 font-data text-sm">
                  {contractKey || "Assigned automatically when saved"}
                </div>
              </div>
              <Field label="Title" value={title} onChange={setTitle} />
              <SearchableEntitySelect
                label="Contract owner"
                value={snapshot.ownerUserId}
                options={options.owners}
                onSearch={onOptionsQuery}
                searchScope="owners"
                onChange={(value) =>
                  setSnapshot((current) => ({ ...current, ownerUserId: value }))
                }
              />
              <SearchableEntitySelect
                label="Buyer"
                value={snapshot.parties.buyer.accountId}
                options={options.accounts.filter((row) =>
                  row.role.includes("buyer"),
                )}
                onSearch={onOptionsQuery}
                searchScope="accounts"
                searchRole="buyer"
                onChange={(value) => chooseAccount("buyer", value)}
                selectedFallback={`${snapshot.parties.buyer.name || ""}${snapshot.parties.buyer.clKey ? ` · ${snapshot.parties.buyer.clKey}` : ""}`}
                renderLabel={(row) =>
                  `${row.name}${row.clKey ? ` · ${row.clKey}` : ""} · ${row.roleLabel}`
                }
              />
              <SearchableEntitySelect
                label="Supplier"
                value={snapshot.parties.supplier.accountId}
                options={options.accounts.filter((row) =>
                  row.role.includes("supplier"),
                )}
                onSearch={onOptionsQuery}
                searchScope="accounts"
                searchRole="supplier"
                onChange={(value) => chooseAccount("supplier", value)}
                selectedFallback={`${snapshot.parties.supplier.name || ""}${snapshot.parties.supplier.clKey ? ` · ${snapshot.parties.supplier.clKey}` : ""}`}
                renderLabel={(row) =>
                  `${row.name}${row.clKey ? ` · ${row.clKey}` : ""} · ${row.roleLabel}`
                }
              />
              <Field
                label="Buyer PIC"
                value={snapshot.parties.buyer.pic}
                onChange={(value) =>
                  setSnapshot((current) =>
                    setPath(current, ["parties", "buyer", "pic"], value),
                  )
                }
              />
              <Field
                label="Buyer payment term"
                value={snapshot.parties.buyer.paymentTerm}
                onChange={(value) =>
                  setSnapshot((current) =>
                    applyMasterContractPaymentTerms(current, {
                      ...masterContractPaymentTerms(current),
                      buyerPaymentTerm: value,
                    }),
                  )
                }
              />
              <Field
                label="Supplier payment term"
                value={snapshot.parties.supplier.paymentTerm}
                onChange={(value) =>
                  setSnapshot((current) =>
                    applyMasterContractPaymentTerms(current, {
                      ...masterContractPaymentTerms(current),
                      supplierPaymentTerm: value,
                    }),
                  )
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={snapshot.parties.supplier.confirmed === true}
                onCheckedChange={(value) =>
                  setSnapshot((current) =>
                    setPath(
                      current,
                      ["parties", "supplier", "confirmed"],
                      value === true,
                    ),
                  )
                }
              />
              Exact supplier identity confirmed
            </label>
          </section>
          <section className="grid gap-3 rounded-xl border p-4">
            <h3 className="font-semibold">Pricing and review rules</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <Field
                label="DON minimum days before ETA"
                type="number"
                min="0"
                value={snapshot.terms.don.minDays}
                onChange={(value) =>
                  setSnapshot((current) =>
                    setPath(current, ["terms", "don", "minDays"], value),
                  )
                }
              />
              <Field
                label="DON maximum days before ETA"
                type="number"
                min="0"
                value={snapshot.terms.don.maxDays}
                onChange={(value) =>
                  setSnapshot((current) =>
                    setPath(current, ["terms", "don", "maxDays"], value),
                  )
                }
              />
              <StaticSelect
                label="Variable Charges mode"
                value={snapshot.terms.variableCharges.mode}
                options={[
                  { id: "contract", name: "Contract-wide suppliers" },
                  { id: "per_delivery", name: "Per delivery" },
                ]}
                onChange={(value) =>
                  setSnapshot((current) =>
                    setPath(
                      current,
                      ["terms", "variableCharges", "mode"],
                      value,
                    ),
                  )
                }
              />
            </div>
            {snapshot.terms.variableCharges.mode === "contract" ? (
              <SupplierChecklist
                label="Suppliers requiring manual Variable Charges review for every delivery"
                value={snapshot.terms.variableCharges.supplierIds}
                accounts={options.accounts}
                onSearch={onOptionsQuery}
                onChange={(value) =>
                  setSnapshot((current) =>
                    setPath(
                      current,
                      ["terms", "variableCharges", "supplierIds"],
                      value,
                    ),
                  )
                }
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Per-delivery selections appear within each delivery below. Is
                Agent remains authoritative even when not manually selected.
              </p>
            )}
          </section>
          <section className="grid gap-3 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                Products and totals
              </h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addProduct}
              >
                <Plus className="mr-1 h-4 w-4" />
                Product
              </Button>
            </div>
            {snapshot.products.map((product, index) => (
              <div
                key={`${product.productKey}-${index}`}
                className="grid gap-3 rounded-lg bg-muted/40 p-3 md:grid-cols-2 xl:grid-cols-3"
              >
                <SearchableEntitySelect
                  label="Salesforce Product"
                  value={product.salesforceProductId}
                  options={options.products}
                  onSearch={onOptionsQuery}
                  searchScope="products"
                  selectedFallback={product.productName || `Product ${index + 1}`}
                  onChange={(value) => {
                    const row = options.products.find(
                      (item) => item.id === value,
                    );
                    updateProduct(index, {
                      salesforceProductId: value,
                      productName: row?.name || product.productName,
                    });
                  }}
                  renderLabel={(row) =>
                    `${row.name}${row.code ? ` (${row.code})` : ""}`
                  }
                />
                <StaticSelect
                  label="MOPS benchmark"
                  value={masterContractBenchmark(product)?.key || ""}
                  options={MOPS_BENCHMARK_OPTIONS}
                  onChange={(value) => {
                    const benchmark = MASTER_CONTRACT_BENCHMARKS[value];
                    updateProduct(index, {
                      benchmarkKey: benchmark.key,
                      benchmarkName: benchmark.name,
                      benchmarkCode: benchmark.code,
                      benchmarkUnit: benchmark.unit,
                      conversionFactor: benchmark.conversionFactor,
                    });
                  }}
                />
                <div className="grid content-center gap-1 rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground">
                  <span>Native unit: {masterContractBenchmark(product)?.unit || "Select benchmark"}</span>
                  {masterContractBenchmark(product)?.key === "sgo" ? (
                    <span>Converted at 7.45 bbl/MT for the pricing formula.</span>
                  ) : null}
                </div>
                <Field
                  label="Buy premium"
                  type="number"
                  step="0.01"
                  value={product.buyPremium}
                  onChange={(value) =>
                    updateProduct(index, { buyPremium: value })
                  }
                />
                <Field
                  label="Sell premium"
                  type="number"
                  step="0.01"
                  value={product.sellPremium}
                  onChange={(value) =>
                    updateProduct(index, { sellPremium: value })
                  }
                />
                <Field
                  label="Total Quantity Min"
                  type="number"
                  step="0.001"
                  value={product.contractedMinQty}
                  onChange={(value) =>
                    updateProduct(index, { contractedMinQty: value })
                  }
                />
                <Field
                  label="Total Quantity Max"
                  type="number"
                  step="0.001"
                  value={product.contractedMaxQty}
                  onChange={(value) =>
                    updateProduct(index, { contractedMaxQty: value })
                  }
                />
                <div className="flex items-end">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove product"
                    onClick={() =>
                      setSnapshot((current) => ({
                        ...current,
                        products: current.products.filter(
                          (_, rowIndex) => rowIndex !== index,
                        ),
                      }))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </section>
          <section className="grid gap-3 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Deliveries and ports</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addDelivery}
              >
                <Plus className="mr-1 h-4 w-4" />
                Delivery
              </Button>
            </div>
            <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-2">
              <StaticSelect
                label="Ports"
                value={portAssignment.mode}
                options={[
                  { id: "one_port", name: "One port for all deliveries" },
                  { id: "per_delivery", name: "Different port by delivery" },
                ]}
                onChange={(mode) => updatePortAssignment({ mode })}
              />
              {portAssignment.mode === "one_port" ? (
                <SearchableEntitySelect
                  label="Port for all deliveries"
                  value={portAssignment.portId}
                  options={options.ports}
                  onSearch={onOptionsQuery}
                  searchScope="ports"
                  selectedFallback={portAssignment.portName || ""}
                  onChange={(value) => {
                    const row = options.ports.find((item) => item.id === value);
                    updatePortAssignment({
                      mode: "one_port",
                      portId: value,
                      portName: row?.name || "",
                    });
                  }}
                />
              ) : (
                <div className="flex items-end pb-2 text-xs text-muted-foreground">
                  Choose the exact port within each delivery.
                </div>
              )}
            </div>
            {portSettings.length ? (
              <div className="grid gap-2 rounded-lg border bg-background p-3">
                <div className="text-sm font-medium">One supply location per port</div>
                <div className="grid gap-2 lg:grid-cols-2">
                  {portSettings.map((setting) => (
                    <div key={setting.portId} className="grid gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-medium">{setting.portName || "Selected port"}</div>
                        {setting.conflicting ? <div className="text-xs text-amber-700">Existing deliveries use different locations. Choose the contract location.</div> : null}
                      </div>
                      <StaticSelect
                        label="Supply location"
                        value={setting.supplyLocation}
                        options={["TBD", "Berth", "Anchorage"].map((id) => ({ id, name: id }))}
                        onChange={(supplyLocation) =>
                          setSnapshot((current) => applyMasterContractPortLocation(current, { ...setting, supplyLocation }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {snapshot.deliveries.map((delivery, index) => (
              <div
                key={delivery.id || delivery.deliveryKey || `new-delivery-${index}`}
                className="grid gap-3 rounded-lg border bg-card p-3"
              >
                <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  <div className="grid gap-1.5">
                    <Label>Delivery key</Label>
                    <div className="min-h-10 rounded-md border bg-muted/40 px-3 py-2 font-data text-sm">
                      {delivery.deliveryKey || "Assigned automatically when saved"}
                    </div>
                  </div>
                  <SearchableEntitySelect
                    label="Vessel"
                    value={delivery.vesselId}
                    options={options.vessels}
                    onSearch={onOptionsQuery}
                    searchScope="vessels"
                    selectedFallback={`${delivery.vesselName || ""}${delivery.vesselImo ? ` · ${delivery.vesselImo}` : ""}`}
                    onChange={(value) => {
                      const row = options.vessels.find(
                        (item) => item.id === value,
                      );
                      updateDelivery(index, {
                        vesselId: value,
                        vesselName: row?.name || "",
                        vesselImo: row?.imo || "",
                        vesselNrt: row?.nrt ?? "",
                      });
                    }}
                    renderLabel={(row) =>
                      `${row.name}${row.imo ? ` · ${row.imo}` : ""}`
                    }
                  />
                  {!delivery.vesselId ? (
                    <div className="grid gap-2 rounded-lg border border-dashed p-2 md:col-span-3 md:grid-cols-[1fr_160px_150px_auto]">
                      <Field
                        label="Vessel name"
                        value={delivery.vesselName}
                        onChange={(value) =>
                          updateDelivery(index, { vesselName: value })
                        }
                      />
                      <Field
                        label="IMO (optional in draft)"
                        value={delivery.vesselImo}
                        onChange={(value) =>
                          updateDelivery(index, { vesselImo: value })
                        }
                      />
                      <Field
                        label="NRT (optional)"
                        type="number"
                        min="1"
                        step="1"
                        value={delivery.vesselNrt || ""}
                        onChange={(value) =>
                          updateDelivery(index, { vesselNrt: value })
                        }
                      />
                      {existing ? (
                        <div className="flex items-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              busy ||
                              !delivery.vesselName?.trim() ||
                              !delivery.vesselImo?.trim()
                            }
                            onClick={async () => {
                              const created = await onCreateVessel({
                                name: delivery.vesselName,
                                imo: delivery.vesselImo,
                                nrt: delivery.vesselNrt,
                              });
                              if (created)
                                updateDelivery(index, {
                                  vesselId: created.id,
                                  vesselName: created.name,
                                  vesselImo: created.imo,
                                  vesselNrt: created.nrt ?? "",
                                });
                            }}
                          >
                            Create after duplicate check
                          </Button>
                        </div>
                      ) : (
                        <p className="self-end pb-2 text-xs text-muted-foreground">
                          Save the draft first, then create or link the exact Salesforce vessel after duplicate checking.
                        </p>
                      )}
                    </div>
                  ) : null}
                  {portAssignment.mode === "per_delivery" ? (
                    <SearchableEntitySelect
                      label="Port"
                      value={delivery.portId}
                      options={options.ports}
                      onSearch={onOptionsQuery}
                      searchScope="ports"
                      selectedFallback={delivery.portName || ""}
                      onChange={(value) => {
                        const row = options.ports.find(
                          (item) => item.id === value,
                        );
                        updateDelivery(index, {
                          portId: value,
                          portName: row?.name || "",
                        });
                      }}
                    />
                  ) : null}
                  <Field
                    label="Preliminary ETA"
                    type="date"
                    value={delivery.preliminaryEta}
                    onChange={(value) =>
                      updateDelivery(index, { preliminaryEta: value })
                    }
                  />
                  <Field
                    label="Supplier pricing date"
                    type="date"
                    value={deliveryPricingDate(delivery, "supplier")}
                    onChange={(value) =>
                      updateDelivery(index, {
                        supplierPricingDate: value,
                        donDate: value,
                      })
                    }
                  />
                  <Field
                    label="Buyer pricing date"
                    type="date"
                    value={deliveryPricingDate(delivery, "buyer")}
                    onChange={(value) =>
                      updateDelivery(index, { buyerPricingDate: value })
                    }
                  />
                  <Field
                    label="Pricing-date exception reason"
                    value={delivery.donAlternateReason}
                    placeholder="Required only when the agreed date is outside the DON window"
                    onChange={(value) =>
                      updateDelivery(index, { donAlternateReason: value })
                    }
                  />
                  {(() => {
                    const position = masterContractPricingPosition(
                      deliveryPricingDate(delivery, "supplier"),
                      deliveryPricingDate(delivery, "buyer"),
                    );
                    return (
                      <div className="grid content-center gap-1 rounded-lg border bg-background px-3 py-2 text-xs">
                        <span className="font-medium">{position.label}</span>
                        <span className="text-muted-foreground">
                          {position.days == null
                            ? "Select both pricing dates."
                            : position.days === 0
                              ? "Buyer and supplier use the same publication date."
                              : `${position.days} calendar day${position.days === 1 ? "" : "s"} of benchmark exposure.`}
                        </span>
                      </div>
                    );
                  })()}
                  <div className="flex items-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setSnapshot((current) => ({
                          ...current,
                          deliveries: current.deliveries.filter(
                            (_, rowIndex) => rowIndex !== index,
                          ),
                        }))
                      }
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                </div>
                {snapshot.terms.variableCharges.mode === "per_delivery" ? (
                  <SupplierChecklist
                    label="Suppliers requiring manual Variable Charges review for this delivery"
                    value={delivery.variableChargeSupplierIds}
                    accounts={options.accounts}
                    onSearch={onOptionsQuery}
                    onChange={(value) =>
                      updateDelivery(index, {
                        variableChargeSupplierIds: value,
                      })
                    }
                  />
                ) : null}
                <div className="grid gap-2 md:grid-cols-2">
                  {(delivery.products || []).map(
                    (allocation, allocationIndex) => (
                      <div
                        key={allocation.contractLineKey || allocationIndex}
                        className="grid grid-cols-[minmax(0,1fr)_110px_110px] gap-2 rounded bg-muted/50 p-2"
                      >
                        <div>
                          <div className="text-sm font-medium">
                            {snapshot.products.find(
                              (row) => row.productKey === allocation.productKey,
                            )?.productName || `Product ${allocationIndex + 1}`}
                          </div>
                          <div className="font-data text-xs text-muted-foreground">
                            {allocation.contractLineKey}
                          </div>
                        </div>
                        <Field
                          label="Min MT"
                          type="number"
                          step="0.001"
                          value={allocation.quantityMin}
                          onChange={(value) =>
                            updateAllocation(index, allocationIndex, {
                              quantityMin: value,
                            })
                          }
                        />
                        <Field
                          label="Max MT"
                          type="number"
                          step="0.001"
                          value={allocation.quantityMax}
                          onChange={(value) =>
                            updateAllocation(index, allocationIndex, {
                              quantityMax: value,
                            })
                          }
                        />
                      </div>
                    ),
                  )}
                </div>
              </div>
            ))}
          </section>
          <section className="grid gap-3 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Charges</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addCharge}
              >
                <Plus className="mr-1 h-4 w-4" />
                Charge
              </Button>
            </div>
            {snapshot.chargeRules.map((rule, index) => (
              <div
                key={`${rule.chargeKey}-${index}`}
                className="grid gap-3 rounded-lg bg-muted/40 p-3 lg:grid-cols-2 2xl:grid-cols-4"
              >
                <Field
                  label="Key"
                  value={rule.chargeKey}
                  onChange={(value) =>
                    setSnapshot((current) => ({
                      ...current,
                      chargeRules: current.chargeRules.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, chargeKey: value } : row,
                      ),
                    }))
                  }
                />
                <Field
                  label="Name"
                  value={rule.chargeName}
                  onChange={(value) =>
                    setSnapshot((current) => ({
                      ...current,
                      chargeRules: current.chargeRules.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, chargeName: value }
                          : row,
                      ),
                    }))
                  }
                />
                <SearchableEntitySelect
                  label="Supplier"
                  value={rule.supplierAccountId}
                  options={options.accounts.filter((row) =>
                    row.role.includes("supplier"),
                  )}
                  onSearch={onOptionsQuery}
                  searchScope="accounts"
                  searchRole="supplier"
                  selectedFallback={rule.supplierName || ""}
                  renderLabel={(row) =>
                    `${row.name}${row.clKey ? ` · ${row.clKey}` : ""} · ${row.roleLabel}`
                  }
                  onChange={(value) => {
                    const account = options.accounts.find(
                      (row) => row.id === value,
                    );
                    setSnapshot((current) => ({
                      ...current,
                      chargeRules: current.chargeRules.map((row, rowIndex) =>
                        rowIndex === index
                          ? {
                              ...row,
                              supplierAccountId: value,
                              supplierName: account?.name || "",
                            }
                          : row,
                      ),
                    }));
                  }}
                />
                <SearchableEntitySelect
                  label="Product"
                  value={rule.salesforceProductId}
                  options={options.products}
                  onSearch={onOptionsQuery}
                  searchScope="products"
                  selectedFallback={rule.productName || ""}
                  renderLabel={(row) =>
                    `${row.name}${row.code ? ` (${row.code})` : ""}`
                  }
                  onChange={(value) => {
                    const product = options.products.find((row) => row.id === value);
                    setSnapshot((current) => ({
                      ...current,
                      chargeRules: current.chargeRules.map((row, rowIndex) =>
                        rowIndex === index
                          ? {
                              ...row,
                              salesforceProductId: value,
                              productName: product?.name || row.productName || "",
                            }
                          : row,
                      ),
                    }));
                  }}
                />
                <StaticSelect
                  label="Applies"
                  value={rule.appliesWhen}
                  options={[
                    { id: "every_delivery", name: "Every delivery" },
                    { id: "berth", name: "Berth only" },
                    { id: "anchorage", name: "Anchorage only" },
                  ]}
                  onChange={(value) =>
                    setSnapshot((current) => ({
                      ...current,
                      chargeRules: current.chargeRules.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, appliesWhen: value }
                          : row,
                      ),
                    }))
                  }
                />
                <Field
                  label="Cost"
                  type="number"
                  step="0.01"
                  value={rule.fixedCost}
                  onChange={(value) =>
                    setSnapshot((current) => ({
                      ...current,
                      chargeRules: current.chargeRules.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, fixedCost: value } : row,
                      ),
                    }))
                  }
                />
                <Field
                  label="Sell"
                  type="number"
                  step="0.01"
                  value={rule.fixedSell}
                  onChange={(value) =>
                    setSnapshot((current) => ({
                      ...current,
                      chargeRules: current.chargeRules.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, fixedSell: value } : row,
                      ),
                    }))
                  }
                />
              </div>
            ))}
          </section>
        </div>
        <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !title}
            onClick={() => onSave({ contractKey, title, snapshot })}
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save draft revision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailOverview({ detail }) {
  const contract = detail.contract;
  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_1.9fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parties and controls</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Buyer</div>
            <div className="font-medium">
              {contract.buyer.name || "Not resolved"}
            </div>
            <div className="font-data text-xs text-muted-foreground">
              {contract.buyer.clKey}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Supplier</div>
            <div className="font-medium">
              {contract.supplier.name || "Not resolved"}
            </div>
            <div className="font-data text-xs text-muted-foreground">
              {contract.supplier.clKey}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">DON window</div>
            <div>
              {contract.snapshot.terms?.don?.minDays || "—"}–
              {contract.snapshot.terms?.don?.maxDays || "—"} days before
              nominated ETA
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Variable Charges
            </div>
            <div>
              {contract.snapshot.terms?.variableCharges?.mode === "contract"
                ? "Contract-wide suppliers"
                : contract.snapshot.terms?.variableCharges?.mode ===
                    "per_delivery"
                  ? "Per delivery"
                  : "Not configured"}
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Total quantity and allocation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Approved total</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead>Unallocated</TableHead>
                <TableHead>Remaining</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(detail.quantitySummary || []).map((row) => (
                <TableRow key={row.productKey}>
                  <TableCell className="font-medium">
                    {row.productName || "Unnamed product"}
                  </TableCell>
                  <TableCell>
                    {range(row.contractedMinQty, row.contractedMaxQty)}
                  </TableCell>
                  <TableCell>
                    {range(row.allocatedMinQty, row.allocatedMaxQty)}
                  </TableCell>
                  <TableCell>{quantity(row.deliveredQty)}</TableCell>
                  <TableCell
                    className={
                      row.overAllocated ? "font-semibold text-red-700" : ""
                    }
                  >
                    {range(row.unallocatedMinQty, row.unallocatedMaxQty)}
                  </TableCell>
                  <TableCell
                    className={
                      row.overDelivered ? "font-semibold text-red-700" : ""
                    }
                  >
                    {range(row.remainingMinQty, row.remainingMaxQty)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DeliveryTable({
  detail,
  selected,
  setSelected,
  onResolvePrice,
  onApplyPrice,
  busyKey,
}) {
  const links = detail.relations.links || [];
  const linksFor = (deliveryKey, type) =>
    links.filter(
      (row) =>
        row.delivery_id &&
        row.entity_type === type &&
        detail.contract.snapshot.deliveries.find(
          (item) => item.id === row.delivery_id,
        )?.deliveryKey === deliveryKey,
    );
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      detail.contract.snapshot.deliveries.length > 0 &&
                      selected.size ===
                        detail.contract.snapshot.deliveries.length
                    }
                    onCheckedChange={(value) =>
                      setSelected(
                        value === true
                          ? new Set(
                              detail.contract.snapshot.deliveries.map(
                                (row) => row.deliveryKey,
                              ),
                            )
                          : new Set(),
                      )
                    }
                  />
                </TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>ETA / location</TableHead>
                <TableHead>Allocation</TableHead>
                <TableHead>DON pricing</TableHead>
                <TableHead>Salesforce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.contract.snapshot.deliveries.map((delivery) => {
                const stem = linksFor(delivery.deliveryKey, "stem")[0];
                const enquiry = linksFor(
                  delivery.deliveryKey,
                  "opportunity",
                )[0];
                return (
                  <TableRow key={delivery.deliveryKey}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(delivery.deliveryKey)}
                        disabled={Boolean(stem)}
                        onCheckedChange={(value) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (value === true) next.add(delivery.deliveryKey);
                            else next.delete(delivery.deliveryKey);
                            return next;
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{delivery.vesselName}</div>
                      <div className="font-data text-xs text-muted-foreground">
                        IMO {delivery.vesselImo || "unresolved"} ·{" "}
                        {delivery.deliveryKey}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {delivery.portName || "Port unresolved"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{displayDate(delivery.preliminaryEta)}</div>
                      <div className="text-xs text-muted-foreground">
                        {delivery.supplyLocation || "TBD"} · Supplier{" "}
                        {displayDate(deliveryPricingDate(delivery, "supplier"))} · Buyer{" "}
                        {displayDate(deliveryPricingDate(delivery, "buyer"))}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {masterContractPricingPosition(
                          deliveryPricingDate(delivery, "supplier"),
                          deliveryPricingDate(delivery, "buyer"),
                        ).label}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-56">
                      {(delivery.products || []).map((product, productIndex) => (
                        <div
                          key={product.contractLineKey}
                          className="flex justify-between gap-3"
                        >
                          <span>
                            {detail.contract.snapshot.products.find(
                              (row) => row.productKey === product.productKey,
                            )?.productName || `Product ${productIndex + 1}`}
                          </span>
                          <span className="tabular-nums">
                            {range(product.quantityMin, product.quantityMax)}
                          </span>
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="min-w-64">
                      {(delivery.products || []).map((product) => (
                        <div
                          key={product.contractLineKey}
                          className="mb-2 flex items-center justify-between gap-2"
                        >
                          <Badge className={statusTone(product.priceStatus)}>
                            {product.priceStatus || "unresolved"}
                          </Badge>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!product.id || busyKey === product.id}
                              onClick={() => onResolvePrice(delivery, product)}
                            >
                              {busyKey === product.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                "Review"
                              )}
                            </Button>
                            {product.priceStatus === "reviewed" ? (
                              <Button
                                size="sm"
                                disabled={busyKey === product.id}
                                onClick={() => onApplyPrice(product)}
                              >
                                Apply
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </TableCell>
                    <TableCell>
                      {stem || enquiry ? (
                        <div className="flex flex-col gap-1">
                          {enquiry ? (
                            <a
                              className="inline-flex items-center gap-1 text-primary"
                              href={`${SALESFORCE_ORIGIN}/lightning/r/Opportunity/${enquiry.salesforce_id}/view`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Enquiry <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                          {stem ? (
                            <a
                              className="inline-flex items-center gap-1 text-primary"
                              href={`${SALESFORCE_ORIGIN}/lightning/r/STEM__c/${stem.salesforce_id}/view`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              STEM <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Not created
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MasterContracts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState(null);
  const [detail, setDetail] = useState(null);
  const [options, setOptions] = useState({
    accounts: [],
    products: [],
    ports: [],
    vessels: [],
    owners: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorNew, setEditorNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalNote, setApprovalNote] = useState("");
  const [featureOpen, setFeatureOpen] = useState(false);
  const [featureReason, setFeatureReason] = useState("");
  const [preflight, setPreflight] = useState(null);
  const selectedContractId = searchParams.get("contractId") || "";
  const listRequestGateRef = useRef(createLatestRequestGate());
  const detailRequestGateRef = useRef(createLatestRequestGate());
  const optionsRequestGateRef = useRef(createLatestRequestGate());
  const selectedContractIdRef = useRef(selectedContractId);
  selectedContractIdRef.current = selectedContractId;

  const invoke = useCallback(
    async (name, payload = {}, requestOptions = {}) => {
      const response = await appClient.functions.invoke(name, payload, {
        cache: false,
        ...requestOptions,
      });
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    },
    [],
  );

  const loadList = useCallback(
    async ({ force = false } = {}) => {
      const request = listRequestGateRef.current.begin("master-contract-list");
      const isActive = () => request.isCurrent();
      force ? setRefreshing(true) : setLoading(true);
      setError("");
      try {
        const result = await invoke(
          "masterContractsList",
          { force },
          { cache: !force, signal: request.signal },
        );
        if (!isActive()) return;
        setList(result);
        if (!selectedContractIdRef.current && result.contracts?.length) {
          selectedContractIdRef.current = result.contracts[0].id;
          detailRequestGateRef.current.invalidate();
          setSearchParams(
            { contractId: result.contracts[0].id },
            { replace: true },
          );
        }
      } catch (nextError) {
        if (!isActive()) return;
        setError(nextError.message);
      }
      if (isActive()) {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [invoke, selectedContractId, setSearchParams],
  );

  const loadDetail = useCallback(
    async ({ force = false } = {}) => {
      if (!selectedContractId) {
        detailRequestGateRef.current.invalidate();
        setDetail(null);
        return;
      }
      const contractId = selectedContractId;
      const request = detailRequestGateRef.current.begin(contractId);
      const isActive = () => request.isCurrent() && selectedContractIdRef.current === contractId;
      force ? setRefreshing(true) : setLoading(true);
      setError("");
      try {
        const result = await invoke("masterContractDetail", {
          contractId,
          includeLive: true,
          force,
        }, { signal: request.signal });
        if (!isActive()) return;
        setDetail(result);
        setPreflight(null);
        const created = new Set(
          (result.relations.links || [])
            .filter((row) => row.entity_type === "stem")
            .map((row) => row.delivery_id),
        );
        setSelected(
          new Set(
            result.contract.snapshot.deliveries
              .filter(
                (row) => !created.has(row.id) && row.status !== "cancelled",
              )
              .map((row) => row.deliveryKey),
          ),
        );
      } catch (nextError) {
        if (!isActive()) return;
        setError(nextError.message);
      }
      if (!isActive()) return;
      setLoading(false);
      setRefreshing(false);
    },
    [invoke, selectedContractId],
  );

  const loadOptions = useCallback(async () => {
    const request = optionsRequestGateRef.current.begin("master-contract-options");
    try {
      const result = await invoke(
          "masterContractOptions",
          { query: "" },
          { cache: true, cacheTtlMs: 60_000, signal: request.signal },
        );
      if (request.isCurrent()) setOptions(result);
    } catch (nextError) {
      if (request.isCurrent()) setError(nextError.message);
    }
  }, [invoke]);

  const queryOptions = useCallback(
    async ({ query = "", scope = "all", role = "" } = {}) => {
      const request = optionsRequestGateRef.current.begin("master-contract-options");
      try {
        const result = await invoke(
          "masterContractOptions",
          { query, scope, role },
          { cache: true, cacheTtlMs: 60_000, signal: request.signal },
        );
        if (!request.isCurrent()) return;
        setOptions((current) => ({
          accounts: mergeOptionRows(current.accounts, result.accounts),
          products: mergeOptionRows(current.products, result.products),
          ports: mergeOptionRows(current.ports, result.ports),
          vessels: mergeOptionRows(current.vessels, result.vessels),
          owners: mergeOptionRows(current.owners, result.owners),
        }));
      } catch (nextError) {
        if (request.isCurrent()) setError(nextError.message);
      }
    },
    [invoke],
  );

  const createVessel = async ({ name, imo, nrt }) => {
    if (!detail?.contract?.id) return null;
    setBusy(true);
    setError("");
    try {
      const created = await invoke("masterContractVesselCreate", {
        contractId: detail.contract.id,
        name,
        imo,
        nrt,
      });
      optionsRequestGateRef.current.invalidate();
      setOptions((current) => ({
        ...current,
        vessels: [...current.vessels.filter((row) => row.id !== created.id), created],
      }));
      setMessage("Vessel created after the exact name and IMO duplicate check.");
      return created;
    } catch (nextError) {
      setError(nextError.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadList();
    void loadOptions();
  }, [loadList, loadOptions]);
  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);
  useEffect(() => () => {
    listRequestGateRef.current.invalidate();
    detailRequestGateRef.current.invalidate();
    optionsRequestGateRef.current.invalidate();
  }, []);

  const refresh = async () => {
    await Promise.all([loadList({ force: true }), loadDetail({ force: true })]);
  };
  const selectContract = (contractId) => {
    selectedContractIdRef.current = contractId;
    detailRequestGateRef.current.invalidate();
    setSearchParams({ contractId });
  };
  const save = async ({ contractKey, title, snapshot }) => {
    const saveContractId = editorNew ? null : detail?.contract.id || null;
    setBusy(true);
    setError("");
    try {
      const result = await invoke("masterContractSave", {
        contractId: saveContractId,
        contractKey,
        title,
        expectedRevision: editorNew
          ? null
          : (detail?.contract.currentRevision ?? null),
        snapshot,
        idempotencyKey: operationId("master-contract-save"),
      });
      setEditorOpen(false);
      setMessage(
        "Draft revision saved. Supplier evidence and owner approval are required before Salesforce creation.",
      );
      const savedContractId = result.contractId || result.detail?.contract?.id || saveContractId;
      if (editorNew && savedContractId) {
        selectedContractIdRef.current = savedContractId;
        detailRequestGateRef.current.invalidate();
        setSearchParams({ contractId: savedContractId });
      }
      await loadList({ force: true });
      if (savedContractId && selectedContractIdRef.current === savedContractId && result.detail) {
        detailRequestGateRef.current.invalidate();
        setDetail(result.detail);
      }
    } catch (nextError) {
      setError(nextError.message);
    }
    setBusy(false);
  };

  const recordEvidence = async () => {
    if (!detail || approvalNote.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      const evidence = await invoke("masterContractEvidenceComplete", {
        contractId: detail.contract.id,
        expectedRevision: detail.contract.currentRevision,
        evidenceKind: "reference_note",
        referenceLabel: approvalNote.trim(),
        idempotencyKey: operationId("master-contract-evidence"),
      });
      await invoke("masterContractDecision", {
        contractId: detail.contract.id,
        expectedRevision: detail.contract.currentRevision,
        action: "approve_supplier",
        supplierEvidenceId: evidence.evidenceId,
        idempotencyKey: operationId("master-contract-supplier-approval"),
      });
      setApprovalOpen(false);
      setApprovalNote("");
      setMessage(
        "Supplier approval evidence recorded. The assigned contract owner can now approve the revision.",
      );
      await refresh();
    } catch (nextError) {
      setError(nextError.message);
    }
    setBusy(false);
  };

  const decide = async (action) => {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await invoke("masterContractDecision", {
        contractId: detail.contract.id,
        expectedRevision: detail.contract.currentRevision,
        action,
        reason: action === "reject" ? approvalNote : "",
        idempotencyKey: operationId(`master-contract-${action}`),
      });
      setMessage(
        action === "approve_owner"
          ? "Current revision approved."
          : action === "submit"
            ? "Revision submitted for supplier approval."
            : "Revision decision recorded.",
      );
      await refresh();
    } catch (nextError) {
      setError(nextError.message);
    }
    setBusy(false);
  };

  const createBatch = async () => {
    if (!detail || !selected.size) return;
    setBusy(true);
    setError("");
    try {
      const preflight = await invoke("masterContractPreflight", {
        contractId: detail.contract.id,
        deliveryKeys: [...selected],
      });
      if (!preflight.ready)
        throw new Error(preflight.blockers.map((row) => row.message).join(" "));
      await invoke("masterContractBatchCreate", {
        contractId: detail.contract.id,
        deliveryKeys: [...selected],
        idempotencyKey: operationId("master-contract-create"),
      });
      setMessage(
        `${selected.size} delivery record set${selected.size === 1 ? "" : "s"} created atomically in Salesforce.`,
      );
      await refresh();
    } catch (nextError) {
      setError(nextError.message);
    }
    setBusy(false);
  };

  const reviewPreflight = async () => {
    if (!detail || !selected.size) return;
    setBusy(true);
    setError("");
    try {
      const result = await invoke("masterContractPreflight", {
        contractId: detail.contract.id,
        deliveryKeys: [...selected],
      });
      setPreflight(result);
      if (result.ready)
        setMessage(
          "Preflight passed. The selected batch is ready for one atomic Salesforce transaction.",
        );
    } catch (nextError) {
      setError(nextError.message);
    }
    setBusy(false);
  };

  const saveFeature = async () => {
    if (!list?.setting?.canManage || featureReason.trim().length < 8) return;
    setBusy(true);
    setError("");
    try {
      await invoke("masterContractFeatureSave", {
        enabled: list.setting.featureEnabled !== true,
        expectedRevision: list.setting.revision,
        reason: featureReason.trim(),
        idempotencyKey: operationId("master-contract-feature"),
      });
      setFeatureOpen(false);
      setFeatureReason("");
      setMessage(
        list.setting.featureEnabled
          ? "Master Contract Salesforce creation disabled."
          : "Master Contract Salesforce creation enabled.",
      );
      await refresh();
    } catch (nextError) {
      setError(nextError.message);
    }
    setBusy(false);
  };

  const resolvePrice = async (delivery, product) => {
    setBusyKey(product.id);
    setError("");
    try {
      const preview = await invoke("masterContractPriceResolve", {
        contractId: detail.contract.id,
        deliveryProductId: product.id,
        expectedRevision: detail.contract.currentRevision,
        supplierPricingDate: deliveryPricingDate(delivery, "supplier"),
        buyerPricingDate: deliveryPricingDate(delivery, "buyer"),
        alternatePublicationReason: delivery.donAlternateReason || "",
        confirm: false,
      });
      const evidence = preview.evidence;
      const accepted = window.confirm(
        `${evidence.benchmarkName}\nSupplier ${evidence.supplierBenchmarkValue} on ${evidence.supplierPricingDate}\nBuyer ${evidence.buyerBenchmarkValue} on ${evidence.buyerPricingDate}\n${evidence.positionLabel}\nBuy ${evidence.buyUnrounded} → ${evidence.buyRounded}\nSell ${evidence.sellUnrounded} → ${evidence.sellRounded}\n\nConfirm this reviewed pricing evidence?`,
      );
      if (accepted) {
        await invoke("masterContractPriceResolve", {
          contractId: detail.contract.id,
          deliveryProductId: product.id,
          expectedRevision: detail.contract.currentRevision,
          supplierPricingDate: deliveryPricingDate(delivery, "supplier"),
          buyerPricingDate: deliveryPricingDate(delivery, "buyer"),
          alternatePublicationReason: delivery.donAlternateReason || "",
          confirm: true,
          idempotencyKey: operationId("master-contract-price-review"),
        });
        setMessage(
          "Buyer and supplier pricing evidence reviewed. Apply it to the exact Salesforce line when ready.",
        );
        await loadDetail({ force: true });
      }
    } catch (nextError) {
      setError(nextError.message);
    }
    setBusyKey("");
  };

  const applyPrice = async (product) => {
    setBusyKey(product.id);
    setError("");
    try {
      await invoke("masterContractPriceApply", {
        contractId: detail.contract.id,
        deliveryProductId: product.id,
        expectedRevision: detail.contract.currentRevision,
        idempotencyKey: operationId("master-contract-price-apply"),
      });
      setMessage("Reviewed buyer and supplier pricing applied to Salesforce.");
      await loadDetail({ force: true });
    } catch (nextError) {
      setError(nextError.message);
    }
    setBusyKey("");
  };

  const pendingRevision = detail?.relations.revisions?.[0];
  const canOwnerApprove =
    pendingRevision?.supplier_approved_at &&
    !pendingRevision?.owner_approved_at;
  const contractItems = list?.contracts || [];
  const activeTab = searchParams.get("tab") || "overview";
  const setTab = (tab) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <main className="workspace-page mx-auto max-w-[1600px] p-3 sm:p-6 lg:p-8">
      <PageHeader
        icon={FileSignature}
        title="Master Contracts"
        description="Approved commercial baselines with batch Enquiry/STEM creation and live Salesforce reconciliation."
        meta={
          detail ? (
            <span>
              Revision {detail.contract.currentRevision} · Salesforce{" "}
              {detail.live?.available === false
                ? "unavailable"
                : "checked live"}
            </span>
          ) : null
        }
        actions={
          <>
            <PageMethodology {...MASTER_CONTRACTS_METHODOLOGY} />
            {list?.setting?.canManage && list.setting.featureEnabled ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setFeatureOpen(true)}
              >
                Disable creation
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={refresh}
              disabled={refreshing}
            >
              <RefreshCw
                className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditorNew(true);
                setEditorOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New draft
            </Button>
          </>
        }
      />
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Master Contract action blocked</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert className="mb-4 border-emerald-200 bg-emerald-50 text-emerald-950">
          <Check className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      {list && !list.setting.featureEnabled ? (
        <Alert className="mb-4 border-amber-200 bg-amber-50 text-amber-950">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Feature safely disabled</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Drafts and approvals are available, but Salesforce batch creation
              stays fail-closed until an Administrator enables the verified
              module.
            </span>
            {list.setting.canManage ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setFeatureOpen(true)}
              >
                Enable after verification
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {loading && !list ? (
        <StateBlock
          loading
          title="Loading Master Contracts"
          description="Loading approved terms and live operational links."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-xl border bg-card p-2">
            <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Contracts
            </div>
            {contractItems.length ? (
              contractItems.map((contract) => (
                <button
                  type="button"
                  key={contract.id}
                  className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${contract.id === selectedContractId ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                  onClick={() => selectContract(contract.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {contract.title}
                    </div>
                    <div className="truncate font-data text-xs text-muted-foreground">
                      {contract.contractKey}
                    </div>
                  </div>
                  <Badge className={statusTone(contract.status)}>
                    {contract.status}
                  </Badge>
                  <ChevronRight className="h-4 w-4 shrink-0" />
                </button>
              ))
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                No Master Contract draft has been imported yet.
              </div>
            )}
          </aside>
          <section className="min-w-0">
            {detail ? (
              <>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">
                        {detail.contract.title}
                      </h2>
                      <Badge className={statusTone(detail.contract.status)}>
                        {detail.contract.status}
                      </Badge>
                    </div>
                    <div className="font-data text-xs text-muted-foreground">
                      {detail.contract.contractKey} · approved revision{" "}
                      {detail.contract.approvedRevision ?? "none"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!detail.contract.permissions.canEdit}
                      onClick={() => {
                        setEditorNew(false);
                        setEditorOpen(true);
                      }}
                    >
                      Amend baseline
                    </Button>
                    {["draft", "approved"].includes(detail.contract.status) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => decide("submit")}
                      >
                        Submit for approval
                      </Button>
                    ) : null}
                    {detail.contract.status === "pending_supplier_approval" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => setApprovalOpen(true)}
                      >
                        <Upload className="mr-1 h-4 w-4" />
                        Record supplier approval
                      </Button>
                    ) : null}
                    {canOwnerApprove ? (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => decide("approve_owner")}
                      >
                        <ShieldCheck className="mr-1 h-4 w-4" />
                        Owner approve
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !selected.size}
                      onClick={reviewPreflight}
                    >
                      Review preflight
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        busy || !selected.size || !detail.setting.featureEnabled
                      }
                      onClick={createBatch}
                    >
                      {busy ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : null}
                      Create selected in Salesforce ({selected.size})
                    </Button>
                  </div>
                </div>
                {preflight && !preflight.ready ? (
                  <Alert variant="destructive" className="mb-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>
                      {preflight.blockers.length} preflight blocker
                      {preflight.blockers.length === 1 ? "" : "s"}
                    </AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc space-y-1 pl-5">
                        {preflight.blockers.map((row, index) => (
                          <li
                            key={`${row.code}-${row.deliveryKey || ""}-${index}`}
                          >
                            {row.message}
                          </li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                ) : null}
                {detail.live?.warning ? (
                  <Alert className="mb-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{detail.live.warning}</AlertDescription>
                  </Alert>
                ) : null}
                <Tabs value={activeTab} onValueChange={setTab}>
                  <TabsList className="mb-4 grid h-auto w-full grid-cols-2 md:grid-cols-4">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
                    <TabsTrigger value="terms">Terms & Pricing</TabsTrigger>
                    <TabsTrigger value="sync">Amendments & Sync</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview">
                    <DetailOverview detail={detail} />
                  </TabsContent>
                  <TabsContent value="deliveries">
                    <DeliveryTable
                      detail={detail}
                      selected={selected}
                      setSelected={setSelected}
                      onResolvePrice={resolvePrice}
                      onApplyPrice={applyPrice}
                      busyKey={busyKey}
                    />
                  </TabsContent>
                  <TabsContent value="terms">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">
                            Pricing formulae
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-3">
                          {detail.contract.snapshot.products.map((product) => (
                            <div
                              key={product.productKey}
                              className="rounded-lg border p-3"
                            >
                              <div className="font-medium">
                                {product.productName || "Unnamed product"}
                              </div>
                              <div className="mt-1 font-data text-sm">
                                {masterContractBenchmark(product)?.name || "Benchmark not selected"} ({product.benchmarkUnit}
                                ) × {product.conversionFactor || 1} + buy{" "}
                                {Number(product.buyPremium).toFixed(2)} / sell{" "}
                                {Number(product.sellPremium).toFixed(2)}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Total quantity{" "}
                                {range(
                                  product.contractedMinQty,
                                  product.contractedMaxQty,
                                )}{" "}
                                · final Salesforce prices round to 2 decimals.
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">
                            Charge rules
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-3">
                          {detail.contract.snapshot.chargeRules.map((rule) => (
                            <div
                              key={rule.chargeKey}
                              className="flex items-center justify-between rounded-lg border p-3"
                            >
                              <div>
                                <div className="font-medium">
                                  {rule.chargeName}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {rule.supplierName} ·{" "}
                                  {rule.appliesWhen.replaceAll("_", " ")}
                                </div>
                              </div>
                              <div className="tabular-nums">
                                USD {formatter.format(Number(rule.fixedCost))} /{" "}
                                {formatter.format(Number(rule.fixedSell))}
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>
                  <TabsContent value="sync">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">
                            Immutable approval history
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-2">
                          {detail.relations.revisions.map((row) => (
                            <div
                              key={row.id}
                              className="rounded-lg border p-3 text-sm"
                            >
                              <div className="flex justify-between">
                                <span className="font-medium">
                                  Revision {row.revision} · {row.revision_kind}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(row.created_at).toLocaleString()}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Supplier{" "}
                                {row.supplier_approved_at
                                  ? "approved"
                                  : "pending"}{" "}
                                · Owner{" "}
                                {row.owner_approved_at ? "approved" : "pending"}{" "}
                                ·{" "}
                                <span className="font-data">
                                  {row.snapshot_hash.slice(0, 12)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">
                            Salesforce sync and variances
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-2">
                          {detail.relations.variances.length ? (
                            detail.relations.variances.map((row) => (
                              <div
                                key={row.id}
                                className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"
                              >
                                <div className="font-medium">
                                  {row.field_path}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {row.status} · detected{" "}
                                  {new Date(row.detected_at).toLocaleString()}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="text-sm text-muted-foreground">
                              No unresolved approved-versus-live variance is
                              recorded.
                            </div>
                          )}
                          {detail.relations.jobs.slice(0, 10).map((row) => (
                            <div
                              key={row.id}
                              className="flex items-center justify-between rounded-lg border p-3 text-sm"
                            >
                              <span>{row.job_type.replaceAll("_", " ")}</span>
                              <Badge className={statusTone(row.status)}>
                                {row.status}
                              </Badge>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            ) : (
              <StateBlock
                title="Select a Master Contract"
                description="Choose a contract to review its approved baseline, delivery allocations and Salesforce state."
              />
            )}
          </section>
        </div>
      )}
      <ContractEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        detail={editorNew ? null : detail}
        options={options}
        onOptionsQuery={queryOptions}
        onCreateVessel={createVessel}
        onSave={save}
        busy={busy}
      />
      <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record supplier approval</DialogTitle>
            <DialogDescription>
              Record a concise external reference. The immutable evidence entry
              is bound to this exact revision.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>Supplier evidence reference</Label>
            <Textarea
              value={approvalNote}
              onChange={(event) => setApprovalNote(event.target.value)}
              placeholder="Email date, subject, supplier approver or document reference"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovalOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || approvalNote.trim().length < 3}
              onClick={recordEvidence}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Record and supplier approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={featureOpen} onOpenChange={setFeatureOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {list?.setting?.featureEnabled ? "Disable" : "Enable"} Master
              Contract creation
            </DialogTitle>
            <DialogDescription>
              This company-wide safeguard controls Salesforce batch creation.
              Record why the verified state is changing.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>Reason</Label>
            <Textarea
              value={featureReason}
              onChange={(event) => setFeatureReason(event.target.value)}
              placeholder="Verification or rollback reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFeatureOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || featureReason.trim().length < 8}
              onClick={saveFeature}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {list?.setting?.featureEnabled ? "Disable" : "Enable"} safeguard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
