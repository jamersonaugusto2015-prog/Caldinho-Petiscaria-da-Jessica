/**
 * Simulador de GPS do entregador.
 *
 * Sobe uma corrida de verdade e "anda" o motoboy da loja até o cliente,
 * conferindo se cozinha e cliente recebem cada posição em tempo real.
 *
 * COMO USAR — nunca aponte para o banco de produção:
 *
 *   1) suba uma API isolada:
 *      PORT=3999 DATA_DIR=/tmp/gps-test npx tsx server/index.ts
 *
 *   2) rode o simulador:
 *      npx tsx scripts/gps-sim.ts
 *
 * Variáveis: BASE_URL (padrão http://localhost:3999), STEPS (12), INTERVAL_MS (300).
 * Sai com código 0 se tudo passou, 1 se algo falhou.
 */
import { io, Socket } from 'socket.io-client';

const BASE = process.env.BASE_URL || 'http://localhost:3999';
const STEPS = Number(process.env.STEPS || 12);
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 300);

const CUSTOMER_ID = 'cust-sim-' + process.pid;
const STORE = { lat: -8.0476, lng: -34.877 };          // Recife centro (padrão da loja)
const DEST = { lat: -8.0578, lng: -34.8829 };          // ~1,3 km a sudoeste

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  OK  ' : ' FALHA'} | ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

async function api(path: string, opts: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = opts;
  const res = await fetch(BASE + path, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-role-token': token } : {}),
      ...(rest.headers || {}),
    },
  });
  const body = await res.text();
  let json: any = null;
  try { json = JSON.parse(body); } catch { /* resposta não-JSON */ }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${body.slice(0, 300)}`);
  return json;
}

function joined(socket: Socket, payload: object): Promise<void> {
  return new Promise((resolve) => {
    socket.on('connect', () => { socket.emit('join', payload); setTimeout(resolve, 120); });
  });
}

/** Interpola a rota loja -> cliente com um leve zigue-zague, como uma moto na rua. */
function route(steps: number) {
  const pts: { lat: number; lng: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const jitter = Math.sin(t * Math.PI * 3) * 0.0004;
    pts.push({
      lat: +(STORE.lat + (DEST.lat - STORE.lat) * t + jitter).toFixed(6),
      lng: +(STORE.lng + (DEST.lng - STORE.lng) * t - jitter).toFixed(6),
    });
  }
  return pts;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n=== SIMULADOR DE GPS — ${BASE} ===\n`);

  // ---- 1. Login cozinha + motoboy
  const kitchen = await api('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ role: 'kitchen', pin: '1234' }),
  });
  const kToken = kitchen.token;
  check('login da cozinha', !!kToken);

  const driverLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ role: 'driver', name: 'Marcos Motoboy', pin: '1234' }),
  });
  const dToken = driverLogin.token;
  const driverId = driverLogin.driver.id;
  check('login do motoboy', !!dToken && !!driverId, `driverId=${driverId}`);

  // ---- 2. Garante loja aberta
  const settings = await api('/api/settings', { token: kToken });
  await api('/api/settings', {
    method: 'POST', token: kToken,
    body: JSON.stringify({ ...settings, forceOpen: true, orderEnabled: true }),
  });
  check('loja forçada aberta', true);

  // ---- 3. Cria um pedido de verdade
  const products = await api('/api/products');
  const product = products.find((p: any) => p.available) || products[0];
  check('produto do cardápio encontrado', !!product, product?.name);

  const created = await api('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ product: { id: product.id }, quantity: 1 }],
      address: {
        id: 'addr-sim', label: 'Casa', street: 'Rua Simulada', number: '100',
        neighborhood: 'Boa Viagem', city: 'Recife',
        lat: DEST.lat, lng: DEST.lng, distanceKm: 0,
      },
      paymentMethod: 'cash',
      customerName: 'Cliente Simulado',
      customerPhone: '(81) 90000-0000',
      customerId: CUSTOMER_ID,
    }),
  });
  const orderId = created.order.id;
  check('pedido criado', !!orderId, `#${orderId}`);

  // ---- 4. recebido -> em_preparo -> pronto -> (assign) saiu_entrega
  for (const status of ['em_preparo', 'pronto']) {
    await api(`/api/orders/${orderId}/status`, {
      method: 'PATCH', token: kToken, body: JSON.stringify({ status }),
    });
  }
  const assigned = await api(`/api/orders/${orderId}/assign`, {
    method: 'POST', token: dToken, body: JSON.stringify({ driverId }),
  });
  check('corrida aceita, status saiu_entrega', assigned.status === 'saiu_entrega', assigned.status);
  check(
    'posição inicial do motoboy = loja',
    assigned.driverLat === STORE.lat && assigned.driverLng === STORE.lng,
    `${assigned.driverLat}, ${assigned.driverLng}`
  );

  // ---- 5. Três ouvintes: motoboy (emite), cliente e cozinha (recebem)
  const mk = () => io(BASE, { transports: ['websocket'], forceNew: true });
  const driverSock = mk(), customerSock = mk(), kitchenSock = mk();

  const customerHits: any[] = [];
  const kitchenHits: any[] = [];
  const orderUpdates: any[] = [];
  customerSock.on('driver:location', (p) => customerHits.push({ ...p, at: Date.now() }));
  kitchenSock.on('driver:location', (p) => kitchenHits.push({ ...p, at: Date.now() }));
  customerSock.on('order:updated', (o) => orderUpdates.push(o));

  await Promise.all([
    joined(driverSock, { role: 'driver', token: dToken, driverId }),
    joined(customerSock, { customerId: CUSTOMER_ID }),
    joined(kitchenSock, { role: 'kitchen', token: kToken }),
  ]);
  check('3 sockets conectados', driverSock.connected && customerSock.connected && kitchenSock.connected);

  // ---- 6. Anda a rota
  const pts = route(STEPS);
  console.log(`\n  Percorrendo ${pts.length} pontos, 1 a cada ${INTERVAL_MS}ms...\n`);
  const t0 = Date.now();
  for (const [i, p] of pts.entries()) {
    driverSock.volatile.emit('driver:location', { driverId, lat: p.lat, lng: p.lng });
    process.stdout.write(`    ${String(i + 1).padStart(2)}/${pts.length}  ${p.lat}, ${p.lng}\r`);
    await sleep(INTERVAL_MS);
  }
  await sleep(700); // margem para os últimos pacotes
  console.log('\n');

  // ---- 7. Conferências
  check('cliente recebeu todas as posições', customerHits.length === pts.length,
    `${customerHits.length}/${pts.length}`);
  check('cozinha recebeu todas as posições', kitchenHits.length === pts.length,
    `${kitchenHits.length}/${pts.length}`);

  const inOrder = customerHits.every((h, i) => h.lat === pts[i].lat && h.lng === pts[i].lng);
  check('posições chegaram na ordem certa e sem distorção', inOrder);

  const latencies = customerHits.map((h, i) => h.at - (t0 + i * INTERVAL_MS));
  const avg = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);
  check('latência média abaixo de 150ms', avg < 150, `${avg.toFixed(0)}ms`);

  const finalOrder = await api(`/api/orders?customerId=${CUSTOMER_ID}`);
  const o = finalOrder.find((x: any) => x.id === orderId);
  const last = pts[pts.length - 1];
  check('última posição gravada no pedido', o.driverLat === last.lat && o.driverLng === last.lng,
    `${o.driverLat}, ${o.driverLng}`);

  const drivers = await api('/api/drivers', { token: kToken });
  const drv = drivers.find((d: any) => d.id === driverId);
  check('última posição gravada no motoboy', drv.lat === last.lat && drv.lng === last.lng,
    `${drv.lat}, ${drv.lng}`);

  check('cliente também recebeu order:updated a cada passo', orderUpdates.length >= pts.length,
    `${orderUpdates.length} eventos`);

  // ---- 8. Casos negativos
  const spy: any[] = [];
  const outsider = mk();
  outsider.on('driver:location', (p) => spy.push(p));
  await joined(outsider, { customerId: 'cust-alheio-xyz' });
  driverSock.volatile.emit('driver:location', { driverId, lat: -8.05, lng: -34.88 });
  await sleep(400);
  check('cliente de outro pedido NÃO recebe a posição', spy.length === 0, `${spy.length} vazamentos`);

  const before = customerHits.length;
  driverSock.volatile.emit('driver:location', { driverId: 'drv-inexistente', lat: -8.05, lng: -34.88 });
  driverSock.volatile.emit('driver:location', { driverId, lat: 'abc' as any, lng: -34.88 });
  driverSock.volatile.emit('driver:location', { driverId, lat: NaN, lng: -34.88 });
  await sleep(400);
  check('posições inválidas são descartadas', customerHits.length === before + 0,
    `${customerHits.length - before} passaram`);

  [driverSock, customerSock, kitchenSock, outsider].forEach((s) => s.close());

  console.log(`\n=== ${failures === 0 ? 'TUDO PASSOU' : failures + ' FALHA(S)'} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nERRO:', e.message); process.exit(1); });
