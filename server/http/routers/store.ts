import { Router } from 'express';
import type { Server } from 'socket.io';
import { shopRoom } from '../../../contract/shop/rooms';
import { getMetaValue, setMetaValue } from '../../db';
import { requireStaff } from '../middleware/auth';
import { shopIdOf } from '../middleware/tenant';

/**
 * Identidade visual da loja.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function storeRouter(io: Server): Router {
  const router = Router();

  // ---------- Store / Loja ----------
  router.get('/store', (req, res) => {
    res.json({ logo: getMetaValue(shopIdOf(req), 'store_logo') });
  });

  router.post('/store/logo', requireStaff('kitchen'), (req, res) => {
    const { logo } = req.body ?? {};
    if (typeof logo !== 'string') {
      return res.status(400).json({ error: 'Informe a URL do logo.' });
    }
    setMetaValue(shopIdOf(req), 'store_logo', logo.trim());
    io.to(shopRoom(shopIdOf(req))).emit('store:updated', { logo: logo.trim() });
    res.json({ logo: logo.trim() });
  });

  return router;
}
