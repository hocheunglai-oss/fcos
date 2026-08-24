import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  ExternalLink,
  FileSignature,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/common/PageHeader";
import PageMethodology from "@/components/common/PageMethodology";
import StateBlock from "@/components/common/StateBlock";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

const SALESFORCE_ORIGIN = "https://fratellicosulich.lightning.force.com";
const DEFAULT_SNAPSHOT = Object.freeze({
  ownerUserId: "",
  parties: {
    buyer: { accountId: "", name: "", clKey: "", pic: "" },
    supplier: { accountId: "", name: "", clKey: "", confirmed: false },
  },
  terms: {
    don: { minDays: "", maxDays: "" },
    variableCharges: { mode: "", supplierIds: [] },
  },
  products: [],
  deliveries: [],
  chargeRules: [],
});
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function EntitySelect({
  label,
  value,
  options,
  onChange,
  renderLabel = (row) => row.name,
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Select value={value || undefined} onValueChange={onChange}>
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

function SupplierChecklist({ label, value = [], accounts, onChange }) {
  const suppliers = accounts.filter((row) => row.role.includes("supplier"));
  const selected = new Set(value);
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="grid max-h-36 gap-1 overflow-y-auto rounded-lg border bg-background p-2 md:grid-cols-2">
        {suppliers.length ? (
          suppliers.map((supplier) => (
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
  const [referenceQuery, setReferenceQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setContractKey(existing?.contractKey || "");
    setTitle(existing?.title || "");
    setSnapshot(clone(existing?.snapshot || DEFAULT_SNAPSHOT));
    setReferenceQuery("");
  }, [existing, open]);

  const chooseAccount = (side, accountId) => {
    const account = options.accounts.find((row) => row.id === accountId);
    if (!account) return;
    setSnapshot((current) =>
      setPath(current, ["parties", side], {
        ...current.parties[side],
        accountId: account.id,
        name: account.name,
        clKey: account.clKey || "",
        ...(side === "supplier" ? { confirmed: false } : {}),
      }),
    );
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
        rowIndex === index ? { ...row, ...patch } : row,
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
          productKey: `product_${current.products.length + 1}`,
          productName: "",
          salesforceProductId: "",
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
          deliveryKey: `${contractKey || "CONTRACT"}-D${String(current.deliveries.length + 1).padStart(2, "0")}`,
          sequence: current.deliveries.length + 1,
          vesselName: "",
          vesselImo: "",
          vesselId: "",
          portId: "",
          portName: "",
          preliminaryEta: "",
          supplyLocation: "TBD",
          buyerPaymentTerm: current.parties.buyer.paymentTerm || "",
          supplierPaymentTerm: current.parties.supplier.paymentTerm || "",
          donDate: "",
          variableChargeSupplierIds: [],
          products: current.products.map((product) => ({
            productKey: product.productKey,
            contractLineKey: `${contractKey || "CONTRACT"}-D${String(current.deliveries.length + 1).padStart(2, "0")}-${product.productKey}`,
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
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
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
        <div className="grid gap-6 py-2">
          <section className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-3 sm:flex-row sm:items-end">
            <Field
              label="Search Salesforce references"
              value={referenceQuery}
              placeholder="Account, CL Key, Product, Port, Vessel or IMO"
              onChange={setReferenceQuery}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => onOptionsQuery(referenceQuery)}
            >
              Search references
            </Button>
            <span className="pb-2 text-xs text-muted-foreground">
              Exact Salesforce IDs are retained when results change.
            </span>
          </section>
          <section className="grid gap-3 rounded-xl border p-4">
            <h3 className="font-semibold">Identity and parties</h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Field
                label="Contract key"
                value={contractKey}
                onChange={(value) =>
                  setContractKey(
                    value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""),
                  )
                }
              />
              <Field label="Title" value={title} onChange={setTitle} />
              <EntitySelect
                label="Contract owner"
                value={snapshot.ownerUserId}
                options={options.owners}
                onChange={(value) =>
                  setSnapshot((current) => ({ ...current, ownerUserId: value }))
                }
              />
              <EntitySelect
                label="Buyer"
                value={snapshot.parties.buyer.accountId}
                options={options.accounts.filter((row) =>
                  row.role.includes("buyer"),
                )}
                onChange={(value) => chooseAccount("buyer", value)}
                renderLabel={(row) =>
                  `${row.name}${row.clKey ? ` · ${row.clKey}` : ""}`
                }
              />
              <EntitySelect
                label="Supplier"
                value={snapshot.parties.supplier.accountId}
                options={options.accounts.filter((row) =>
                  row.role.includes("supplier"),
                )}
                onChange={(value) => chooseAccount("supplier", value)}
                renderLabel={(row) =>
                  `${row.name}${row.clKey ? ` · ${row.clKey}` : ""}`
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
            <h3 className="font-semibold">DON and Variable Charges</h3>
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
              <EntitySelect
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
                Product terms and contracted totals
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
                className="grid gap-2 rounded-lg bg-muted/40 p-3 md:grid-cols-4 xl:grid-cols-6"
              >
                <Field
                  label="Product key"
                  value={product.productKey}
                  onChange={(value) =>
                    updateProduct(index, { productKey: value })
                  }
                />
                <EntitySelect
                  label="Salesforce Product"
                  value={product.salesforceProductId}
                  options={options.products}
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
                <Field
                  label="Benchmark code"
                  value={product.benchmarkCode}
                  onChange={(value) =>
                    updateProduct(index, { benchmarkCode: value })
                  }
                />
                <EntitySelect
                  label="Benchmark unit"
                  value={product.benchmarkUnit}
                  options={[
                    { id: "USD/MT", name: "USD/MT" },
                    { id: "USD/bbl", name: "USD/bbl" },
                  ]}
                  onChange={(value) =>
                    updateProduct(index, { benchmarkUnit: value })
                  }
                />
                <Field
                  label="Conversion"
                  type="number"
                  step="0.000001"
                  value={product.conversionFactor}
                  onChange={(value) =>
                    updateProduct(index, { conversionFactor: value })
                  }
                />
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
                  label="Contract total min"
                  type="number"
                  step="0.001"
                  value={product.contractedMinQty}
                  onChange={(value) =>
                    updateProduct(index, { contractedMinQty: value })
                  }
                />
                <Field
                  label="Contract total max"
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
              <h3 className="font-semibold">Deliveries</h3>
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
            {snapshot.deliveries.map((delivery, index) => (
              <div
                key={`${delivery.deliveryKey}-${index}`}
                className="grid gap-3 rounded-lg border bg-card p-3"
              >
                <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-6">
                  <Field
                    label="Delivery key"
                    value={delivery.deliveryKey}
                    onChange={(value) =>
                      updateDelivery(index, { deliveryKey: value })
                    }
                  />
                  <EntitySelect
                    label="Vessel"
                    value={delivery.vesselId}
                    options={options.vessels}
                    onChange={(value) => {
                      const row = options.vessels.find(
                        (item) => item.id === value,
                      );
                      updateDelivery(index, {
                        vesselId: value,
                        vesselName: row?.name || "",
                        vesselImo: row?.imo || "",
                      });
                    }}
                    renderLabel={(row) =>
                      `${row.name}${row.imo ? ` · ${row.imo}` : ""}`
                    }
                  />
                  {existing && !delivery.vesselId ? (
                    <div className="grid gap-2 rounded-lg border border-dashed p-2 md:col-span-2 md:grid-cols-[1fr_160px_auto]">
                      <Field
                        label="New vessel name"
                        value={delivery.vesselName}
                        onChange={(value) =>
                          updateDelivery(index, { vesselName: value })
                        }
                      />
                      <Field
                        label="IMO"
                        value={delivery.vesselImo}
                        onChange={(value) =>
                          updateDelivery(index, { vesselImo: value })
                        }
                      />
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
                            });
                            if (created)
                              updateDelivery(index, {
                                vesselId: created.id,
                                vesselName: created.name,
                                vesselImo: created.imo,
                              });
                          }}
                        >
                          Create after duplicate check
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <EntitySelect
                    label="Port"
                    value={delivery.portId}
                    options={options.ports}
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
                  <Field
                    label="Preliminary ETA"
                    type="date"
                    value={delivery.preliminaryEta}
                    onChange={(value) =>
                      updateDelivery(index, { preliminaryEta: value })
                    }
                  />
                  <EntitySelect
                    label="Supply location"
                    value={delivery.supplyLocation}
                    options={["TBD", "Berth", "Anchorage"].map((id) => ({
                      id,
                      name: id,
                    }))}
                    onChange={(value) =>
                      updateDelivery(index, { supplyLocation: value })
                    }
                  />
                  <Field
                    label="DON date"
                    type="date"
                    value={delivery.donDate}
                    onChange={(value) =>
                      updateDelivery(index, { donDate: value })
                    }
                  />
                  <Field
                    label="Alternate DON publication reason"
                    value={delivery.donAlternateReason}
                    placeholder="Required only when the agreed date is outside the DON window"
                    onChange={(value) =>
                      updateDelivery(index, { donAlternateReason: value })
                    }
                  />
                  <Field
                    label="Buyer payment term"
                    value={delivery.buyerPaymentTerm}
                    onChange={(value) =>
                      updateDelivery(index, { buyerPaymentTerm: value })
                    }
                  />
                  <Field
                    label="Supplier payment term"
                    value={delivery.supplierPaymentTerm}
                    onChange={(value) =>
                      updateDelivery(index, { supplierPaymentTerm: value })
                    }
                  />
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
                            )?.productName || allocation.productKey}
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
              <h3 className="font-semibold">Fixed charge rules</h3>
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
                className="grid gap-2 rounded-lg bg-muted/40 p-3 md:grid-cols-4 xl:grid-cols-7"
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
                <EntitySelect
                  label="Supplier"
                  value={rule.supplierAccountId}
                  options={options.accounts.filter((row) =>
                    row.role.includes("supplier"),
                  )}
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
                <EntitySelect
                  label="Product"
                  value={rule.salesforceProductId}
                  options={options.products}
                  onChange={(value) =>
                    setSnapshot((current) => ({
                      ...current,
                      chargeRules: current.chargeRules.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, salesforceProductId: value }
                          : row,
                      ),
                    }))
                  }
                />
                <EntitySelect
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !contractKey || !title}
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
            Contracted quantity and allocation
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
                    {row.productName || row.productKey}
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
                        {delivery.supplyLocation || "TBD"} · DON{" "}
                        {displayDate(delivery.donDate)}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-56">
                      {(delivery.products || []).map((product) => (
                        <div
                          key={product.contractLineKey}
                          className="flex justify-between gap-3"
                        >
                          <span>
                            {detail.contract.snapshot.products.find(
                              (row) => row.productKey === product.productKey,
                            )?.productName || product.productKey}
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
      force ? setRefreshing(true) : setLoading(true);
      setError("");
      try {
        const result = await invoke(
          "masterContractsList",
          { force },
          { cache: !force },
        );
        setList(result);
        if (!selectedContractId && result.contracts?.length)
          setSearchParams(
            { contractId: result.contracts[0].id },
            { replace: true },
          );
      } catch (nextError) {
        setError(nextError.message);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [invoke, selectedContractId, setSearchParams],
  );

  const loadDetail = useCallback(
    async ({ force = false } = {}) => {
      if (!selectedContractId) {
        setDetail(null);
        return;
      }
      force ? setRefreshing(true) : setLoading(true);
      setError("");
      try {
        const result = await invoke("masterContractDetail", {
          contractId: selectedContractId,
          includeLive: true,
          force,
        });
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
        setError(nextError.message);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [invoke, selectedContractId],
  );

  const loadOptions = useCallback(async () => {
    try {
      setOptions(
        await invoke(
          "masterContractOptions",
          { query: "" },
          { cache: true, cacheTtlMs: 60_000 },
        ),
      );
    } catch (nextError) {
      setError(nextError.message);
    }
  }, [invoke]);

  const queryOptions = async (query) => {
    try {
      setOptions(
        await invoke(
          "masterContractOptions",
          { query },
          { cache: true, cacheTtlMs: 60_000 },
        ),
      );
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  const createVessel = async ({ name, imo }) => {
    if (!detail?.contract?.id) return null;
    setBusy(true);
    setError("");
    try {
      const created = await invoke("masterContractVesselCreate", {
        contractId: detail.contract.id,
        name,
        imo,
      });
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

  const refresh = async () => {
    await Promise.all([loadList({ force: true }), loadDetail({ force: true })]);
  };
  const save = async ({ contractKey, title, snapshot }) => {
    setBusy(true);
    setError("");
    try {
      const result = await invoke("masterContractSave", {
        contractId: editorNew ? null : detail?.contract.id || null,
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
      if (editorNew) setSearchParams({ contractId: result.contractId });
      await loadList({ force: true });
      setDetail(result.detail);
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
        benchmarkDate: delivery.donDate,
        alternatePublicationReason: delivery.donAlternateReason || "",
        confirm: false,
      });
      const evidence = preview.evidence;
      const accepted = window.confirm(
        `${evidence.benchmarkCode} ${evidence.benchmarkValue} on ${evidence.benchmarkDate}\nBuy ${evidence.buyUnrounded} → ${evidence.buyRounded}\nSell ${evidence.sellUnrounded} → ${evidence.sellRounded}\n\nConfirm this reviewed DON price?`,
      );
      if (accepted) {
        await invoke("masterContractPriceResolve", {
          contractId: detail.contract.id,
          deliveryProductId: product.id,
          expectedRevision: detail.contract.currentRevision,
          benchmarkDate: delivery.donDate,
          alternatePublicationReason: delivery.donAlternateReason || "",
          confirm: true,
          idempotencyKey: operationId("master-contract-price-review"),
        });
        setMessage(
          "DON price evidence reviewed. Apply it to the exact Salesforce line when ready.",
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
      setMessage("Reviewed DON price applied to Salesforce.");
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
                  onClick={() => setSearchParams({ contractId: contract.id })}
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
                                {product.productName || product.productKey}
                              </div>
                              <div className="mt-1 font-data text-sm">
                                {product.benchmarkCode} ({product.benchmarkUnit}
                                ) × {product.conversionFactor || 1} + buy{" "}
                                {Number(product.buyPremium).toFixed(2)} / sell{" "}
                                {Number(product.sellPremium).toFixed(2)}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Contracted{" "}
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
