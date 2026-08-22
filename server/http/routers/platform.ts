import { Router } from 'express';
import { randomBytes } from 'crypto';
import { hashPassword } from '../../auth';
import { db } from '../../db';
import {
  alterarLojaSchema,
  loginPlataformaSchema,
  novaLojaSchema,
  shopUrl,
  type ShopStatus,
} from '../../../contract/shop/platform';
import { describeSettingsError } from '../../../contract/shop/settings';
import { config } from '../../config';
import { createShop } from '../../infra/db/seed/createShop';
import { invalidateShopCache, listShops, shopById } from '../../infra/shops';
import { setMetaValue } from '../../db';
import { setSecret } from '../../infra/secrets';
import { isMercadoPagoConnected } from '../../mercadopago';
import { loginPlatformAdmin, revokePlatformToken } from '../../domain/platform/admins';
import {
  currentPlatformAdmin,
  platformTokenFromRequest,
  requirePlatformAdmin,
} from '../middleware/platformAuth';
import { resolveShop } from '../middleware/tenant';
import { asyncRoute } from '../middleware/errors';
import { loginBlockedMs, loginKey, registerLoginFailure, registerLoginSuccess } from '../middleware/auth';

/**
 * O painel super-admin: quem cria e desativa lojas.
 *
 * ⚠ Estas rotas NÃO passam pelo `resolveTenant`: elas vivem fora de qualquer
 * loja. Mas montar antes dele não basta para isolá-las — o Express atende
 * `/api/platform` em QUALQUER `Host` — então o primeiro middleware abaixo
 * recusa, em produção, os endereços que resolvem para uma loja.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function platformRouter(): Router {
  const router = Router();

  // Em produção o painel atende só fora dos endereços de loja. Sem isto,
  // `loja-a.dominio.com.br/api/platform/login` funciona igual ao domínio
  // raiz — e um XSS na vitrine de uma loja teria um caminho same-origin até
  // o login do super-admin.
  router.use((req, res, next) => {
    if (!config.isProduction) return next();
    const resolvida = resolveShop({ host: req.get('host') });
    if (resolvida && resolvida !== 'plataforma') {
      res.status(404).json({ error: 'Endereço não encontrado nesta API.' });
      return;
    }
    next();
  });

  /**
   * Rastro das ações do super-admin: quem fez o quê. Sem isto, um reset de PIN
   * seguido de leitura dos dados do cliente não deixava registro nenhum — nem
   * de que aconteceu. Vai para o log (stdout do Render), com o e-mail do admin.
   */
  const auditar = (req: import('express').Request, acao: string) => {
    const admin = currentPlatformAdmin(req);
    console.log(`[plataforma] admin=${admin.email} ip=${req.ip} ação=${acao}`);
  };

  // ---------- Sessão ----------
  router.post(
    '/login',
    asyncRoute(async (req, res) => {
      const parsed = loginPlataformaSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: 'Informe e-mail e senha.' });

      // Dois freios: por IP (loja 0) e por CONTA (o e-mail). Só o de IP deixava
      // um atacante de muitos IPs martelar UMA conta de admin — e uma conta
      // dessas abre a plataforma inteira. O freio por conta trava o alvo.
      const chaveIp = loginKey(0, req.ip, 'platform');
      const chaveConta = loginKey(0, `acct:${parsed.data.email.trim().toLowerCase()}`, 'platform');
      const bloqueado = Math.max(loginBlockedMs(chaveIp), loginBlockedMs(chaveConta));
      if (bloqueado > 0) {
        return res.status(429).json({
          error: `Muitas tentativas. Aguarde ${Math.ceil(bloqueado / 1000)}s e tente de novo.`,
        });
      }

      const sessao = await loginPlatformAdmin(parsed.data.email, parsed.data.password);
      if (!sessao) {
        registerLoginFailure(chaveIp);
        registerLoginFailure(chaveConta);
        // A MESMA resposta para e-mail inexistente e senha errada: separar os
        // dois diria a um atacante quais e-mails existem na plataforma.
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }
      registerLoginSuccess(chaveIp);
      registerLoginSuccess(chaveConta);
      res.json({ token: sessao.token, admin: sessao.admin });
    })
  );

  router.post('/logout', requirePlatformAdmin, (req, res) => {
    revokePlatformToken(platformTokenFromRequest(req));
    res.json({ ok: true });
  });

  router.get('/me', requirePlatformAdmin, (req, res) => {
    res.json(currentPlatformAdmin(req));
  });

  // ---------- Lojas ----------
  router.get('/shops', requirePlatformAdmin, (_req, res) => {
    // O dia começa à meia-noite LOCAL do servidor. `TZ` é do processo (Fase 10
    // dá fuso por loja); até lá, todas contam pelo mesmo relógio.
    const inicioDoDia = new Date();
    inicioDoDia.setHours(0, 0, 0, 0);
    const desde = inicioDoDia.toISOString();

    const hoje = db
      .prepare(
        `SELECT shop_id, COUNT(*) AS pedidos, COALESCE(SUM(total_cents), 0) AS centavos
         FROM orders
         WHERE created_at >= ? AND status <> 'cancelado'
         GROUP BY shop_id`
      )
      .all(desde) as { shop_id: number; pedidos: number; centavos: number }[];
    const porLoja = new Map(hoje.map((linha) => [linha.shop_id, linha]));

    const dominio = config.SHOP_BASE_DOMAIN;
    const lista: ShopStatus[] = listShops().map((shop) => {
      const dia = porLoja.get(shop.id);
      return {
        id: shop.id,
        slug: shop.slug,
        name: shop.name,
        active: shop.active,
        createdAt: shop.createdAt,
        ordersToday: dia?.pedidos ?? 0,
        revenueTodayCents: dia?.centavos ?? 0,
        mercadoPagoConnected: isMercadoPagoConnected(shop.id),
        url: shopUrl(shop.slug, dominio),
      };
    });
    res.json(lista);
  });

  router.post(
    '/shops',
    requirePlatformAdmin,
    asyncRoute(async (req, res) => {
      const parsed = novaLojaSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: describeSettingsError(parsed.error) });
      }
      const dados = parsed.data;

      let shopId: number;
      try {
        shopId = createShop(
          db,
          { slug: dados.slug, name: dados.name },
          {
            kitchenPin: dados.kitchenPin || undefined,
            settings: {
              ...(dados.city ? { city: dados.city } : {}),
              ...(dados.pixKey ? { pixKey: dados.pixKey } : {}),
            },
          }
        );
      } catch (err) {
        if (String(err).includes('UNIQUE')) {
          return res.status(409).json({ error: `O endereço "${dados.slug}" já está em uso.` });
        }
        throw err;
      }

      if (dados.brandPrimaryColor) {
        setMetaValue(shopId, 'brand_primary_color', dados.brandPrimaryColor);
      }
      // Sem isto a loja recém-criada não seria encontrada pelo `Host` até o
      // próximo restart: a resolução de tenant lê de um cache em memória.
      invalidateShopCache();

      auditar(req, `criou a loja ${shopId} (${dados.slug})`);
      const criada = shopById(shopId);
      res.status(201).json({ ...criada, url: shopUrl(dados.slug, config.SHOP_BASE_DOMAIN) });
    })
  );

  router.patch('/shops/:id', requirePlatformAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!shopById(id)) return res.status(404).json({ error: 'Loja não encontrada.' });

    const parsed = alterarLojaSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeSettingsError(parsed.error) });
    }
    const { active, name } = parsed.data;

    if (active !== undefined) {
      db.prepare('UPDATE shops SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    }
    if (name !== undefined) {
      db.prepare('UPDATE shops SET name = ? WHERE id = ?').run(name, id);
      // O nome vive em dois lugares: a linha em `shops` é administrativa, e
      // `settings.storeName` é o que o cliente lê. Mudar só um deixa o painel
      // dizendo uma coisa e a loja mostrando outra.
      setMetaValue(id, 'store_name', name);
    }
    auditar(
      req,
      `alterou a loja ${id}${active !== undefined ? ` active=${active}` : ''}${name !== undefined ? ' (renomeou)' : ''}`
    );
    invalidateShopCache();
    res.json(shopById(id));
  });

  /**
   * Redefine o PIN da cozinha de UMA loja.
   *
   * Substitui a variável de ambiente `KITCHEN_PIN_RESET`, que não sabe
   * endereçar uma loja entre várias — ela redefinia sempre a loja 1, e só no
   * boot seguinte.
   */
  router.post(
    '/shops/:id/reset-pin',
    requirePlatformAdmin,
    asyncRoute(async (req, res) => {
      const id = Number(req.params.id);
      if (!shopById(id)) return res.status(404).json({ error: 'Loja não encontrada.' });

      // Só dígitos, 4 a 8: `String({...})` vira "[object Object]" e passava
      // pelo teste de comprimento, gravando um PIN que ninguém consegue digitar.
      const pinBruto = req.body?.pin;
      const novo = typeof pinBruto === 'string' || typeof pinBruto === 'number' ? String(pinBruto).trim() : '';
      if (!/^\d{4,8}$/.test(novo)) {
        return res.status(400).json({ error: 'O PIN precisa ter de 4 a 8 números.' });
      }
      setSecret(id, 'kitchen_pin_hash', await hashPassword(novo));
      // Trocar só o PIN não cortava a sessão: o login da cozinha entrega um
      // token FIXO (`role_token_kitchen`), e quem já tinha esse token seguia
      // dentro para sempre, mesmo depois do reset. Rotacionar o token invalida
      // a sessão vazada — é o que o reset promete fazer.
      setSecret(id, 'role_token_kitchen', `tok-kitchen-${randomBytes(24).toString('hex')}`);
      auditar(req, `redefiniu o PIN da cozinha da loja ${id}`);
      res.json({ ok: true });
    })
  );

  return router;
}
