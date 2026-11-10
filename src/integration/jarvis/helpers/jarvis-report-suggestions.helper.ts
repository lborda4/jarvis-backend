import type { ReportDocument } from '../jarvis-reports.types';

export interface ReportSuggestion { value: string; label: string }

export interface ReportSuggestionCatalog {
  customers: Array<{ value: string; name: string }>;
  products: Array<{ value: string; name: string }>;
  sellers: Array<{ value: string; name: string }>;
}

export function buildReportSuggestions(documents: ReportDocument[], catalog?: ReportSuggestionCatalog) {
  const customers = new Map<string, ReportSuggestion>();
  const products = new Map<string, ReportSuggestion>();
  const sellers = new Map<string, ReportSuggestion>();
  const search = new Map<string, ReportSuggestion>();
  const add = (target: Map<string, ReportSuggestion>, value: string | undefined, name: string | undefined) => {
    const selected = (value?.trim() || name?.trim() || '').slice(0, 200);
    if (!selected) return;
    const label = name?.trim() && name.trim() !== selected ? `${name.trim()} — ${selected}` : selected;
    const key = selected.toLocaleLowerCase('es');
    if (!target.has(key)) target.set(key, { value: selected, label });
  };
  // Current company catalogs remain available even without sales in this period.
  for (const row of catalog?.customers ?? []) {
    add(customers, row.value, row.name);
    add(search, row.value, row.name);
  }
  for (const row of catalog?.products ?? []) add(products, row.value, row.name);
  for (const row of catalog?.sellers ?? []) add(sellers, row.value, row.name);
  for (const document of documents) {
    add(customers, document.customerId, document.customerName);
    add(search, document.customerId, document.customerName);
    add(search, document.number, document.number);
    for (const item of document.source?.items ?? []) add(products, item.code, item.description);
    const recordedSellers = document.source?.sellers?.length ? document.source.sellers : document.referenceSellers ?? [];
    for (const seller of recordedSellers) {
      if (seller.id && seller.name) add(sellers, seller.id, seller.name);
    }
  }
  const sorted = (values: Map<string, ReportSuggestion>) => [...values.values()].sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
  return { customers: sorted(customers), products: sorted(products), sellers: sorted(sellers), search: sorted(search) };
}
