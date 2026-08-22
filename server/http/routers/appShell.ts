import { Router } from 'express';
import { buildManifest, roleFromSlug } from '../../../contract/shop/branding';
import { getMetaValue, getSettings } from '../../db';
import { shopIdOf } from '../middleware/tenant';

/**
 * O casco do app instalado, gerado a partir das configurações DESTA loja.
 *
 * Os três manifestos eram arquivos estáticos em `public/`, com o nome e a cor
 * da primeira loja escritos dentro. Toda loja da plataforma instalaria um
 * atalho chamado "Caldinho da Jessica" — e um PWA instalado guarda esse nome no
 * aparelho, então não é algo que se conserta num deploy depois.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function appShellRouter(): Router {
  const router = Router();

  router.get('/manifest-:role.webmanifest', (req, res) => {
    const role = roleFromSlug(req.params.role);
    if (!role) return res.status(404).json({ error: 'App desconhecido.' });

    const shopId = shopIdOf(req);
    const manifest = buildManifest(role, getSettings(shopId), {
      primaryColor: getMetaValue(shopId, 'brand_primary_color') || undefined,
      iconBase: getMetaValue(shopId, 'brand_icon_base') || undefined,
    });

    // `application/manifest+json` é o tipo que o navegador espera; com
    // `application/json` alguns navegadores ignoram o manifesto em silêncio e o
    // app deixa de ser instalável sem nenhum erro.
    res.type('application/manifest+json');
    // Cache curto: o dono muda o nome da loja no painel e espera ver o efeito.
    // Longo demais e ele reinstala o app achando que o sistema está quebrado.
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(manifest);
  });

  return router;
}
