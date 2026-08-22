import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Server } from 'socket.io';
import type { Order } from '../../../contract/order/types';
import { settlePayment } from '../../payment';
import { runBackup } from '../../backup';
import { disconnectMercadoPago, finishOAuth, getPublicKey, isMercadoPagoConnected, isTestMode, parseWebhookPaymentId, publicBaseUrl, saveManualAccessToken, savePublicKey, startOAuth, verifyWebhookSignature } from '../../mercadopago';
import { requireStaff } from '../middleware/auth';
import { shopIdOf } from '../middleware/tenant';
import { asyncRoute } from '../middleware/errors';

/**
 * Mercado Pago (OAuth e webhook) e backup manual.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function paymentsRouter(io: Server): Router {
  const router = Router();

  // ---------- Mercado Pago (OAuth + webhook PIX) ----------
  router.get('/mercadopago/connect', requireStaff('kitchen'), (req, res) => {
    try {
      const host = req.get('host') || undefined;
      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
      res.json(startOAuth(shopIdOf(req), host, proto));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Não foi possível iniciar o OAuth.' });
    }
  });

  router.get('/mercadopago/callback', asyncRoute(async (req, res) => {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const host = req.get('host') || undefined;
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const front = publicBaseUrl(host, proto);
    try {
      if (!code || !state) throw new Error('Código OAuth ausente.');
      await finishOAuth(code, state, host, proto);
      res.redirect(`${front}/cozinha?mp=ok`);
    } catch (err) {
      const msg = encodeURIComponent(err instanceof Error ? err.message : 'Falha no Mercado Pago');
      res.redirect(`${front}/cozinha?mp=erro&reason=${msg}`);
    }
  }));

  router.post('/mercadopago/disconnect', requireStaff('kitchen'), (req, res) => {
    disconnectMercadoPago(shopIdOf(req));
    res.json({ ok: true, mercadoPagoConnected: false });
  });

  router.post('/mercadopago/token', requireStaff('kitchen'), (req, res) => {
    try {
      const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
      const publicKey = typeof req.body?.publicKey === 'string' ? req.body.publicKey : null;
      // Um número solto (`{accessToken: 12345}`) é truthy mas não é string:
      // antes ele pulava as duas gravações E o erro, e a cozinha via "ok" com
      // nada salvo. Agora só uma string de verdade conta como informada.
      if (!accessToken && publicKey === null) {
        return res.status(400).json({ error: 'Informe o Access Token ou a chave pública.' });
      }
      if (accessToken) saveManualAccessToken(shopIdOf(req), accessToken);
      if (publicKey !== null) savePublicKey(shopIdOf(req), publicKey);
      res.json({
        ok: true,
        mercadoPagoConnected: isMercadoPagoConnected(shopIdOf(req)),
        mercadoPagoTestMode: isTestMode(shopIdOf(req)),
        mercadoPagoPublicKey: getPublicKey(shopIdOf(req)),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'O token não foi salvo. Confira o Access Token e tente de novo.' });
    }
  });

  /**
   * O webhook do Mercado Pago.
   *
   * A LOJA já foi resolvida pelo `Host` — o `notification_url` de cada cobrança
   * é montado com o host da loja que cobrou (`publicBaseUrl`, que agora prefere
   * o `Host` da requisição justamente por isto). Então quando o MP chama de
   * volta, ele chama no endereço daquela loja e o `middleware/tenant.ts` já fez
   * o trabalho.
   *
   * A ordem importa e é esta:
   *
   * 1. Loja do `Host` (feito pelo middleware, antes daqui).
   * 2. Assinatura conferida com o segredo DAQUELA loja.
   * 3. Consulta à API do MP com o token DAQUELA loja.
   * 4. `settlePayment` confere que o pedido é mesmo daquela loja.
   *
   * O passo 4 é defesa em profundidade: mesmo com a loja certa no `Host` e a
   * assinatura válida, um `external_reference` apontando para pedido de outra
   * loja não pode quitar nada.
   */
  const handleMpWebhook = async (req: Request, res: Response) => {
    const shopId = shopIdOf(req);
    const paymentId = parseWebhookPaymentId(req.body, req.query as Record<string, unknown>);
    if (
      !verifyWebhookSignature(
        shopId,
        req.headers['x-signature'] as string | undefined,
        req.headers['x-request-id'] as string | undefined,
        paymentId || ''
      )
    ) {
      return res.status(401).json({ error: 'Assinatura do webhook inválida.' });
    }
    // Responde 200 antes de liquidar: o Mercado Pago reenvia o webhook quando a
    // resposta demora, e um reenvio no meio da liquidação vira trabalho dobrado.
    res.status(200).json({ ok: true });
    if (!paymentId) return;
    try {
      await settlePayment(io, { source: 'mercadopago', shopId, paymentId });
    } catch (err) {
      console.error('Webhook do Mercado Pago falhou ao liquidar o pagamento:', err);
    }
  };
  router.post('/mercadopago/webhook', asyncRoute(handleMpWebhook));
  router.get('/mercadopago/webhook', asyncRoute(handleMpWebhook));

  // ---------- Backup manual ----------
  router.post(
    '/backup/run',
    requireStaff('kitchen'),
    asyncRoute(async (req, res) => {
      const result = await runBackup(shopIdOf(req));
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true });
    })
  );

  return router;
}
