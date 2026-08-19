export function getOrCreateCustomerId(): string {
  try {
    const existing = localStorage.getItem('ce_customer_id');
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : 'cust-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('ce_customer_id', id);
    return id;
  } catch {
    return 'anon';
  }
}
