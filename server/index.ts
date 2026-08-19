import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { createRoutes, emitOrder, errorHandler } from './routes';
import { db, getRoleToken, getSettings } from './db';
import { hashPasswordSync } from './auth';
import { runBackup } from './backup';
import { UPLOADS_DIR } from './paths';
import { listOrdersByStatus, loadDriver, saveDriver, saveOrder } from './orderStore';
import { applyOrderEvent } from './orderLifecycle';
import { earnStamp } from './loyalty';

// Redefinição de emergência do PIN da cozinha via variável de ambiente:
// defina KITCHEN_PIN_RESET=<novo pin> no painel do Render, faça deploy,
// entre com o novo PIN e depois REMOVA a variável (senão ela redefine a cada boot).
if (process.env.KITCHEN_PIN_RESET && process.env.KITCHEN_PIN_RESET.length >= 4) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('kitchen_pin_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(hashPasswordSync(process.env.KITCHEN_PIN_RESET));
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

// Precisa vir depois de todas as rotas: captura erros de handlers async
// encaminhados via asyncRoute(fn) (ver server/routes.ts).
app.use(errorHandler);

// GPS real do entregador: o app do motoboy envia sua posição via socket,
// o servidor persiste e transmite aos clientes rastreando o pedido.
io.on('connection', (socket) => {
  socket.on(
    'join',
    (payload: { role?: string; token?: string; customerId?: string; driverId?: string }) => {
      const { role, token, customerId, driverId } = payload ?? {};
      if (role === 'kitchen' && token === getRoleToken('kitchen')) socket.join('kitchen');
      if (role === 'driver' && token === getRoleToken('driver')) {
        socket.join('drivers');
        // Sala própria: só ela recebe os dados do cliente da corrida aceita.
        if (typeof driverId === 'string' && driverId.trim()) {
          socket.join('driver:' + driverId.trim().slice(0, 80));
        }
      }
      if (typeof customerId === 'string' && customerId.trim() && customerId !== 'anon') {
        socket.join('customer:' + customerId.trim().slice(0, 80));
      }
    }
  );

  socket.on('driver:location', (payload: { driverId?: string; lat?: number; lng?: number }) => {
    const { driverId, lat, lng } = payload ?? {};
    if (!driverId || typeof lat !== 'number' || typeof lng !== 'number') return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const driver = loadDriver(driverId);
    if (!driver) return;
    if (!driver.active) return;

    const orders = listOrdersByStatus('saiu_entrega');
    for (const order of orders) {
      if (order.driverId !== driverId) continue;
      try {
        const result = applyOrderEvent(
          order,
          { type: 'move', driverId, lat, lng },
          { getSettings, getDriver: loadDriver, saveOrder, earnStamp }
        );
        emitOrder(io, 'order:updated', result.order);
      } catch {
        // A corrida pode ter sido entregue/cancelada entre a leitura e o GPS.
      }
    }

    driver.lat = lat;
    driver.lng = lng;
    saveDriver(driver);
    io.to('kitchen').to('drivers').emit('drivers:updated');
    io.to('kitchen').to('drivers').emit('driver:location', { driverId, lat, lng });
    for (const order of orders) {
      if (order.driverId === driverId && order.customerId && order.customerId !== 'anon') {
        io.to(`customer:${order.customerId}`).emit('driver:location', { driverId, lat, lng });
      }
    }
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

  if (meta('backup_enabled', 'true') !== 'true') return;
  const freqDays = Number(meta('backup_frequency_days', '1')) || 1;
  const last = meta('backup_last_run');
  if (last) {
    const hoursSince = (Date.now() - new Date(last).getTime()) / 3600000;
    if (hoursSince < freqDays * 24) return;
  }
  const result = await runBackup();
  console.log(result.ok ? `[backup] ok: ${meta('backup_last_file')}` : `[backup] erro: ${result.error}`);
}, BACKUP_CHECK_MS);

// ---------- Ciclo de vida do processo ----------
// Sem isso, uma rejeição não tratada (ex.: fetch ao Mercado Pago que falha fora de
// um try/catch) derruba o processo inteiro (Node >=15) — cozinha, entregadores e
// sockets junto. Isso é uma rede de segurança; o fix de verdade é asyncRoute+errorHandler
// em routes.ts, que já captura os erros dos handlers HTTP antes que cheguem aqui.
process.on('unhandledRejection', (reason) => {
  console.error('Rejeição de Promise não tratada:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Exceção não capturada:', err);
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} recebido: encerrando graciosamente...`);

  const forceExit = setTimeout(() => {
    console.warn('Tempo limite de encerramento atingido, forçando saída.');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  // Para de aceitar novas conexões HTTP e espera as em andamento terminarem.
  server.close((err) => {
    if (err) console.error('Erro ao fechar o servidor HTTP:', err);
    // Fecha as conexões de socket.io (GPS do entregador, cozinha, etc.).
    io.close(() => {
      try {
        // Faz checkpoint do WAL e fecha o handle do SQLite.
        db.close();
      } catch (closeErr) {
        console.error('Erro ao fechar o banco de dados:', closeErr);
      }
      console.log('Encerramento concluído.');
      clearTimeout(forceExit);
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
