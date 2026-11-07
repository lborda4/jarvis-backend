import type { ReportDocument } from '../jarvis-reports.types';

export interface ReportSuggestion { value: string; label: string }

export function buildReportSuggestions(documents: ReportDocument[]) {
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
