import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { createRoutes } from './routes';
import { db } from './db';
import { hashPassword } from './auth';
import { runBackup } from './backup';
import { Order } from '../src/types';
import { UPLOADS_DIR } from './paths';

// Redefinição de emergência do PIN da cozinha via variável de ambiente:
// defina KITCHEN_PIN_RESET=<novo pin> no painel do Render, faça deploy,
// entre com o novo PIN e depois REMOVA a variável (senão ela redefine a cada boot).
if (process.env.KITCHEN_PIN_RESET && process.env.KITCHEN_PIN_RESET.length >= 4) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('kitchen_pin_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(hashPassword(process.env.KITCHEN_PIN_RESET));
  console.log('🔑 PIN da cozinha redefinido via KITCHEN_PIN_RESET');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '25mb' }));

// Headers de segurança básicos
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const server = http.createServer(app);
const corsOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true;
const io = new Server(server, {
  cors: { origin: corsOrigins, methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
});

app.use('/api', createRoutes(io));
app.use('/api/uploads', express.static(UPLOADS_DIR));

// Em produção, serve o build do frontend
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// GPS real do entregador: o app do motoboy envia sua posição via socket,
// o servidor persiste e transmite aos clientes rastreando o pedido.
io.on('connection', (socket) => {
  socket.on('driver:location', (payload: { driverId?: string; lat?: number; lng?: number }) => {
    const { driverId, lat, lng } = payload ?? {};
    if (!driverId || typeof lat !== 'number' || typeof lng !== 'number') return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    // Atualiza pedidos em entrega atribuídos a este motoboy
    const rows = db
      .prepare("SELECT data FROM orders WHERE status = 'saiu_entrega'")
      .all() as { data: string }[];
    for (const row of rows) {
      const order: Order = JSON.parse(row.data);
      if (order.driverId !== driverId) continue;
      order.driverLat = lat;
      order.driverLng = lng;
      db.prepare('UPDATE orders SET data = ? WHERE id = ?').run(JSON.stringify(order), order.id);
      io.emit('order:updated', order);
    }

    // Atualiza presença do motoboy
    const driverRow = db.prepare('SELECT data FROM drivers WHERE id = ?').get(driverId) as
      | { data: string }
      | undefined;
    if (driverRow) {
      const driver = JSON.parse(driverRow.data);
      driver.lat = lat;
      driver.lng = lng;
      db.prepare('UPDATE drivers SET data = ? WHERE id = ?').run(JSON.stringify(driver), driverId);
      io.emit('drivers:updated');
    }

    io.emit('driver:location', { driverId, lat, lng });
  });
});

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => {
  console.log(`🍲 Caldinho Express API rodando em http://localhost:${PORT}`);
  console.log('PIN da cozinha padrão: 1234 (alterável em Configurações)');
});

// ---------- Scheduler de backup automático (Google Drive) ----------
const BACKUP_CHECK_MS = 30 * 60 * 1000; // verifica a cada 30 min
setInterval(async () => {
  const meta = (key: string, fallback = '') =>
    (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined)?.value ?? fallback;

  if (meta('backup_enabled', 'false') !== 'true') return;
  const freqDays = Number(meta('backup_frequency_days', '1')) || 1;
  const last = meta('backup_last_run');
  if (last) {
    const hoursSince = (Date.now() - new Date(last).getTime()) / 3600000;
    if (hoursSince < freqDays * 24) return;
  }
  const result = await runBackup();
  console.log(result.ok ? `[backup] ok: ${meta('backup_last_file')}` : `[backup] erro: ${result.error}`);
}, BACKUP_CHECK_MS);
