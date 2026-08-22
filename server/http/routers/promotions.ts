import { Router } from 'express';
import type { Server } from 'socket.io';
import { shopRoom } from '../../../contract/shop/rooms';
import { createPromotion, deletePromotion, listPromotions, resetPromotionUses, updatePromotion } from '../../promotions';
import { requireStaff } from '../middleware/auth';
import { shopIdOf } from '../middleware/tenant';

/**
 * Promoções automáticas.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function promotionsRouter(io: Server): Router {
  const router = Router();

  // ---------- Promoções automáticas ----------
  // A leitura é pública: o cardápio do cliente precisa saber o preço promocional
  // antes de o pedido existir. Só a escrita pede a sessão da cozinha.
  router.get('/promotions', (req, res) => {
    res.json(listPromotions(shopIdOf(req)));
  });

  router.post('/promotions', requireStaff('kitchen'), (req, res) => {
    const promo = createPromotion(shopIdOf(req), req.body);
    io.to(shopRoom(shopIdOf(req))).emit('promotions:updated');
    res.status(201).json(promo);
  });

  router.patch('/promotions/:id', requireStaff('kitchen'), (req, res) => {
    const promo = updatePromotion(shopIdOf(req), String(req.params.id), req.body ?? {});
    io.to(shopRoom(shopIdOf(req))).emit('promotions:updated');
    res.json(promo);
  });

  router.delete('/promotions/:id', requireStaff('kitchen'), (req, res) => {
    deletePromotion(shopIdOf(req), String(req.params.id));
    io.to(shopRoom(shopIdOf(req))).emit('promotions:updated');
    res.json({ ok: true });
  });

  router.post('/promotions/:id/reset-uses', requireStaff('kitchen'), (req, res) => {
    const promo = resetPromotionUses(shopIdOf(req), String(req.params.id));
    io.to(shopRoom(shopIdOf(req))).emit('promotions:updated');
    res.json(promo);
  });

  return router;
}
