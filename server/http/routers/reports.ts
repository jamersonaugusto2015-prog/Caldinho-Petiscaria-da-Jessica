import { Router } from 'express';
import { listOrders } from '../../orderStore';
import { buildRevenueTrends, buildSalesReport } from '../../reports';
import { requireStaff } from '../middleware/auth';
import { getSettings } from '../../db';
import { shopIdOf } from '../middleware/tenant';

/**
 * Relatórios de venda e tendências de faturamento.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function reportsRouter(): Router {
  const router = Router();

  // ---------- Relatórios (agregação real no servidor) ----------
  router.get('/reports', requireStaff('kitchen'), (req, res) => {
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');

    /**
     * A janela é recortada no SQL, não em JavaScript. Antes isto era
     * `listAllOrders()`: o histórico inteiro da loja saía do banco e era
     * desserializado para o filtro por data jogar quase tudo fora.
     *
     * O `to` vai até o fim do dia (`T23:59:59`) porque a coluna guarda o
     * instante e a consulta é por DIA. `buildSalesReport` refaz o corte no fuso
     * local — este aqui é a peneira grossa, não a fina: uma consulta por dia
     * exato deixaria de fora o pedido feito às 23h50 do dia de lá.
     */
    const orders = listOrders(shopIdOf(req), {
      from: from ? `${from}T00:00:00.000Z` : undefined,
      to: to ? `${to}T23:59:59.999Z` : undefined,
    });
    res.json(buildSalesReport(orders, { from, to, timeZone: getSettings(shopIdOf(req)).timezone }));
  });

  // ---------- Tendências de faturamento (diário/semanal/mensal) ----------
  router.get('/reports/trends', requireStaff('kitchen'), (req, res) => {
    res.json(buildRevenueTrends(listOrders(shopIdOf(req))));
  });

  return router;
}
