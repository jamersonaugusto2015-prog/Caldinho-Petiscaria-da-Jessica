import { Router, Request, Response, NextFunction } from 'express';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  db,
  getSettings,
  getRoleToken,
} from './db';
import { verifyPassword, hashPassword } from './auth';
import { normalizePixKey, validatePixKey } from '../src/shared/pix';
import { runBackup } from './backup';
import { UPLOADS_DIR } from './paths';
import {
  CancelActor,
  Order,
  OrderStatus,
  ChatMessage,
  Driver,
  SizeOption,
} from '../src/types';
import { isStoreOpen } from '../src/shared/geo';
import {
  startOAuth,
  finishOAuth,
  disconnectMercadoPago,
  isOAuthConfigured,
  isMercadoPagoConnected,
  mercadoPagoUserId,
  isTestMode,
  saveManualAccessToken,
  getPublicKey,
  savePublicKey,
  parseWebhookPaymentId,
  verifyWebhookSignature,
  publicBaseUrl,
} from './mercadopago';
import { emitOrder, orderEventContext } from './orderEvents';
import {
  deletePushSubscription,
  isPushSubscription,
  pushPublicKey,
  savePushSubscription,
  sendChatPush,
} from './push';
import {
  currentDriver,
  driverFromRequest,
  issueDriverToken,
  publicDriver,
  requireDriver,
  revokeDriverTokens,
  tokenFromRequest,
} from './driverSession';
import { orderForDriver } from './orderViews';
import {
  getOrder,
  insertOrderWithBeforeInsert,
  listAllOrders,
  listOrdersByCustomer,
  loadDriver,
  loadProduct,
  saveOrder,
} from './orderStore';
import { consumeFreeItems, earnStamp, getCustomerStamps, hasFreeRedeem, redeemFreeCaldinho } from './loyalty';
import { liveOrderPaymentAdapter, refundPayment, settlePayment } from './payment';
import { applyOrderEvent } from './orderLifecycle';
import { cancelOrder, defaultCancelReason } from './cancellation';
import { DomainError } from './errors';
import {
  createPromotion,
  deletePromotion,
  listPromotions,
  registerPromotionUses,
  resetPromotionUses,
  updatePromotion,
} from './promotions';
import { createOrderIntake } from './orderIntake';
import type { OrderIntakeInput } from './orderIntake';
import {
  createCategory,
  createProduct,
  deleteCategory,
  deleteCoupon,
  deleteProduct,
  listCategories,
  listCoupons,
  listCouponsSorted,
  listProducts,
  saveCoupon,
  setCaldinhoDoDia,
  clearCaldinhoDoDia,
  updateCategory,
  updateProduct,
} from './catalog';
import { buildRevenueTrends, buildSalesReport } from './reports';
import { geoThrottle, nominatimSearch, viaCepLookup } from './geocode';

export { emitOrder } from './orderEvents';

// Express 4 não encaminha rejeições de handlers async para o error middleware
// sozinho — sem isso, um throw dentro de um `async (req, res) => {}` derruba o
// processo inteiro (Node >=15 termina em unhandledRejection). Todo handler
// async da API deve passar por aqui.
type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const asyncRoute =
  (fn: AsyncRouteHandler) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err);
  if (err instanceof DomainError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('Erro não tratado numa rota:', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
}

// ---------- Rate limit + lockout de login (por IP + papel) ----------
type LoginAttempt = { count: number; firstAt: number; lockedUntil: number; lockStrikes: number };
const loginAttempts = new Map<string, LoginAttempt>();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BASE_LOCKOUT_MS = 30 * 1000;
const LOGIN_MAX_LOCKOUT_MS = 15 * 60 * 1000;

function pruneLoginAttempts(): void {
  if (loginAttempts.size < 5000) return;
  const now = Date.now();
  for (const [key, entry] of loginAttempts) {
    if (entry.lockedUntil < now && now - entry.firstAt > LOGIN_WINDOW_MS) loginAttempts.delete(key);
  }
}

function loginBlockedMs(key: string): number {
  const entry = loginAttempts.get(key);
  if (!entry) return 0;
  const now = Date.now();
  return entry.lockedUntil > now ? entry.lockedUntil - now : 0;
}

function registerLoginFailure(key: string): void {
  const now = Date.now();
  let entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    entry = { count: 0, firstAt: now, lockedUntil: 0, lockStrikes: 0 };
  }
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.lockStrikes += 1;
    entry.lockedUntil = now + Math.min(LOGIN_BASE_LOCKOUT_MS * 2 ** (entry.lockStrikes - 1), LOGIN_MAX_LOCKOUT_MS);
    entry.count = 0;
    entry.firstAt = now;
  }
  loginAttempts.set(key, entry);
  pruneLoginAttempts();
}

function registerLoginSuccess(key: string): void {
  loginAttempts.delete(key);
}

/**
 * O papel `kitchen` continua vindo do token de papel compartilhado; `driver`
 * vem da credencial pessoal do motoboy. Assim quem passa aqui como motoboy é
 * sempre um motoboy identificado, e a rota lê a identidade de
 * `currentDriver(res)` em vez de aceitar um `driverId` do cliente.
 *
 * O header vazio nunca autentica: `getRoleToken` devolve '' enquanto o papel
 * não tem token gravado, e a comparação `'' === ''` liberava a rota para
 * qualquer requisição sem header.
 */
const requireRole = (roles: 'kitchen' | 'driver' | ('kitchen' | 'driver')[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const list = Array.isArray(roles) ? roles : [roles];
    const token = tokenFromRequest(req);
    if (token && list.includes('kitchen') && token === getRoleToken('kitchen')) return next();
    if (list.includes('driver')) {
      const driver = driverFromRequest(req);
      if (driver) {
        res.locals.driver = driver;
        return next();
      }
    }
    res.status(401).json({ error: 'Não autorizado. Faça login com o PIN correto.' });
  };
};

function roleOf(req: Request): 'kitchen' | 'driver' | null {
  const token = tokenFromRequest(req);
  if (token && token === getRoleToken('kitchen')) return 'kitchen';
  if (driverFromRequest(req)) return 'driver';
  return null;
}

export function createRoutes(io: Server): Router {
  const router = Router();
  const orderIntake = createOrderIntake({
    settings: getSettings,
    loadProduct,
    listCoupons,
    listPromotions,
    listProducts,
    registerPromotionUses: (applied, total) => registerPromotionUses(applied ?? [], total),
    payment: liveOrderPaymentAdapter,
    peekFreeRedeem: hasFreeRedeem,
    consumeFreeItems,
    persistOrder: insertOrderWithBeforeInsert,
    getLoyaltyPoints: getCustomerStamps,
  });

  // ---------- Health check ----------
  router.get('/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // ---------- Push (o aviso que atravessa o app fechado) ----------
  // A chave pública é pública mesmo: sem ela o navegador não consegue nem pedir
  // permissão, e ela não autoriza ninguém a enviar nada.
  router.get('/push/key', (_req, res) => {
    res.json({ key: pushPublicKey() });
  });

  /**
   * A SALA É DECIDIDA AQUI, nunca lida do corpo (ADR-0009). Um `room` vindo do
   * cliente seria a chave da sala privada de qualquer motoboy — o contato do
   * cliente da corrida entregue no celular de quem pedisse.
   */
  router.post('/push/subscribe', (req, res) => {
    const subscription = req.body?.subscription;
    if (!isPushSubscription(subscription)) {
      return res.status(400).json({ error: 'Inscrição de push inválida.' });
    }

    const token = tokenFromRequest(req);
    if (token && token === getRoleToken('kitchen')) {
      savePushSubscription({ room: 'kitchen', role: 'kitchen', subscription });
      return res.status(201).json({ ok: true, rooms: ['kitchen'] });
    }

    const driver = driverFromRequest(req);
    if (driver) {
      // Uma linha só, na sala privada: o endpoint é o navegador e o navegador é
      // um só. A sala compartilhada `drivers` é derivada do papel na hora do
      // envio, então o motoboy fica nas duas sem receber em dobro.
      savePushSubscription({ room: `driver:${driver.id}`, role: 'driver', subscription });
      return res.status(201).json({ ok: true, rooms: ['drivers', `driver:${driver.id}`] });
    }

    // Mesmo trim + corte de 80 que o `join` do socket aplica: as duas portas
    // precisam gerar exatamente a mesma sala, senão o cliente se inscreve num
    // canal onde o evento nunca cai.
    const customerId = String(req.body?.customerId || '').trim().slice(0, 80);
    if (!customerId || customerId === 'anon') {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    savePushSubscription({ room: `customer:${customerId}`, role: 'client', subscription });
    return res.status(201).json({ ok: true, rooms: [`customer:${customerId}`] });
  });

  // Sem token: quem tem o endpoint é o dono do navegador que o gerou, e apagar
  // a própria inscrição não expõe nada de ninguém.
  router.post('/push/unsubscribe', (req, res) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
    if (!endpoint) return res.status(400).json({ error: 'Endpoint inválido.' });
    deletePushSubscription(endpoint);
    res.json({ ok: true });
  });

  // ---------- Auth ----------
  router.post(
    '/auth/login',
    asyncRoute(async (req, res) => {
    const { role, pin } = req.body ?? {};
    if (role !== 'kitchen' && role !== 'driver') {
      return res.status(400).json({ error: 'Papel inválido.' });
    }

    // No papel driver a chave do rate-limit leva o nome informado: com
    // `${ip}:driver` um motoboy errando a senha trancava a equipe inteira, já
    // que todos saem pelo mesmo Wi-Fi da loja.
    const loginName = typeof req.body?.name === 'string' ? req.body.name.trim().toLowerCase() : '';
    const attemptKey =
      role === 'driver'
        ? `${req.ip || 'unknown'}:driver:${loginName}`
        : `${req.ip || 'unknown'}:${role}`;
    const blockedMs = loginBlockedMs(attemptKey);
    if (blockedMs > 0) {
      return res.status(429).json({
        error: `Muitas tentativas. Aguarde ${Math.ceil(blockedMs / 1000)}s e tente de novo.`,
      });
    }

    if (role === 'driver') {
      const rows = db.prepare('SELECT data FROM drivers').all() as { data: string }[];
      const drivers = rows.map((r) => JSON.parse(r.data) as Driver);

      let driver: Driver | undefined;
      if (loginName) {
        // Cadastro antigo pode ter vindo sem nome: `.toLowerCase()` num
        // undefined derrubaria o login de todo mundo, não só o dele.
        driver = drivers.find(
          (d) => d.active && typeof d.name === 'string' && d.name.toLowerCase() === loginName
        );
      }
      if (driver && (await verifyPassword(String(pin ?? ''), driver.password || ''))) {
        registerLoginSuccess(attemptKey);
        // Credencial própria do motoboy: o token diz QUEM é, não só que é um
        // motoboy. É o que permite revogar o acesso de um só ao demitir.
        const token = issueDriverToken(driver.id);
        return res.json({ token, role, driver: publicDriver(driver) });
      }
      registerLoginFailure(attemptKey);
      return res.status(401).json({
        error: !loginName
          ? 'Informe seu nome de motoboy.'
          : 'Nome ou senha incorretos. Verifique com a cozinha.',
      });
    }

    const pinHash = (
      db.prepare("SELECT value FROM meta WHERE key = 'kitchen_pin_hash'").get() as
        | { value: string }
        | undefined
    )?.value;
    if (await verifyPassword(String(pin ?? ''), pinHash || '')) {
      registerLoginSuccess(attemptKey);
      return res.json({ token: getRoleToken('kitchen'), role });
    }
    registerLoginFailure(attemptKey);
    res.status(401).json({ error: 'PIN incorreto. Tente novamente.' });
  })
  );

  // ---------- Upload de imagem ou áudio (base64) ----------
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  router.post('/upload', requireRole('kitchen'), (req, res) => {
    const { dataUrl, filename } = req.body ?? {};
    if (typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'Arquivo inválido.' });
    }
    const isImage = /^data:image\/(png|jpe?g|webp|gif);base64,/.test(dataUrl);
    const isAudio = /^data:audio\/(mpeg|mp3|wav|x-wav|ogg|webm);base64,/.test(dataUrl);
    if (!isImage && !isAudio) {
      return res.status(400).json({
        error: 'Formato inválido. Imagens: png/jpeg/webp/gif. Áudio: mp3/wav/ogg/webm.',
      });
    }

    const match = dataUrl.match(/^data:(image|audio)\/([\w.+-]+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Arquivo inválido.' });

    const rawExt = match[2].toLowerCase().replace('x-', '').replace('mpeg', 'mp3');
    const allowedExt = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp3', 'wav', 'ogg', 'webm'];
    const ext = rawExt === 'jpeg' ? 'jpg' : allowedExt.includes(rawExt) ? rawExt : 'bin';
    if (ext === 'bin') return res.status(400).json({ error: 'Extensão não permitida.' });

    const buffer = Buffer.from(match[3], 'base64');
    const maxBytes = 15 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return res.status(400).json({ error: 'Arquivo muito grande (máx. 15 MB).' });
    }

    const safeName = (typeof filename === 'string' && filename.trim() ? filename.trim() : 'upload')
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .slice(0, 40);
    const name = `${Date.now()}-${safeName}.${ext}`;

    try {
      fs.writeFileSync(path.join(UPLOADS_DIR, name), buffer);
      res.status(201).json({ url: `/api/uploads/${name}` });
    } catch {
      res.status(500).json({ error: 'Falha ao salvar o arquivo.' });
    }
  });

  // ---------- Geocodificação e CEP ----------
  router.post('/geocode', async (req, res) => {
    const query = String(req.body?.query ?? '').trim();
    if (!query) return res.status(400).json({ error: 'Informe um endereço para localizar.' });
    if (geoThrottle.shouldThrottle(req.ip || 'unknown', 6, 10000)) {
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
  });

  router.get('/cep/:cep', async (req, res) => {
    const cep = String(req.params.cep ?? '').replace(/\D/g, '').slice(0, 8);
    if (cep.length !== 8) return res.status(400).json({ error: 'CEP inválido.' });
    if (geoThrottle.shouldThrottle(req.ip || 'unknown', 10, 10000)) {
      return res.status(429).json({ error: 'Muitas consultas. Aguarde alguns segundos.' });
    }
    try {
      const result = await viaCepLookup(cep);
      if (!result) return res.status(404).json({ error: 'CEP não encontrado.' });
      res.json(result);
    } catch {
      res.status(502).json({ error: 'Serviço de CEP indisponível. Preencha manualmente.' });
    }
  });

  // ---------- Categorias (editáveis no painel) ----------
  router.get('/categories', (_req, res) => {
    res.json(listCategories());
  });

  router.post('/categories', requireRole('kitchen'), (req, res) => {
    const cat = createCategory(req.body ?? {});
    io.emit('categories:updated');
    res.status(201).json(cat);
  });

  router.patch('/categories/:id', requireRole('kitchen'), (req, res) => {
    const cat = updateCategory(req.params.id, req.body ?? {});
    io.emit('categories:updated');
    res.json(cat);
  });

  router.delete('/categories/:id', requireRole('kitchen'), (req, res) => {
    deleteCategory(req.params.id);
    io.emit('categories:updated');
    res.json({ ok: true });
  });

  // ---------- Products ----------
  router.get('/products', (_req, res) => {
    res.json(listProducts());
  });

  router.post('/products', requireRole('kitchen'), (req, res) => {
    const p = createProduct(req.body);
    io.emit('products:updated');
    res.json(p);
  });

  router.patch('/products/:id', requireRole('kitchen'), (req, res) => {
    const p = updateProduct(req.params.id, req.body ?? {});
    io.emit('products:updated');
    res.json(p);
  });

  router.delete('/products/:id', requireRole('kitchen'), (req, res) => {
    deleteProduct(req.params.id);
    io.emit('products:updated');
    res.json({ ok: true });
  });

  router.post('/products/:id/caldinho-do-dia', requireRole('kitchen'), (req, res) => {
    setCaldinhoDoDia(req.params.id);
    io.emit('products:updated');
    res.json({ ok: true });
  });

  router.delete('/products/:id/caldinho-do-dia', requireRole('kitchen'), (_req, res) => {
    clearCaldinhoDoDia();
    io.emit('products:updated');
    res.json({ ok: true });
  });

  // ---------- Orders ----------
  router.get('/orders', (req, res) => {
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId.trim() : '';

    if (roleOf(req) === 'kitchen') {
      return res.json(listAllOrders());
    }

    // O motoboy é avaliado antes do ramo do cliente: senão bastaria mandar um
    // `customerId` na query para sair pela rota do cliente e receber o pedido
    // inteiro, sem redação.
    const driver = driverFromRequest(req);
    if (driver) {
      // O `driverId` da query é ignorado de propósito: a identidade vem da
      // credencial, nunca da entrada.
      const orders = listAllOrders()
        .filter(
          (o) =>
            (o.status === 'pronto' && !o.driverId && o.fulfillment !== 'pickup') ||
            o.driverId === driver.id
        )
        .map((o) => orderForDriver(o, driver.id));
      return res.json(orders);
    }

    // O `customerId` é um UUID aleatório do dispositivo: funciona como
    // capability, quem não o tem não chega aos pedidos.
    if (customerId && customerId !== 'anon') {
      return res.json(listOrdersByCustomer(customerId));
    }

    return res.status(401).json({ error: 'Não autorizado.' });
  });

  router.post('/orders', async (req, res) => {
    const host = req.get('host') || undefined;
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const notificationUrl = `${publicBaseUrl(host, proto)}/api/mercadopago/webhook`;
    try {
      const result = await orderIntake.placeOrder({
        ...((req.body ?? {}) as OrderIntakeInput),
        notificationUrl,
      });
      emitOrder(io, 'order:new', result.order);
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof DomainError) {
        return res.status(err.status).json({ error: err.message });
      }
      res.status(500).json({ error: 'Não foi possível criar o pedido.' });
    }
  });

  const getOrderOr404 = (id: string): Order | null => getOrder(id);

  const applyMpPayment = (paymentId: string): Promise<Order | null> =>
    settlePayment(io, { source: 'mercadopago', paymentId });

  router.patch('/orders/:id/status', requireRole(['kitchen', 'driver']), (req, res) => {
    const order = getOrderOr404(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    // `requireRole` já resolveu o motoboy: se há um em `res.locals`, quem
    // chama é ele. O `driverId` do corpo é ignorado.
    const driver = (res.locals.driver as Driver | undefined) ?? null;
    const actor = driver ? 'driver' : 'kitchen';
    try {
      const result = applyOrderEvent(
        order,
        {
          type: 'advance',
          status: req.body?.status as OrderStatus,
          actor,
          driverId: driver?.id,
        },
        { getSettings, getDriver: loadDriver, saveOrder, earnStamp }
      );
      if (result.loyaltyPoints !== undefined && result.order.customerId) {
        io.to(`customer:${result.order.customerId}`).emit('loyalty:updated', {
          customerId: result.order.customerId,
          points: result.loyaltyPoints,
        });
      }
      emitOrder(io, 'order:updated', result.order, orderEventContext(order));
      res.json(driver ? orderForDriver(result.order, driver.id) : result.order);
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Não foi possível atualizar o pedido.' });
    }
  });

  // Aceitar corrida + iniciar rota (entregador)
  router.post('/orders/:id/assign', requireDriver, (req, res) => {
    const order = getOrderOr404(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const driver = currentDriver(res);
    try {
      const result = applyOrderEvent(
        order,
        { type: 'assign', driverId: driver.id },
        { getSettings, getDriver: loadDriver, saveOrder, earnStamp }
      );
      emitOrder(io, 'order:updated', result.order, orderEventContext(order));
      res.json(orderForDriver(result.order, driver.id));
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Não foi possível aceitar a corrida.' });
    }
  });

  // Confirmar pagamento (cozinha) — PIX pendente
  router.patch(
    '/orders/:id/payment',
    requireRole('kitchen'),
    asyncRoute(async (req, res) => {
      // A recusa de um pedido cancelado vem como DomainError e precisa chegar
      // à cozinha com o texto certo, por isso o erro segue para o errorHandler.
      const order = await settlePayment(io, {
        source: 'kitchen',
        orderId: req.params.id,
        confirmedBy: `kitchen:${req.ip || 'desconhecido'}`,
      });
      if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
      res.json(order);
    })
  );

  // O cliente consulta esta rota a cada poucos segundos enquanto espera o PIX:
  // uma falha do Mercado Pago aqui não pode virar rejeição não tratada.
  router.get(
    '/orders/:id/pix-status',
    asyncRoute(async (req, res) => {
      const order = getOrderOr404(req.params.id);
      if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
      const role = roleOf(req);
      const customerId = String(req.query.customerId || '').trim();
      if (role !== 'kitchen' && (!customerId || customerId !== order.customerId)) {
        return res.status(401).json({ error: 'Não autorizado.' });
      }
      // Num pedido cancelado nem chegamos ao Mercado Pago: consultar a cobrança
      // só serviria para liquidar dinheiro que não tem mais pedido por trás.
      if (
        order.status !== 'cancelado' &&
        order.payment.method === 'pix' &&
        !order.payment.isPaid &&
        order.payment.mpPaymentId
      ) {
        try {
          const updated = await applyMpPayment(order.payment.mpPaymentId);
          if (updated) return res.json(updated);
        } catch (err) {
          console.error('Falha ao consultar o pagamento no Mercado Pago:', err);
        }
      }
      res.json(order);
    })
  );

  // Cancelar pedido (cliente só em "recebido"; cozinha a qualquer momento antes de entregar)
  router.post('/orders/:id/cancel', (req, res) => {
    const order = getOrderOr404(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const isKitchen = roleOf(req) === 'kitchen';
    const customerId = String(req.body?.customerId || '').trim();
    if (!isKitchen) {
      if (!customerId || customerId !== order.customerId) {
        return res.status(401).json({ error: 'Não autorizado.' });
      }
      if (order.status !== 'recebido') {
        return res.status(400).json({ error: 'O pedido já está em preparo e não pode ser cancelado pelo cliente.' });
      }
    }
    const by: CancelActor = isKitchen ? 'loja' : 'cliente';
    const reason = String(req.body?.reason || '').trim() || defaultCancelReason(by);
    try {
      res.json(cancelOrder(io, { order, reason, by }));
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Não foi possível cancelar o pedido.' });
    }
  });

  // O cliente pede o cancelamento de um pedido que já está em preparo
  router.post('/orders/:id/cancel-request', (req, res) => {
    const order = getOrderOr404(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const customerId = String(req.body?.customerId || '').trim();
    if (!customerId || customerId !== order.customerId) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    try {
      const result = applyOrderEvent(
        order,
        { type: 'request-cancel', reason: String(req.body?.reason || '') },
        { getSettings, getDriver: loadDriver, saveOrder, earnStamp }
      );
      emitOrder(io, 'order:updated', result.order, orderEventContext(order));
      res.json(result.order);
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Não foi possível enviar o pedido de cancelamento.' });
    }
  });

  // A cozinha responde ao pedido de cancelamento
  router.post('/orders/:id/cancel-request/resolve', requireRole('kitchen'), (req, res) => {
    const order = getOrderOr404(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const accept = req.body?.accept === true;
    const note = typeof req.body?.note === 'string' ? req.body.note : undefined;
    try {
      // O lifecycle registra a resposta; aceitar continua no cancellation.ts,
      // que é quem cuida de selo, devolução e do emit único.
      const result = applyOrderEvent(
        order,
        { type: 'resolve-cancel', accept, note },
        { getSettings, getDriver: loadDriver, saveOrder, earnStamp }
      );
      if (!accept) {
        emitOrder(io, 'order:updated', result.order, orderEventContext(order));
        return res.json(result.order);
      }
      const reason = result.order.cancellationRequest?.reason || defaultCancelReason('loja');
      // `before` é o pedido com a solicitação ainda pendente: é o que faz o
      // alerta "Cancelamento aceito" existir para o cliente.
      res.json(cancelOrder(io, { order: result.order, reason, by: 'loja', before: order }));
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Não foi possível responder ao pedido de cancelamento.' });
    }
  });

  // A cozinha devolve o dinheiro de um pedido cancelado que já estava pago
  router.post(
    '/orders/:id/refund',
    requireRole('kitchen'),
    asyncRoute(async (req, res) => {
      const order = await refundPayment(io, {
        orderId: req.params.id,
        by: `kitchen:${req.ip || 'desconhecido'}`,
      });
      if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
      res.json(order);
    })
  );

  // Reclamação pós-entrega: fica no pedido e no chat que já existe
  router.post('/orders/:id/complaint', (req, res) => {
    const order = getOrderOr404(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const customerId = String(req.body?.customerId || '').trim();
    if (!customerId || customerId !== order.customerId) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    try {
      const result = applyOrderEvent(
        order,
        { type: 'complain', text: String(req.body?.text || '') },
        { getSettings, getDriver: loadDriver, saveOrder, earnStamp }
      );
      const message: ChatMessage = {
        id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        orderId: req.params.id,
        sender: 'client',
        senderName: result.order.customerName || 'Cliente',
        text: result.order.complaint!.text,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      };
      db.prepare('INSERT INTO chat_messages (order_id, data) VALUES (?, ?)').run(
        req.params.id,
        JSON.stringify(message)
      );
      io.to('kitchen').to('drivers').to(`customer:${order.customerId}`).emit('chat:message', message);
      // Sem push do chat aqui: a reclamação já tem alerta próprio na tabela, e
      // os dois juntos notificariam a cozinha duas vezes pelo mesmo toque.
      emitOrder(io, 'order:updated', result.order, orderEventContext(order));
      res.status(201).json(result.order);
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Não foi possível registrar a reclamação.' });
    }
  });

  router.post('/orders/:id/complaint/resolve', requireRole('kitchen'), (req, res) => {
    const order = getOrderOr404(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    try {
      const result = applyOrderEvent(
        order,
        { type: 'resolve-complaint' },
        { getSettings, getDriver: loadDriver, saveOrder, earnStamp }
      );
      emitOrder(io, 'order:updated', result.order, orderEventContext(order));
      res.json(result.order);
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Não foi possível resolver a reclamação.' });
    }
  });

  router.post('/orders/:id/rating', (req, res) => {
    const order = getOrderOr404(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const customerId = String(req.body?.customerId || '').trim();
    if (!customerId || customerId !== order.customerId) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    try {
      const result = applyOrderEvent(order, {
        type: 'rate',
        rating: Number(req.body?.rating),
        comment: typeof req.body?.comment === 'string' ? req.body.comment : undefined,
      }, { getSettings, getDriver: loadDriver, saveOrder, earnStamp });
      emitOrder(io, 'order:updated', result.order, orderEventContext(order));
      res.json(result.order);
    } catch (err) {
      if (err instanceof DomainError) return res.status(err.status).json({ error: err.message });
      res.status(500).json({ error: 'Não foi possível registrar a avaliação.' });
    }
  });

  // ---------- Relatórios (agregação real no servidor) ----------
  router.get('/reports', requireRole('kitchen'), (req, res) => {
    const report = buildSalesReport(listAllOrders(), {
      from: String(req.query.from || ''),
      to: String(req.query.to || ''),
    });
    res.json(report);
  });

  // ---------- Tendências de faturamento (diário/semanal/mensal) ----------
  router.get('/reports/trends', requireRole('kitchen'), (_req, res) => {
    res.json(buildRevenueTrends(listAllOrders()));
  });

  // ---------- Chat ----------
  const canAccessOrderChat = (req: Request, order: Order): boolean => {
    if (roleOf(req) === 'kitchen') return true;
    // Liberar o chat para qualquer motoboy fazia da rota um dump de nome,
    // telefone e endereço por `orderId`. Só o dono da corrida entra.
    const driver = driverFromRequest(req);
    if (driver) return order.driverId === driver.id;
    const customerId = String(req.body?.customerId || req.query.customerId || '').trim();
    return !!customerId && customerId === order.customerId;
  };

  router.get('/orders/:id/chat', (req, res) => {
    const order = getOrderOr404(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    if (!canAccessOrderChat(req, order)) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    const rows = db
      .prepare('SELECT data FROM chat_messages WHERE order_id = ? ORDER BY id')
      .all(req.params.id) as { data: string }[];
    res.json(rows.map((r) => JSON.parse(r.data) as ChatMessage));
  });

  router.post('/orders/:id/chat', (req, res) => {
    const order = getOrderOr404(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    if (!canAccessOrderChat(req, order)) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    const { sender, senderName, text } = req.body ?? {};
    if (!sender || !text) return res.status(400).json({ error: 'Mensagem inválida.' });

    const role = roleOf(req);
    const safeSender =
      role === 'kitchen' ? 'store' : role === 'driver' ? 'driver' : 'client';

    const message: ChatMessage = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      orderId: req.params.id,
      sender: safeSender,
      senderName: String(senderName || '').trim() || 'Cliente',
      text: String(text).slice(0, 500),
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    db.prepare('INSERT INTO chat_messages (order_id, data) VALUES (?, ?)').run(
      req.params.id,
      JSON.stringify(message)
    );
    // A sala `drivers` é o time inteiro: mandar para lá espalhava o nome e o
    // texto do cliente para motoboys que não têm nada com a corrida.
    let target = io.to('kitchen').to(`customer:${order.customerId}`);
    if (order.driverId) target = target.to(`driver:${order.driverId}`);
    target.emit('chat:message', message);
    // O chat só alcançava quem estava com a aba aberta: uma pergunta do cliente
    // ficava sem resposta até alguém voltar à tela.
    sendChatPush(order, message);
    res.status(201).json(message);
  });

  // ---------- Fidelidade (por cliente/dispositivo) ----------
  router.get('/loyalty', (req, res) => {
    const customerId = String(req.query.customerId || '').trim();
    if (!customerId || customerId === 'anon') {
      return res.status(400).json({ error: 'Cliente inválido.' });
    }
    res.json({ points: getCustomerStamps(customerId) });
  });

  router.post('/loyalty/redeem', (req, res) => {
    const customerId = String(req.body?.customerId || '').trim();
    const productId = String(req.body?.productId || '');
    // O selo só pode ser gasto se o brinde puder entrar num carrinho agora:
    // com a loja fechada o cliente perderia os selos sem receber nada.
    if (!isStoreOpen(getSettings())) {
      return res.status(409).json({ error: 'A loja está fechada. Resgate seu brinde quando ela abrir.' });
    }
    try {
      const result = redeemFreeCaldinho(customerId, productId);
      io.to(`customer:${customerId}`).emit('loyalty:updated', {
        customerId,
        points: result.points,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof DomainError) {
        return res.status(err.status).json({ error: err.message });
      }
      res.status(400).json({ error: 'Não foi possível resgatar.' });
    }
  });

  // ---------- Settings / Configurações ----------
  const backupMeta = (key: string, fallback = '') =>
    (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined)?.value ?? fallback;

  router.get('/settings', (req, res) => {
    const settings = getSettings();
    const pinHash = (
      db.prepare("SELECT value FROM meta WHERE key = 'kitchen_pin_hash'").get() as
        | { value: string }
        | undefined
    )?.value;
    const isKitchen = roleOf(req) === 'kitchen';
    const mpConnected = isMercadoPagoConnected();
    const publicSettings = {
      ...settings,
      kitchenPinSet: isKitchen ? !!pinHash : false,
      isOpen: isStoreOpen(settings),
      pixEnabled: !!(settings.pixKey || mpConnected),
      mercadoPagoConnected: mpConnected,
      mercadoPagoOAuthReady: isOAuthConfigured(),
      mercadoPagoTestMode: isTestMode(),
      mercadoPagoPublicKey: getPublicKey(),
      mercadoPagoUserId: isKitchen ? mercadoPagoUserId() : '',
      backupEnabled: false,
      backupFrequencyDays: 1,
      backupFolderId: '',
      backupKeySet: false,
      backupLastRun: '',
      backupLastStatus: '',
      backupLastFile: '',
    };
    if (!isKitchen) {
      return res.json(publicSettings);
    }
    res.json({
      ...publicSettings,
      kitchenPinSet: !!pinHash,
      backupEnabled: backupMeta('backup_enabled', 'true') === 'true',
      backupFrequencyDays: Number(backupMeta('backup_frequency_days', '1')) || 1,
      backupFolderId: backupMeta('backup_folder_id'),
      backupKeySet: !!backupMeta('backup_service_account'),
      backupLastRun: backupMeta('backup_last_run'),
      backupLastStatus: backupMeta('backup_last_status'),
      backupLastFile: backupMeta('backup_last_file'),
    });
  });

  router.post(
    '/settings',
    requireRole('kitchen'),
    asyncRoute(async (req, res) => {
    const b = req.body ?? {};
    const upsert = db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    const num = (v: unknown, fallback?: number): number | undefined => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    // Toda validação acontece ANTES do primeiro upsert: se um campo for recusado
    // no meio da gravação, o resto já teria sido salvo e o painel mostraria erro
    // com metade das configurações alteradas.
    const newPin = typeof b.kitchenPin === 'string' ? b.kitchenPin.trim() : '';
    if (newPin && newPin.length < 4) {
      return res.status(400).json({ error: 'O PIN da cozinha precisa ter pelo menos 4 caracteres.' });
    }
    if (typeof b.pixKey === 'string' && b.pixKey.trim()) {
      const pixErr = validatePixKey(b.pixKey);
      if (pixErr) return res.status(400).json({ error: pixErr });
    }

    if (typeof b.storeName === 'string') upsert.run('store_name', b.storeName.trim());
    if (typeof b.city === 'string') upsert.run('store_city', b.city.trim());
    if (typeof b.storeAddress === 'string') upsert.run('store_address', b.storeAddress.trim().slice(0, 160));
    if (typeof b.pickupEnabled === 'boolean') upsert.run('pickup_enabled', String(b.pickupEnabled));
    if (num(b.pickupReadyMinutes) !== undefined)
      upsert.run('pickup_ready_minutes', String(Math.max(5, Math.round(num(b.pickupReadyMinutes)!))));
    if (num(b.storeLat) !== undefined) upsert.run('store_lat', String(num(b.storeLat)));
    if (num(b.storeLng) !== undefined) upsert.run('store_lng', String(num(b.storeLng)));
    if (num(b.deliveryPricePerKm) !== undefined) upsert.run('delivery_price_per_km', String(num(b.deliveryPricePerKm)));
    if (num(b.deliveryBaseFee) !== undefined) upsert.run('delivery_base_fee', String(num(b.deliveryBaseFee)));
    if (num(b.deliveryMinFee) !== undefined) upsert.run('delivery_min_fee', String(num(b.deliveryMinFee)));
    if (num(b.freeDeliveryAbove) !== undefined) upsert.run('free_delivery_above', String(num(b.freeDeliveryAbove)));
    if (num(b.maxDeliveryKm) !== undefined) upsert.run('max_delivery_km', String(num(b.maxDeliveryKm)));
    if (num(b.minOrderValue) !== undefined) upsert.run('min_order_value', String(num(b.minOrderValue)));
    if (num(b.routeFactor) !== undefined) upsert.run('route_factor', String(num(b.routeFactor)));
    if (num(b.driverFeePerDelivery) !== undefined)
      upsert.run('driver_fee_per_delivery', String(num(b.driverFeePerDelivery)));
    if (typeof b.pixKey === 'string') upsert.run('pix_key', normalizePixKey(b.pixKey));
    if (typeof b.pixMerchantName === 'string') upsert.run('pix_merchant_name', b.pixMerchantName.trim());
    if (typeof b.pixMerchantCity === 'string') upsert.run('pix_merchant_city', b.pixMerchantCity.trim());
    if (typeof b.cardOnDeliveryEnabled === 'boolean')
      upsert.run('card_on_delivery_enabled', String(b.cardOnDeliveryEnabled));
    if (typeof b.storeWhatsApp === 'string') {
      upsert.run('store_whatsapp', b.storeWhatsApp.replace(/\D/g, '').slice(0, 15));
    }
    if (typeof b.orderSoundUrl === 'string') {
      upsert.run('order_sound_url', b.orderSoundUrl.trim());
    }
    if (Array.isArray(b.openingHours)) upsert.run('opening_hours', JSON.stringify(b.openingHours));
    if (
      Array.isArray(b.sizeOptions) &&
      b.sizeOptions.length > 0 &&
      b.sizeOptions.every(
        (s: SizeOption) => s && typeof s.label === 'string' && typeof s.priceDelta === 'number'
      )
    ) {
      upsert.run(
        'size_options',
        JSON.stringify(
          b.sizeOptions.map((s: SizeOption) => ({
            label: String(s.label).trim().slice(0, 60),
            priceDelta: Number(s.priceDelta) || 0,
          }))
        )
      );
    }
    if (typeof b.orderEnabled === 'boolean') upsert.run('order_enabled', String(b.orderEnabled));
    if (typeof b.forceOpen === 'boolean') upsert.run('force_open', String(b.forceOpen));
    if (newPin) {
      upsert.run('kitchen_pin_hash', await hashPassword(newPin));
    }

    // Backup automático (Google Drive)
    if (typeof b.backupEnabled === 'boolean') upsert.run('backup_enabled', String(b.backupEnabled));
    if (num(b.backupFrequencyDays) !== undefined)
      upsert.run('backup_frequency_days', String(Math.max(1, num(b.backupFrequencyDays)!)));
    if (typeof b.backupFolderId === 'string') upsert.run('backup_folder_id', b.backupFolderId.trim().slice(0, 200));
    if (typeof b.backupServiceAccount === 'string' && b.backupServiceAccount.trim()) {
      upsert.run('backup_service_account', b.backupServiceAccount.trim());
    }

    const nextSettings = getSettings();
    io.emit('settings:updated', { ...nextSettings, isOpen: isStoreOpen(nextSettings) });
    io.to('kitchen').emit('settings:updated', {
      ...nextSettings,
      kitchenPinSet: true,
      isOpen: isStoreOpen(nextSettings),
      backupEnabled: backupMeta('backup_enabled', 'true') === 'true',
      backupFrequencyDays: Number(backupMeta('backup_frequency_days', '1')) || 1,
      backupFolderId: backupMeta('backup_folder_id'),
      backupKeySet: !!backupMeta('backup_service_account'),
      backupLastRun: backupMeta('backup_last_run'),
      backupLastStatus: backupMeta('backup_last_status'),
      backupLastFile: backupMeta('backup_last_file'),
    });
    res.json({ ok: true });
  })
  );

  // ---------- Mercado Pago (OAuth + webhook PIX) ----------
  router.get('/mercadopago/connect', requireRole('kitchen'), (req, res) => {
    try {
      const host = req.get('host') || undefined;
      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
      res.json(startOAuth(host, proto));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Não foi possível iniciar o OAuth.' });
    }
  });

  router.get('/mercadopago/callback', async (req, res) => {
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
  });

  router.post('/mercadopago/disconnect', requireRole('kitchen'), (_req, res) => {
    disconnectMercadoPago();
    res.json({ ok: true, mercadoPagoConnected: false });
  });

  router.post('/mercadopago/token', requireRole('kitchen'), (req, res) => {
    try {
      if (typeof req.body?.accessToken === 'string' && req.body.accessToken.trim()) {
        saveManualAccessToken(String(req.body.accessToken));
      }
      if (typeof req.body?.publicKey === 'string') {
        savePublicKey(String(req.body.publicKey));
      }
      if (!req.body?.accessToken && req.body?.publicKey == null) {
        return res.status(400).json({ error: 'Informe o Access Token ou a chave pública.' });
      }
      res.json({
        ok: true,
        mercadoPagoConnected: isMercadoPagoConnected(),
        mercadoPagoTestMode: isTestMode(),
        mercadoPagoPublicKey: getPublicKey(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Token inválido.' });
    }
  });

  const handleMpWebhook = async (req: Request, res: Response) => {
    const paymentId = parseWebhookPaymentId(req.body, req.query as Record<string, unknown>);
    if (
      !verifyWebhookSignature(
        req.headers['x-signature'] as string | undefined,
        req.headers['x-request-id'] as string | undefined,
        paymentId || ''
      )
    ) {
      return res.status(401).json({ error: 'Assinatura inválida.' });
    }
    res.status(200).json({ ok: true });
    if (!paymentId) return;
    try {
      await applyMpPayment(paymentId);
    } catch (err) {
      console.error('Webhook do Mercado Pago falhou ao liquidar o pagamento:', err);
    }
  };
  router.post('/mercadopago/webhook', asyncRoute(handleMpWebhook));
  router.get('/mercadopago/webhook', asyncRoute(handleMpWebhook));

  // ---------- Backup manual ----------
  router.post(
    '/backup/run',
    requireRole('kitchen'),
    asyncRoute(async (_req, res) => {
      const result = await runBackup();
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true });
    })
  );

  // ---------- Store / Loja ----------
  router.get('/store', (_req, res) => {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'store_logo'").get() as
      | { value: string }
      | undefined;
    res.json({ logo: row?.value || '' });
  });

  router.post('/store/logo', requireRole('kitchen'), (req, res) => {
    const { logo } = req.body ?? {};
    if (typeof logo !== 'string') {
      return res.status(400).json({ error: 'URL do logo inválida.' });
    }
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('store_logo', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(logo.trim());
    io.emit('store:updated', { logo: logo.trim() });
    res.json({ logo: logo.trim() });
  });

  // ---------- Coupons (CRUD no banco) ----------
  router.get('/coupons', (_req, res) => {
    res.json(listCouponsSorted());
  });

  router.post('/coupons', requireRole('kitchen'), (req, res) => {
    const coupon = saveCoupon(req.body);
    io.emit('coupons:updated');
    res.status(201).json(coupon);
  });

  router.delete('/coupons/:code', requireRole('kitchen'), (req, res) => {
    deleteCoupon(String(req.params.code));
    io.emit('coupons:updated');
    res.json({ ok: true });
  });

  // ---------- Promoções automáticas ----------
  // A leitura é pública: o cardápio do cliente precisa saber o preço promocional
  // antes de o pedido existir. Só a escrita pede a sessão da cozinha.
  router.get('/promotions', (_req, res) => {
    res.json(listPromotions());
  });

  router.post('/promotions', requireRole('kitchen'), (req, res) => {
    const promo = createPromotion(req.body);
    io.emit('promotions:updated');
    res.status(201).json(promo);
  });

  router.patch('/promotions/:id', requireRole('kitchen'), (req, res) => {
    const promo = updatePromotion(String(req.params.id), req.body ?? {});
    io.emit('promotions:updated');
    res.json(promo);
  });

  router.delete('/promotions/:id', requireRole('kitchen'), (req, res) => {
    deletePromotion(String(req.params.id));
    io.emit('promotions:updated');
    res.json({ ok: true });
  });

  router.post('/promotions/:id/reset-uses', requireRole('kitchen'), (req, res) => {
    const promo = resetPromotionUses(String(req.params.id));
    io.emit('promotions:updated');
    res.json(promo);
  });

  // ---------- Drivers / Motoboys ----------
  // O login casa o motoboy pelo nome: dois cadastros com o mesmo nome deixam o
  // login ambíguo e um dos dois nunca entra.
  const driverNameTaken = (name: string, exceptId?: string): boolean => {
    const wanted = name.trim().toLowerCase();
    const rows = db.prepare('SELECT id, data FROM drivers').all() as {
      id: string;
      data: string;
    }[];
    return rows.some((r) => {
      if (exceptId && r.id === exceptId) return false;
      const other = JSON.parse(r.data) as Driver;
      return typeof other.name === 'string' && other.name.trim().toLowerCase() === wanted;
    });
  };

  router.get('/drivers', requireRole('kitchen'), (_req, res) => {
    const rows = db.prepare('SELECT data FROM drivers ORDER BY rowid').all() as { data: string }[];
    res.json(rows.map((r) => publicDriver(JSON.parse(r.data) as Driver)));
  });

  router.post(
    '/drivers',
    requireRole('kitchen'),
    asyncRoute(async (req, res) => {
    const d = req.body as Driver;
    if (!d?.name || !d?.password) {
      return res.status(400).json({ error: 'Nome e senha do motoboy são obrigatórios.' });
    }
    if (driverNameTaken(d.name)) {
      return res.status(409).json({
        error: `Já existe um motoboy chamado "${d.name.trim()}". Use um nome diferente (ex.: "João M.").`,
      });
    }
    const driver: Driver = {
      // O id é do servidor: vindo do corpo, a cozinha podia sobrescrever o
      // cadastro de outro motoboy só repetindo o id.
      id: 'drv-' + randomUUID(),
      name: d.name.trim(),
      phone: d.phone?.trim() || undefined,
      password: await hashPassword(d.password),
      bikeModel: d.bikeModel?.trim() || undefined,
      plate: d.plate?.trim()?.toUpperCase() || undefined,
      active: d.active !== false,
      online: false,
      createdAt: new Date().toISOString(),
    };
    db.prepare('INSERT INTO drivers (id, data) VALUES (?, ?)').run(driver.id, JSON.stringify(driver));
    io.emit('drivers:updated');
    res.status(201).json(publicDriver(driver));
  })
  );

  router.patch(
    '/drivers/:id',
    requireRole('kitchen'),
    asyncRoute(async (req, res) => {
    const row = db.prepare('SELECT data FROM drivers WHERE id = ?').get(req.params.id) as
      | { data: string }
      | undefined;
    if (!row) return res.status(404).json({ error: 'Motoboy não encontrado.' });

    const driver: Driver = JSON.parse(row.data);
    const b = req.body ?? {};
    if (typeof b.name === 'string' && b.name.trim()) {
      if (driverNameTaken(b.name, driver.id)) {
        return res.status(409).json({
          error: `Já existe um motoboy chamado "${b.name.trim()}". Use um nome diferente (ex.: "João M.").`,
        });
      }
      driver.name = b.name.trim();
    }
    if (typeof b.phone === 'string') driver.phone = b.phone.trim() || undefined;
    const passwordChanged = typeof b.password === 'string' && !!b.password.trim();
    if (passwordChanged) driver.password = await hashPassword(b.password);
    if (typeof b.bikeModel === 'string') driver.bikeModel = b.bikeModel.trim() || undefined;
    if (typeof b.plate === 'string') driver.plate = b.plate.trim().toUpperCase() || undefined;
    const deactivated = b.active === false && driver.active !== false;
    if (typeof b.active === 'boolean') driver.active = b.active;

    db.prepare('UPDATE drivers SET data = ? WHERE id = ?').run(JSON.stringify(driver), driver.id);
    // Demitir ou trocar a senha precisa cortar o acesso agora: sem isso o token
    // guardado no celular do ex-funcionário continuava lendo os pedidos.
    if (deactivated || passwordChanged) revokeDriverTokens(driver.id);
    io.emit('drivers:updated');
    res.json(publicDriver(driver));
  })
  );

  router.delete('/drivers/:id', requireRole('kitchen'), (req, res) => {
    const row = db.prepare('SELECT data FROM drivers WHERE id = ?').get(req.params.id) as
      | { data: string }
      | undefined;
    if (!row) return res.status(404).json({ error: 'Motoboy não encontrado.' });
    db.prepare('DELETE FROM drivers WHERE id = ?').run(req.params.id);
    revokeDriverTokens(req.params.id);
    io.emit('drivers:updated');
    res.json({ ok: true });
  });

  // Presença do entregador (online/offline + última posição)
  // O app do motoboy recarrega sem estado: sem esta leitura ele voltaria sempre
  // como OFFLINE mesmo tendo ficado online no servidor.
  // A presença é do próprio motoboy: qualquer um podia ler e escrever o
  // cadastro de qualquer outro, inclusive desligá-lo do turno.
  router.get('/drivers/:id/presence', requireDriver, (req, res) => {
    const driver = currentDriver(res);
    if (req.params.id !== driver.id) {
      return res.status(403).json({ error: 'Você só pode ver a sua própria presença.' });
    }
    res.json(publicDriver(driver));
  });

  router.post('/drivers/:id/presence', requireDriver, (req, res) => {
    const driver = currentDriver(res);
    if (req.params.id !== driver.id) {
      return res.status(403).json({ error: 'Você só pode mudar a sua própria presença.' });
    }
    // Só `online` entra aqui. A posição é responsabilidade do módulo
    // `driverLocation`, que valida a coordenada e move as corridas junto.
    if (typeof req.body?.online === 'boolean') driver.online = req.body.online;
    db.prepare('UPDATE drivers SET data = ? WHERE id = ?').run(JSON.stringify(driver), driver.id);
    io.emit('drivers:updated');
    res.json(publicDriver(driver));
  });

  return router;
}
