import { Router } from 'express';
import type { Server } from 'socket.io';
import { isStoreOpen } from '../../../contract/pricing/geo';
import { customerRoom } from '../../../contract/shop/rooms';
import { getSettings } from '../../db';
import { DomainError } from '../../errors';
import { getCustomerStamps, redeemFreeCaldinho } from '../../loyalty';
import { shopIdOf } from '../middleware/tenant';

/**
 * Selos de fidelidade e resgate de brinde.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function loyaltyRouter(io: Server): Router {
  const router = Router();

  // ---------- Fidelidade (por cliente/dispositivo) ----------
  router.get('/loyalty', (req, res) => {
    const customerId = String(req.query.customerId || '').trim();
    if (!customerId || customerId === 'anon') {
      return res.status(400).json({ error: 'Não deu para identificar você. Recarregue a página.' });
    }
    res.json({ points: getCustomerStamps(shopIdOf(req), customerId) });
  });

  router.post('/loyalty/redeem', (req, res) => {
    const customerId = String(req.body?.customerId || '').trim();
    const productId = String(req.body?.productId || '');
    // O selo só pode ser gasto se o brinde puder entrar num carrinho agora:
    // com a loja fechada o cliente perderia os selos sem receber nada.
    if (!isStoreOpen(getSettings(shopIdOf(req)))) {
      return res.status(409).json({ error: 'A loja está fechada. Resgate seu brinde quando ela abrir.' });
    }
    try {
      const result = redeemFreeCaldinho(shopIdOf(req), customerId, productId);
      io.to(customerRoom(shopIdOf(req), customerId)).emit('loyalty:updated', {
        customerId,
        points: result.points,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof DomainError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error('[loyalty] falha inesperada no resgate:', err);
      res.status(400).json({ error: 'Não deu para resgatar o brinde. Seus selos continuam guardados. Tente de novo.' });
    }
  });

  return router;
}
