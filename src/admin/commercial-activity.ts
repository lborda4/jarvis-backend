import { randomUUID } from 'crypto';

export interface CommercialActivity {
  id: string;
  kind: 'PAYMENT' | 'COMMENT';
  createdAt: string;
  text?: string;
  amountCop?: number | null;
  planName?: string;
  provider?: string;
}

export function commercialActivity(item: Omit<CommercialActivity, 'id' | 'createdAt'>): CommercialActivity {
  return { ...item, id: randomUUID(), createdAt: new Date().toISOString() };
}
