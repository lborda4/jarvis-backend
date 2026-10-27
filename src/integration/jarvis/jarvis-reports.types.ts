import type { CreateJarvisInvoiceRequestDto } from './dto/create-jarvis-invoice.dto';

export const REPORT_TYPES = [
  'sales',
  'customers',
  'products',
  'sellers',
  'taxes',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportView = 'summary' | 'detail';
export interface ReportQuery {
  report?: string;
  view?: string;
  from?: string;
  to?: string;
  customer?: string;
  seller?: string;
  product?: string;
  kind?: string;
  currency?: string;
  page?: string;
  pageSize?: string;
}
export interface ReportFilters {
  report: ReportType;
  view: ReportView;
  from: string;
  to: string;
  customer: string;
  seller: string;
  product: string;
  kind: string;
  currency: string;
  page: number;
  pageSize: number;
}
export interface ReportDocument {
  id: string;
  kind: string;
  date: string;
  number: string;
  customerId: string;
  customerName: string;
  currency: string;
  total: string;
  source: CreateJarvisInvoiceRequestDto | null;
  referenceSellers?: Array<{ id: string; name: string }> | null;
}
export type ReportRow = Record<string, string | number | null>;
export interface ReportColumn {
  key: string;
  label: string;
  format: 'text' | 'money' | 'number' | 'percent';
}
export interface ReportResult {
  filters: ReportFilters;
  columns: ReportColumn[];
  items: ReportRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: ReportRow[];
  warnings: string[];
}
