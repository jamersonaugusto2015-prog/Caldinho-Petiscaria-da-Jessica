/**
 * O que a cozinha vê nos relatórios.
 *
 * `RevenueTrends` existia DUAS vezes — aqui e em `server/reports.ts` — e as
 * duas cópias tinham que combinar por acaso. Agora só existe esta.
 */

export interface SalesReport {
  totalRevenue: number;
  totalOrders: number;
  avgTicket: number;
  topSellingProducts: { name: string; count: number; total: number }[];
  hourlyDistribution: { hour: string; orders: number }[];
  avgRating: number;
}

export interface RevenuePoint {
  label: string;
  date: string;
  revenue: number;
  orders: number;
}

export interface RevenueTrends {
  daily: RevenuePoint[];
  weekly: RevenuePoint[];
  monthly: RevenuePoint[];
}
