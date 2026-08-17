import { Router, Request, Response, NextFunction } from 'express';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import {
  db,
  getSettings,
  getRoleToken,
  getLoyaltyPoints,
  addLoyaltyPoints,
  deductLoyaltyPoints,
  createFreeRedeem,
  consumeFreeRedeem,
} from './db';
import { verifyPassword, hashPassword } from './auth';
import { generatePixCopyPaste } from './pix';
import { normalizePixKey } from '../src/shared/pix';
import { UPLOADS_DIR } from './paths';
import {
  Product,
  Order,
  OrderStatus,
  ChatMessage,
  PaymentDetails,
  CartItem,
  Driver,
  Coupon,
  StoreSettings,
  OpeningHour,
  SizeOption,
  ExtraOption,
  ComboSlot,
  ComboSlotOption,
  Category,
  SalesReport,
} from '../src/types';
import { STATUS_ORDER } from '../src/shared/constants';
import {
  computeCartItemTotal,
  computeCartTotals,
  findCoupon,
} from '../src/shared/pricing';
import { effectiveDistanceKm, isStoreOpen, round2 } from '../src/shared/geo';

const requireRole = (roles: 'kitchen' | 'driver' | ('kitchen' | 'driver')[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const list = Array.isArray(roles) ? roles : [roles];
    const token = req.headers['x-role-token'];
    if (list.some((r) => token === getRoleToken(r))) return next();
    res.status(401).json({ error: 'Não autorizado. Faça login com o PIN correto.' });
  };
};

// ---------- Geocodificação com cache e limite de requisições ----------
const geoThrottle = new Map<string, number[]>();
function throttleIp(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (geoThrottle.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) return true;
  arr.push(now);
  geoThrottle.set(ip, arr);
  return false;
}

async function nominatimSearch(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const key = 'geo:' + query.trim().toLowerCase();
  const cached = db.prepare('SELECT value FROM geo_cache WHERE query = ?').get(key) as
    | { value: string }
    | undefined;
  if (cached) return JSON.parse(cached.value);

  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=' +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'CaldinhoExpress/1.0 (app de delivery)' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!data.length) return null;
  const result = {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon),
    label: data[0].display_name,
  };
  db.prepare('INSERT INTO geo_cache (query, value) VALUES (?, ?) ON CONFLICT(query) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(result)
  );
  return result;
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // segunda = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function createRoutes(io: Server): Router {
  const router = Router();

  // ---------- Health check ----------
  router.get('/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // ---------- Auth ----------
  router.post('/auth/login', (req, res) => {
    const { role, pin } = req.body ?? {};
    if (role !== 'kitchen' && role !== 'driver') {
      return res.status(400).json({ error: 'Papel inválido.' });
    }

    if (role === 'driver') {
      const rows = db.prepare('SELECT data FROM drivers').all() as { data: string }[];
      const drivers = rows.map((r) => JSON.parse(r.data) as Driver);
      const { name } = req.body ?? {};

      let driver: Driver | undefined;
      if (typeof name === 'string' && name.trim()) {
        driver = drivers.find(
          (d) => d.active && d.name.toLowerCase() === name.trim().toLowerCase()
        );
      }
      if (driver && verifyPassword(String(pin ?? ''), driver.password || '')) {
        const { password: _pw, ...safeDriver } = driver;
        return res.json({ token: getRoleToken('driver'), role, driver: safeDriver });
      }
      return res.status(401).json({
        error: !name ? 'Informe seu nome de motoboy.' : 'Nome ou senha incorretos. Verifique com a cozinha.',
      });
    }

    const settings = getSettings();
    const pinHash = (
      db.prepare("SELECT value FROM meta WHERE key = 'kitchen_pin_hash'").get() as
        | { value: string }
        | undefined
    )?.value;
    if (verifyPassword(String(pin ?? ''), pinHash || '')) {
      return res.json({ token: getRoleToken('kitchen'), role });
    }
    res.status(401).json({ error: 'PIN incorreto. Tente novamente.' });
  });

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
    if (throttleIp(req.ip || 'unknown', 6, 10000)) {
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
    if (throttleIp(req.ip || 'unknown', 10, 10000)) {
      return res.status(429).json({ error: 'Muitas consultas. Aguarde alguns segundos.' });
    }
    try {
      const viacep = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await viacep.json();
      if (data.erro) return res.status(404).json({ error: 'CEP não encontrado.' });
      res.json({
        cep: data.cep,
        street: data.logradouro || '',
        neighborhood: data.bairro || '',
        city: `${data.localidade} - ${data.uf}`,
      });
    } catch {
      res.status(502).json({ error: 'Serviço de CEP indisponível. Preencha manualmente.' });
    }
  });

  // ---------- Categorias (editáveis no painel) ----------
  router.get('/categories', (_req, res) => {
    const rows = db.prepare('SELECT data FROM categories').all() as { data: string }[];
    const cats = rows.map((r) => JSON.parse(r.data) as Category);
    cats.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    res.json(cats);
  });

  const categoryById = (id: string): Category | null => {
    const row = db.prepare('SELECT data FROM categories WHERE id = ?').get(id) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as Category) : null;
  };

  const normalizeCategory = (b: Record<string, unknown>, existing?: Category): Category | null => {
    const label = typeof b.label === 'string' ? b.label.trim() : existing?.label;
    if (!label) return null;
    const emoji = typeof b.emoji === 'string' && b.emoji ? b.emoji.slice(0, 8) : existing?.emoji || '🍽️';
    const color =
      typeof b.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color)
        ? b.color
        : existing?.color || '#B91C1C';
    const sort = typeof b.sort === 'number' ? b.sort : existing?.sort ?? 0;
    return {
      id: existing?.id || 'cat-' + Date.now(),
      label: label.slice(0, 30),
      emoji,
      color,
      sort,
    };
  };

  router.post('/categories', requireRole('kitchen'), (req, res) => {
    const cat = normalizeCategory(req.body ?? {});
    if (!cat) return res.status(400).json({ error: 'Informe o nome da categoria.' });
    const all = db.prepare('SELECT data FROM categories').all() as { data: string }[];
    const maxSort = all.reduce(
      (m, r) => Math.max(m, (JSON.parse(r.data) as Category).sort ?? 0),
      -1
    );
    cat.sort = maxSort + 1;
    db.prepare('INSERT INTO categories (id, data) VALUES (?, ?)').run(cat.id, JSON.stringify(cat));
    io.emit('categories:updated');
    res.status(201).json(cat);
  });

  router.patch('/categories/:id', requireRole('kitchen'), (req, res) => {
    const existing = categoryById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Categoria não encontrada.' });
    const cat = normalizeCategory(req.body ?? {}, existing);
    if (!cat) return res.status(400).json({ error: 'Informe o nome da categoria.' });
    db.prepare('UPDATE categories SET data = ? WHERE id = ?').run(JSON.stringify(cat), cat.id);
    io.emit('categories:updated');
    res.json(cat);
  });

  router.delete('/categories/:id', requireRole('kitchen'), (req, res) => {
    const existing = categoryById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Categoria não encontrada.' });
    const used = (db.prepare('SELECT COUNT(*) AS c FROM products WHERE data LIKE ?').get(
      `%"category":"${req.params.id}"%`
    ) as { c: number }).c;
    if (used > 0) {
      return res.status(400).json({
        error: `Não é possível excluir: ${used} produto(s) usam esta categoria. Mova-os ou remova-os primeiro.`,
      });
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    io.emit('categories:updated');
    res.json({ ok: true });
  });

  // ---------- Products ----------
  router.get('/products', (_req, res) => {
    const rows = db.prepare('SELECT data FROM products ORDER BY rowid').all() as { data: string }[];
    res.json(rows.map((r) => JSON.parse(r.data) as Product));
  });

  router.post('/products', requireRole('kitchen'), (req, res) => {
    const p = req.body as Product;
    if (!p?.id || !p.name || typeof p.basePrice !== 'number') {
      return res.status(400).json({ error: 'Dados do produto inválidos.' });
    }
    db.prepare('INSERT INTO products (id, data) VALUES (?, ?)').run(p.id, JSON.stringify(p));
    io.emit('products:updated');
    res.json(p);
  });

  router.patch('/products/:id', requireRole('kitchen'), (req, res) => {
    const row = db.prepare('SELECT data FROM products WHERE id = ?').get(req.params.id) as
      | { data: string }
      | undefined;
    if (!row) return res.status(404).json({ error: 'Produto não encontrado.' });
    const p: Product = JSON.parse(row.data);
    const b = req.body ?? {};
    if (typeof b.basePrice === 'number') p.basePrice = b.basePrice;
    if (typeof b.available === 'boolean') p.available = b.available;
    if (typeof b.image === 'string' && b.image.trim()) p.image = b.image.trim();
    if (typeof b.name === 'string' && b.name.trim()) p.name = b.name.trim();
    if (typeof b.description === 'string' && b.description.trim())
      p.description = b.description.trim();
    if (typeof b.prepTimeMinutes === 'number') p.prepTimeMinutes = b.prepTimeMinutes;
    if (typeof b.category === 'string' && b.category.trim()) p.category = b.category.trim();
    if (typeof b.originalPrice === 'number') p.originalPrice = b.originalPrice;
    if (b.originalPrice === null) p.originalPrice = undefined;
    if (typeof b.hasSizeOption === 'boolean') p.hasSizeOption = b.hasSizeOption;
    if (typeof b.isPopular === 'boolean') p.isPopular = b.isPopular;
    if (typeof b.isFlashPromo === 'boolean') p.isFlashPromo = b.isFlashPromo;
    if (typeof b.isCaldinhoDoDia === 'boolean') p.isCaldinhoDoDia = b.isCaldinhoDoDia;
    if (Array.isArray(b.allowedExtras)) {
      p.allowedExtras = b.allowedExtras
        .filter((e: ExtraOption) => e && typeof e.name === 'string' && e.name.trim())
        .map((e: ExtraOption) => ({
          id:
            typeof e.id === 'string' && e.id
              ? e.id
              : 'ext-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          name: e.name.trim().slice(0, 60),
          price: Math.max(0, Number(e.price) || 0),
        }));
    }
    if (Array.isArray(b.comboSlots)) {
      p.comboSlots = b.comboSlots
        .filter((s: ComboSlot) => s && typeof s.label === 'string' && s.label.trim())
        .map((s: ComboSlot) => ({
          id:
            typeof s.id === 'string' && s.id
              ? s.id
              : 'slot-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          label: s.label.trim().slice(0, 60),
          required: s.required !== false,
          options: (Array.isArray(s.options) ? s.options : [])
            .filter((o: ComboSlotOption) => o && typeof o.label === 'string' && o.label.trim())
            .map((o: ComboSlotOption) => ({
              id:
                typeof o.id === 'string' && o.id
                  ? o.id
                  : 'opt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              label: o.label.trim().slice(0, 60),
              priceDelta: Math.max(0, Number(o.priceDelta) || 0),
            })),
        }));
    }
    db.prepare('UPDATE products SET data = ? WHERE id = ?').run(JSON.stringify(p), p.id);
    io.emit('products:updated');
    res.json(p);
  });

  router.delete('/products/:id', requireRole('kitchen'), (req, res) => {
    const row = db.prepare('SELECT data FROM products WHERE id = ?').get(req.params.id) as
      | { data: string }
      | undefined;
    if (!row) return res.status(404).json({ error: 'Produto não encontrado.' });
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    io.emit('products:updated');
    res.json({ ok: true });
  });

  router.post('/products/:id/caldinho-do-dia', requireRole('kitchen'), (req, res) => {
    const rows = db.prepare('SELECT data FROM products').all() as { data: string }[];
    const tx = db.transaction(() => {
      for (const r of rows) {
        const p: Product = JSON.parse(r.data);
        p.isCaldinhoDoDia = p.id === req.params.id;
        db.prepare('UPDATE products SET data = ? WHERE id = ?').run(JSON.stringify(p), p.id);
      }
    });
    tx();
    io.emit('products:updated');
    res.json({ ok: true });
  });

  // ---------- Orders ----------
  router.get('/orders', (req, res) => {
    const { customerId } = req.query;
    const rows = customerId
      ? (db
          .prepare('SELECT data FROM orders WHERE customer_id = ? ORDER BY created_at DESC')
          .all(String(customerId)) as { data: string }[])
      : (db.prepare('SELECT data FROM orders ORDER BY created_at DESC').all() as { data: string }[]);
    res.json(rows.map((r) => JSON.parse(r.data) as Order));
  });

  router.post('/orders', (req, res) => {
    const { items, couponCode, address, paymentMethod, changeForAmount, customerName, customerPhone, customerId } =
      req.body ?? {};
    if (!Array.isArray(items) || items.length === 0 || !address) {
      return res.status(400).json({ error: 'Carrinho ou endereço inválidos.' });
    }

    const settings = getSettings();

    // Loja aberta?
    if (!isStoreOpen(settings)) {
      return res.status(400).json({ error: 'A loja está fechada no momento. Volte no horário de funcionamento!' });
    }

    // Endereço precisa ter localização real
    if (
      typeof address.lat !== 'number' ||
      typeof address.lng !== 'number' ||
      !Number.isFinite(address.lat) ||
      !Number.isFinite(address.lng)
    ) {
      return res.status(400).json({ error: 'Endereço sem localização. Informe o CEP ou ajuste o pino no mapa.' });
    }

    // Fidelidade grátis: valida tokens de resgate (consome só após todas as validações)
    const freeItems = items.filter((it: CartItem) => it.isFree);
    const freeTokensValid = freeItems.every(
      (it) => it.freeToken && consumeFreeRedeem(it.freeToken, it.product?.id)
    );

    const coupons = db.prepare('SELECT data FROM coupons').all() as { data: string }[];
    const coupon = findCoupon(String(couponCode ?? ''), coupons.map((c) => JSON.parse(c.data) as Coupon));

    const cartItems: CartItem[] = items
      .filter((it: CartItem) => it && typeof it.quantity === 'number' && it.quantity > 0)
      .map((it: CartItem) => ({
        id: it.id || 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        product: it.product,
        size: it.size,
        selectedExtras: Array.isArray(it.selectedExtras) ? it.selectedExtras : [],
        comboChoices: Array.isArray(it.comboChoices) ? it.comboChoices : undefined,
        observation: it.observation,
        quantity: it.quantity,
        isFree: !!it.isFree,
        freeToken: it.freeToken,
        itemTotalPrice: computeCartItemTotal(it, settings.sizeOptions),
      }));

    const totals = computeCartTotals(cartItems, coupon, address, settings);

    // Raio máximo de entrega
    const distanceKm = effectiveDistanceKm(address, settings);
    if (settings.maxDeliveryKm > 0 && distanceKm > settings.maxDeliveryKm) {
      return res.status(400).json({
        error: `O endereço está fora da área de entrega (máx. ${settings.maxDeliveryKm} km da loja).`,
      });
    }
    if (totals.deliveryFee < 0) {
      return res.status(400).json({ error: 'O endereço está fora da área de entrega.' });
    }

    // Pedido mínimo: vale para itens pagos; pedidos só com item grátis de fidelidade passam
    const paidSubtotal = cartItems
      .filter((it) => !it.isFree)
      .reduce((s, it) => s + computeCartItemTotal(it, settings.sizeOptions), 0);
    if (settings.minOrderValue > 0 && paidSubtotal > 0 && paidSubtotal < settings.minOrderValue) {
      return res.status(400).json({
        error: `Pedido mínimo de R$ ${settings.minOrderValue.toFixed(2)}. Adicione mais itens.`,
      });
    }

    if (!freeTokensValid) {
      return res.status(400).json({ error: 'Item grátis de fidelidade inválido. Verifique seus selos.' });
    }

    const id = `CX-${Math.floor(1000 + Math.random() * 9000)}`;
    const payment: PaymentDetails = {
      method: paymentMethod === 'cash' ? 'cash' : paymentMethod === 'card' ? 'card' : 'pix',
      isPaid: false, // PIX/cartão/dinheiro são confirmados pela cozinha ou na entrega
      changeForAmount: typeof changeForAmount === 'number' ? changeForAmount : undefined,
      pixCopyPaste:
        paymentMethod === 'pix' && settings.pixKey
          ? generatePixCopyPaste({
              pixKey: settings.pixKey,
              amount: totals.total,
              merchantName: settings.pixMerchantName,
              merchantCity: settings.pixMerchantCity,
              txid: id,
            })
          : undefined,
    };

    const cid = String(customerId || 'anon').slice(0, 80);
    const now = new Date().toISOString();
    const order: Order = {
      id,
      customerId: cid,
      customerName: String(customerName || '').trim() || 'Cliente',
      customerPhone: String(customerPhone || '').trim() || '',
      address,
      items: cartItems,
      subtotal: totals.subtotal,
      discount: totals.discount,
      deliveryFee: totals.deliveryFee,
      total: totals.total,
      distanceKm,
      status: 'recebido',
      payment,
      createdAt: now,
      estimatedDeliveryMinutes: Math.max(15, Math.round(12 + distanceKm * 2 + 3)),
      loyaltyPointsEarned: 0, // fidelidade agora conta pedidos ENTREGUES (1 selo por entrega)
    };

    db.prepare('INSERT INTO orders (id, data, status, created_at, customer_id) VALUES (?, ?, ?, ?, ?)').run(
      order.id,
      JSON.stringify(order),
      order.status,
      order.createdAt,
      cid
    );

    io.emit('order:new', order);

    res.status(201).json({ order, loyaltyPoints: getLoyaltyPoints(cid) });
  });

  const getOrderOr404 = (id: string): { order: Order; raw: string } | null => {
    const row = db.prepare('SELECT data FROM orders WHERE id = ?').get(id) as { data: string } | undefined;
    if (!row) return null;
    return { order: JSON.parse(row.data) as Order, raw: row.data };
  };

  router.patch('/orders/:id/status', requireRole(['kitchen', 'driver']), (req, res) => {
    const found = getOrderOr404(req.params.id);
    if (!found) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const order = found.order;
    const newStatus = req.body?.status as OrderStatus;
    if (!STATUS_ORDER.includes(newStatus)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    const isDriverRequest = req.headers['x-role-token'] === getRoleToken('driver');
    if (isDriverRequest) {
      // Entregador só pode: entregar um pedido atribuído a ele
      if (newStatus !== 'entregue' || order.status !== 'saiu_entrega') {
        return res.status(400).json({ error: 'Ação não permitida para o entregador.' });
      }
      const driverName = String(req.body?.driverName || '').trim();
      if (!driverName || order.driverId !== findDriverIdByName(driverName)) {
        return res.status(403).json({ error: 'Esta corrida não está atribuída a você.' });
      }
    }

    if (STATUS_ORDER.indexOf(newStatus) <= STATUS_ORDER.indexOf(order.status)) {
      return res.status(400).json({ error: 'Transição de status inválida.' });
    }

    order.status = newStatus;
    if (newStatus === 'saiu_entrega' && !isDriverRequest) {
      order.driverLat = undefined;
      order.driverLng = undefined;
    }
    if (newStatus === 'saiu_entrega') {
      const settings = getSettings();
      order.driverLat = order.driverLat ?? settings.storeLat;
      order.driverLng = order.driverLng ?? settings.storeLng;
    }

    db.prepare('UPDATE orders SET data = ?, status = ? WHERE id = ?').run(
      JSON.stringify(order),
      order.status,
      order.id
    );

    // Fidelidade: pedido ENTREGUE = +1 selo para o cliente (10 selos = 1 caldinho grátis)
    if (newStatus === 'entregue' && order.customerId && order.customerId !== 'anon') {
      const stamps = addLoyaltyPoints(order.customerId, 1);
      io.emit('loyalty:updated', { customerId: order.customerId, points: stamps });
    }

    io.emit('order:updated', order);
    res.json(order);
  });

  const findDriverIdByName = (name: string): string | null => {
    if (!name) return null;
    const rows = db.prepare('SELECT data FROM drivers').all() as { data: string }[];
    const driver = rows
      .map((r) => JSON.parse(r.data) as Driver)
      .find((d) => d.active && d.name.toLowerCase() === name.toLowerCase());
    return driver ? driver.id : null;
  };

  // Aceitar corrida + iniciar rota (entregador)
  router.post('/orders/:id/assign', requireRole('driver'), (req, res) => {
    const found = getOrderOr404(req.params.id);
    if (!found) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const order = found.order;
    const driverName = String(req.body?.driverName || '').trim();
    const driverId = findDriverIdByName(driverName);
    if (!driverId) return res.status(403).json({ error: 'Motoboy não encontrado.' });
    if (order.driverId && order.driverId !== driverId) {
      return res.status(403).json({ error: 'Esta corrida já foi aceita por outro entregador.' });
    }
    if (order.status !== 'pronto' && order.status !== 'saiu_entrega') {
      return res.status(400).json({ error: 'A corrida ainda não está disponível.' });
    }
    const rows = db.prepare('SELECT data FROM drivers WHERE id = ?').get(driverId) as
      | { data: string }
      | undefined;
    const driver = rows ? (JSON.parse(rows.data) as Driver) : undefined;

    order.driverId = driverId;
    order.driverName = driver?.name || driverName;
    order.driverPhone = driver?.phone || '';
    if (order.status === 'pronto') {
      order.status = 'saiu_entrega';
      const settings = getSettings();
      order.driverLat = order.driverLat ?? settings.storeLat;
      order.driverLng = order.driverLng ?? settings.storeLng;
    }

    db.prepare('UPDATE orders SET data = ?, status = ? WHERE id = ?').run(
      JSON.stringify(order),
      order.status,
      order.id
    );
    io.emit('order:updated', order);
    res.json(order);
  });

  // Confirmar pagamento (cozinha) — PIX pendente
  router.patch('/orders/:id/payment', requireRole('kitchen'), (req, res) => {
    const found = getOrderOr404(req.params.id);
    if (!found) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const order = found.order;
    order.payment.isPaid = true;
    db.prepare('UPDATE orders SET data = ? WHERE id = ?').run(JSON.stringify(order), order.id);
    io.emit('order:updated', order);
    res.json(order);
  });

  // Cancelar pedido (cliente só em "recebido"; cozinha a qualquer momento antes de entregar)
  router.post('/orders/:id/cancel', (req, res) => {
    const found = getOrderOr404(req.params.id);
    if (!found) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const order = found.order;
    if (order.status === 'entregue' || order.status === 'cancelado') {
      return res.status(400).json({ error: 'Este pedido não pode mais ser cancelado.' });
    }
    const isKitchen = req.headers['x-role-token'] === getRoleToken('kitchen');
    if (!isKitchen && order.status !== 'recebido') {
      return res.status(400).json({ error: 'O pedido já está em preparo e não pode ser cancelado pelo cliente.' });
    }
    const reason = String(req.body?.reason || '').trim() || (isKitchen ? 'Cancelado pela loja' : 'Cancelado pelo cliente');
    order.status = 'cancelado';
    order.cancellationReason = reason;
    db.prepare('UPDATE orders SET data = ?, status = ? WHERE id = ?').run(
      JSON.stringify(order),
      order.status,
      order.id
    );
    io.emit('order:updated', order);
    res.json(order);
  });

  router.post('/orders/:id/rating', (req, res) => {
    const found = getOrderOr404(req.params.id);
    if (!found) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const order = found.order;
    order.rating = Number(req.body?.rating);
    order.ratingComment = req.body?.comment;
    db.prepare('UPDATE orders SET data = ? WHERE id = ?').run(JSON.stringify(order), order.id);
    io.emit('order:updated', order);
    res.json(order);
  });

  // ---------- Relatórios (agregação real no servidor) ----------
  router.get('/reports', (req, res) => {
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    const rows = db.prepare('SELECT data FROM orders').all() as { data: string }[];
    const orders = rows.map((r) => JSON.parse(r.data) as Order);

    const inRange = (o: Order) => {
      const key = localDateKey(o.createdAt);
      if (from && key < from) return false;
      if (to && key > to) return false;
      return true;
    };

    const filtered = orders.filter(inRange);
    const active = filtered.filter((o) => o.status !== 'cancelado');
    const totalRevenue = round2(active.reduce((s, o) => s + o.total, 0));
    const totalOrders = filtered.filter((o) => o.status !== 'cancelado').length;
    const avgTicket = totalOrders ? round2(totalRevenue / totalOrders) : 0;

    const topMap = new Map<string, { name: string; count: number; total: number }>();
    for (const o of active) {
      for (const item of o.items) {
        const cur = topMap.get(item.product.id) || { name: item.product.name, count: 0, total: 0 };
        cur.count += item.quantity;
        cur.total = round2(cur.total + item.itemTotalPrice);
        topMap.set(item.product.id, cur);
      }
    }
    const topSellingProducts = [...topMap.values()].sort((a, b) => b.count - a.count).slice(0, 5);

    const hourlyMap = new Map<number, number>();
    for (const o of active) {
      const hour = new Date(o.createdAt).getHours();
      hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + 1);
    }
    const hourlyDistribution = [...hourlyMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, ordersCount]) => ({ hour: `${hour}:00`, orders: ordersCount }));

    const report: SalesReport = { totalRevenue, totalOrders, avgTicket, topSellingProducts, hourlyDistribution };
    res.json(report);
  });

  // ---------- Tendências de faturamento (diário/semanal/mensal) ----------
  router.get('/reports/trends', (_req, res) => {
    const rows = db.prepare('SELECT data FROM orders').all() as { data: string }[];
    const orders = rows
      .map((r) => JSON.parse(r.data) as Order)
      .filter((o) => o.status !== 'cancelado');

    const add = (
      map: Map<string, { revenue: number; orders: number }>,
      key: string,
      total: number
    ) => {
      const cur = map.get(key) || { revenue: 0, orders: 0 };
      cur.revenue = round2(cur.revenue + total);
      cur.orders += 1;
      map.set(key, cur);
    };

    const now = new Date();

    // Diário: últimos 30 dias
    const dailyMap = new Map<string, { revenue: number; orders: number }>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dailyMap.set(localDateKey(d.toISOString()), { revenue: 0, orders: 0 });
    }
    for (const o of orders) {
      const k = localDateKey(o.createdAt);
      if (dailyMap.has(k)) add(dailyMap, k, o.total);
    }
    const daily = [...dailyMap.entries()].map(([date, v]) => ({
      label: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
      date,
      revenue: v.revenue,
      orders: v.orders,
    }));

    // Semanal: últimas 12 semanas (segunda a domingo)
    const weeklyMap = new Map<string, { revenue: number; orders: number }>();
    for (let i = 11; i >= 0; i--) {
      const wk = new Date(now);
      wk.setDate(wk.getDate() - i * 7);
      weeklyMap.set(localDateKey(startOfWeek(wk).toISOString()), { revenue: 0, orders: 0 });
    }
    for (const o of orders) {
      const k = localDateKey(startOfWeek(new Date(o.createdAt)).toISOString());
      if (weeklyMap.has(k)) add(weeklyMap, k, o.total);
    }
    const weekly = [...weeklyMap.entries()].map(([date, v]) => ({
      label: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
      date,
      revenue: v.revenue,
      orders: v.orders,
    }));

    // Mensal: últimos 12 meses
    const monthlyMap = new Map<string, { revenue: number; orders: number }>();
    for (let i = 11; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      monthlyMap.set(key, { revenue: 0, orders: 0 });
    }
    for (const o of orders) {
      const d = new Date(o.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (monthlyMap.has(key)) add(monthlyMap, key, o.total);
    }
    const monthShort = (d: Date) =>
      d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    const monthly = [...monthlyMap.entries()].map(([key, v]) => {
      const [y, m] = key.split('-').map(Number);
      return {
        label: `${monthShort(new Date(y, m - 1, 1))}/${String(y).slice(2)}`,
        date: key,
        revenue: v.revenue,
        orders: v.orders,
      };
    });

    res.json({ daily, weekly, monthly });
  });

  // ---------- Chat ----------
  router.get('/orders/:id/chat', (req, res) => {
    const rows = db
      .prepare('SELECT data FROM chat_messages WHERE order_id = ? ORDER BY id')
      .all(req.params.id) as { data: string }[];
    res.json(rows.map((r) => JSON.parse(r.data) as ChatMessage));
  });

  router.post('/orders/:id/chat', (req, res) => {
    const { sender, senderName, text } = req.body ?? {};
    if (!sender || !text) return res.status(400).json({ error: 'Mensagem inválida.' });

    const message: ChatMessage = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      orderId: req.params.id,
      sender,
      senderName: String(senderName || '').trim() || 'Cliente',
      text: String(text).slice(0, 500),
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    db.prepare('INSERT INTO chat_messages (order_id, data) VALUES (?, ?)').run(
      req.params.id,
      JSON.stringify(message)
    );
    io.emit('chat:message', message);
    res.status(201).json(message);
  });

  // ---------- Fidelidade (por cliente/dispositivo) ----------
  router.get('/loyalty', (req, res) => {
    const customerId = String(req.query.customerId || 'anon');
    res.json({ points: getLoyaltyPoints(customerId) });
  });

  router.post('/loyalty/redeem', (req, res) => {
    const customerId = String(req.body?.customerId || 'anon');
    const points = getLoyaltyPoints(customerId);
    if (points < 10) return res.status(400).json({ error: 'Selos insuficientes.' });
    const productId = String(req.body?.productId || '');
    if (!productId) return res.status(400).json({ error: 'Produto inválido.' });
    const newPoints = deductLoyaltyPoints(customerId, 10);
    const token = createFreeRedeem(productId);
    io.emit('loyalty:updated', { customerId, points: newPoints });
    res.json({ points: newPoints, token });
  });

  // ---------- Settings / Configurações ----------
  router.get('/settings', (_req, res) => {
    const settings = getSettings();
    const pinHash = (
      db.prepare("SELECT value FROM meta WHERE key = 'kitchen_pin_hash'").get() as
        | { value: string }
        | undefined
    )?.value;
    res.json({
      ...settings,
      kitchenPinSet: !!pinHash,
      isOpen: isStoreOpen(settings),
    });
  });

  router.post('/settings', requireRole('kitchen'), (req, res) => {
    const b = req.body ?? {};
    const upsert = db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    const num = (v: unknown, fallback?: number): number | undefined => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    if (typeof b.storeName === 'string') upsert.run('store_name', b.storeName.trim());
    if (typeof b.city === 'string') upsert.run('store_city', b.city.trim());
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
    if (typeof b.kitchenPin === 'string' && b.kitchenPin.length >= 4) {
      upsert.run('kitchen_pin_hash', hashPassword(b.kitchenPin));
    }

    io.emit('settings:updated', { ...getSettings(), kitchenPinSet: true });
    res.json({ ok: true });
  });

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
    const rows = db.prepare('SELECT data FROM coupons ORDER BY code').all() as { data: string }[];
    res.json(rows.map((r) => JSON.parse(r.data) as Coupon));
  });

  router.post('/coupons', requireRole('kitchen'), (req, res) => {
    const c = req.body as Coupon;
    if (!c?.code || !(typeof c.discountPercent === 'number' || typeof c.discountFixed === 'number')) {
      return res.status(400).json({ error: 'Dados do cupom inválidos.' });
    }
    const coupon: Coupon = {
      code: c.code.trim().toUpperCase(),
      discountPercent: typeof c.discountPercent === 'number' ? c.discountPercent : undefined,
      discountFixed: typeof c.discountFixed === 'number' ? c.discountFixed : undefined,
      minOrderValue: Number(c.minOrderValue) || 0,
      description: c.description?.trim() || 'Cupom de desconto',
    };
    db.prepare('INSERT INTO coupons (code, data) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data').run(
      coupon.code,
      JSON.stringify(coupon)
    );
    io.emit('coupons:updated');
    res.status(201).json(coupon);
  });

  router.delete('/coupons/:code', requireRole('kitchen'), (req, res) => {
    db.prepare('DELETE FROM coupons WHERE code = ?').run(String(req.params.code).toUpperCase());
    io.emit('coupons:updated');
    res.json({ ok: true });
  });

  // ---------- Drivers / Motoboys ----------
  router.get('/drivers', requireRole('kitchen'), (_req, res) => {
    const rows = db.prepare('SELECT data FROM drivers ORDER BY rowid').all() as { data: string }[];
    res.json(rows.map((r) => JSON.parse(r.data) as Driver));
  });

  router.post('/drivers', requireRole('kitchen'), (req, res) => {
    const d = req.body as Driver;
    if (!d?.name || !d?.password) {
      return res.status(400).json({ error: 'Nome e senha do motoboy são obrigatórios.' });
    }
    const driver: Driver = {
      id: d.id || 'drv-' + Date.now(),
      name: d.name.trim(),
      phone: d.phone?.trim() || undefined,
      password: hashPassword(d.password),
      bikeModel: d.bikeModel?.trim() || undefined,
      plate: d.plate?.trim()?.toUpperCase() || undefined,
      active: d.active !== false,
      online: false,
      createdAt: new Date().toISOString(),
    };
    db.prepare('INSERT INTO drivers (id, data) VALUES (?, ?)').run(driver.id, JSON.stringify(driver));
    io.emit('drivers:updated');
    res.status(201).json({ ...driver, password: undefined });
  });

  router.patch('/drivers/:id', requireRole('kitchen'), (req, res) => {
    const row = db.prepare('SELECT data FROM drivers WHERE id = ?').get(req.params.id) as
      | { data: string }
      | undefined;
    if (!row) return res.status(404).json({ error: 'Motoboy não encontrado.' });

    const driver: Driver = JSON.parse(row.data);
    const b = req.body ?? {};
    if (typeof b.name === 'string' && b.name.trim()) driver.name = b.name.trim();
    if (typeof b.phone === 'string') driver.phone = b.phone.trim() || undefined;
    if (typeof b.password === 'string' && b.password.trim()) driver.password = hashPassword(b.password);
    if (typeof b.bikeModel === 'string') driver.bikeModel = b.bikeModel.trim() || undefined;
    if (typeof b.plate === 'string') driver.plate = b.plate.trim().toUpperCase() || undefined;
    if (typeof b.active === 'boolean') driver.active = b.active;

    db.prepare('UPDATE drivers SET data = ? WHERE id = ?').run(JSON.stringify(driver), driver.id);
    io.emit('drivers:updated');
    res.json({ ...driver, password: undefined });
  });

  router.delete('/drivers/:id', requireRole('kitchen'), (req, res) => {
    const row = db.prepare('SELECT data FROM drivers WHERE id = ?').get(req.params.id) as
      | { data: string }
      | undefined;
    if (!row) return res.status(404).json({ error: 'Motoboy não encontrado.' });
    db.prepare('DELETE FROM drivers WHERE id = ?').run(req.params.id);
    io.emit('drivers:updated');
    res.json({ ok: true });
  });

  // Presença do entregador (online/offline + última posição)
  router.post('/drivers/:id/presence', (req, res) => {
    const row = db.prepare('SELECT data FROM drivers WHERE id = ?').get(req.params.id) as
      | { data: string }
      | undefined;
    if (!row) return res.status(404).json({ error: 'Motoboy não encontrado.' });
    const driver: Driver = JSON.parse(row.data);
    if (typeof req.body?.online === 'boolean') driver.online = req.body.online;
    if (typeof req.body?.lat === 'number') driver.lat = req.body.lat;
    if (typeof req.body?.lng === 'number') driver.lng = req.body.lng;
    db.prepare('UPDATE drivers SET data = ? WHERE id = ?').run(JSON.stringify(driver), driver.id);
    io.emit('drivers:updated');
    res.json({ ...driver, password: undefined });
  });

  return router;
}
