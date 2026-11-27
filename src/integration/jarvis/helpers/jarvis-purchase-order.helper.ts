import type { JarvisPurchaseOrderDto } from '../dto/create-jarvis-invoice.dto';

export function normalizePurchaseOrder(order: JarvisPurchaseOrderDto | null | undefined): JarvisPurchaseOrderDto | null {
  if (typeof order?.prefix !== 'string' || typeof order.consecutive !== 'string' || typeof order.issueDate !== 'string') return null;
  const prefix = order.prefix.trim().replace(/[-\s]+$/, '');
  const consecutive = order.consecutive.trim().replace(/^[-\s]+/, '');
  const issueDate = order.issueDate.trim();
  if (!prefix || !consecutive || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate) ||
      Number.isNaN(Date.parse(issueDate)) || new Date(issueDate).toISOString().slice(0, 10) !== issueDate) return null;
  return { prefix: `${prefix}-`, consecutive, issueDate };
}

export function storedPurchaseOrderReference(order: JarvisPurchaseOrderDto | null | undefined) {
  if (typeof order?.prefix !== 'string' || typeof order.consecutive !== 'string') return null;
  const prefix = order.prefix.trim();
  const consecutive = order.consecutive.trim();
  if (!prefix || !consecutive) return null;
  return {
    orderNumber: `${prefix}${consecutive}`,
    orderDate: typeof order.issueDate === 'string' ? order.issueDate.trim() || null : null,
  };
}
