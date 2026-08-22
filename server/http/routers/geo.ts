import { Router } from 'express';
import { geoThrottle, nominatimSearch, throttleKey, viaCepLookup } from '../../geocode';
import { shopIdOf } from '../middleware/tenant';
import { asyncRoute } from '../middleware/errors';

/**
 * Geocodificação de endereço e busca de CEP.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function geoRouter(): Router {
  const router = Router();

  // ---------- Geocodificação e CEP ----------
  router.post('/geocode', asyncRoute(async (req, res) => {
    const query = String(req.body?.query ?? '').trim();
    if (!query) return res.status(400).json({ error: 'Informe um endereço para localizar.' });
    if (geoThrottle.shouldThrottle(throttleKey(shopIdOf(req), req.ip), 6, 10000)) {
      return res.status(429).json({ error: 'Muitas buscas. Aguarde alguns segundos.' });
    }
    try {
      const result = await nominatimSearch(query);
      if (!result) {
        return res.status(404).json({ error: 'Endereço não encontrado. Use o pino no mapa para ajustar.' });
      }
      res.json(result);
    } catch {
      res.status(502).json({ error: 'Serviço de localização indisponível. Use o pino no mapa.' });
    }
  }));

  router.get('/cep/:cep', asyncRoute(async (req, res) => {
    const cep = String(req.params.cep ?? '').replace(/\D/g, '').slice(0, 8);
    if (cep.length !== 8) return res.status(400).json({ error: 'CEP inválido.' });
    if (geoThrottle.shouldThrottle(throttleKey(shopIdOf(req), req.ip), 10, 10000)) {
      return res.status(429).json({ error: 'Muitas consultas. Aguarde alguns segundos.' });
    }
    try {
      const result = await viaCepLookup(cep);
      if (!result) return res.status(404).json({ error: 'CEP não encontrado.' });
      res.json(result);
    } catch {
      res.status(502).json({ error: 'Serviço de CEP indisponível. Preencha manualmente.' });
    }
  }));

  return router;
}
