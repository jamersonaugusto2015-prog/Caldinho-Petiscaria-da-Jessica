import { Router } from 'express';
import type { Server } from 'socket.io';
import { shopRoom } from '../../../contract/shop/rooms';
import { deleteCoupon, listCouponsSorted, saveCoupon } from '../../catalog';
import { requireStaff } from '../middleware/auth';
import { shopIdOf } from '../middleware/tenant';

/**
 * Cupons de desconto.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function couponsRouter(io: Server): Router {
  const router = Router();

  // ---------- Coupons (CRUD no banco) ----------
  router.get('/coupons', (req, res) => {
    res.json(listCouponsSorted(shopIdOf(req)));
  });

  router.post('/coupons', requireStaff('kitchen'), (req, res) => {
    const coupon = saveCoupon(shopIdOf(req), req.body);
    io.to(shopRoom(shopIdOf(req))).emit('coupons:updated');
    res.status(201).json(coupon);
  });

  router.delete('/coupons/:code', requireStaff('kitchen'), (req, res) => {
    deleteCoupon(shopIdOf(req), String(req.params.code));
    io.to(shopRoom(shopIdOf(req))).emit('coupons:updated');
    res.json({ ok: true });
  });

  return router;
}
