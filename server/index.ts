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
import { driverFromToken } from './driverSession';
import { recordDriverLocation } from './driverLocation';
import { createDriverPresence } from './driverPresence';

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

// Em produção, serve o build do frontend.
//
// O `express.static` sem opções manda `max-age=0`: todo arquivo do bundle
// revalidava a cada abertura do app, e um celular no 3G da rua pagava uma volta
// de rede por asset só para ouvir "não mudou". Como o Vite põe o hash do
// conteúdo no nome de tudo que sai em /assets, o nome já é a versão.
const distDir = path.join(__dirname, '..', 'dist');
const NO_CACHE = 'no-cache';

if (fs.existsSync(distDir)) {
  // Nome com hash = arquivo imutável. Um deploy novo gera nomes novos, então
  // guardar para sempre nunca serve conteúdo velho.
  app.use(
    '/assets',
    express.static(path.join(distDir, 'assets'), { immutable: true, maxAge: '1y' })
  );

  // O index.html e o service worker são os únicos que apontam para os nomes
  // novos. Um deles guardado em cache é um deploy que nunca chega a ninguém —
  // o app fica preso na versão antiga sem ninguém entender por quê.
  // `sw.js` é tratado defensivamente: se o arquivo não existir, o setHeaders
  // simplesmente nunca roda para ele.
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        const name = path.basename(filePath);
        if (name === 'sw.js' || filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', NO_CACHE);
        }
      },
    })
  );

  // Fallback do SPA (inclui a raiz, por causa do `index: false` acima).
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', NO_CACHE);
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// Precisa vir depois de todas as rotas: captura erros de handlers async
// encaminhados via asyncRoute(fn) (ver server/routes.ts).
app.use(errorHandler);

// GPS real do entregador: o app do motoboy envia sua posição via socket,
// o servidor persiste e transmite aos clientes rastreando o pedido.
//
// A política de presença (janela de graça, multi-aba, volta do bolso) mora em
// `driverPresence`; aqui ficam só os fios: quem conta os sockets e quem avisa
// a cozinha.
const driverPresence = createDriverPresence({
  resolveDriver: driverFromToken,
  loadDriver,
  saveDriver,
  countSessions: async (driverId) => (await io.in('driver:' + driverId).fetchSockets()).length,
  onPresenceChanged: () => io.to('kitchen').emit('drivers:updated'),
});

io.on('connection', (socket) => {
  socket.on(
    'join',
    (payload: { role?: string; token?: string; customerId?: string; online?: boolean }) => {
      const { role, token, customerId, online } = payload ?? {};
      if (role === 'kitchen' && token === getRoleToken('kitchen')) socket.join('kitchen');
      if (role === 'driver') {
        // A identidade sai do token, nunca do payload: o `driverId` enviado pelo
        // app punha qualquer motoboy dentro da sala privada de outro, que é por
        // onde passa o contato do cliente da corrida.
        //
        // O `online` do payload é intenção, não identidade: diz "ainda estou de
        // turno", e é o que traz o motoboy de volta ao quadro da cozinha depois
        // de a tela ficar bloqueada tempo demais — sem ele precisar tocar em
        // nada. Quem ele é continua saindo da credencial.
        const driver = driverPresence.join(typeof token === 'string' ? token : '', online);
        if (driver) {
          socket.data.driverId = driver.id;
          socket.join('drivers');
          // Sala própria: só ela recebe os dados do cliente da corrida aceita.
          socket.join('driver:' + driver.id);
        }
      }
      if (typeof customerId === 'string' && customerId.trim() && customerId !== 'anon') {
        socket.join('customer:' + customerId.trim().slice(0, 80));
      }
    }
  );

  socket.on('driver:location', (payload: { lat?: number; lng?: number }) => {
    const driverId = socket.data.driverId as string | undefined;
    if (!driverId) return;
    const { lat, lng } = payload ?? {};

    const moved = recordDriverLocation(driverId, lat, lng, {
      loadDriver,
      saveDriver,
      listOrdersByStatus,
      applyMove: (order, id, pointLat, pointLng, at) =>
        applyOrderEvent(
          order,
          { type: 'move', driverId: id, lat: pointLat, lng: pointLng, at },
          { getSettings, getDriver: loadDriver, saveOrder, earnStamp }
        ).order,
    });

    for (const order of moved) emitOrder(io, 'order:updated', order);
    // O pino do motoboy no mapa da cozinha não vem do pedido, então precisa
    // deste aviso — mas só quando alguma corrida de fato andou.
    if (moved.length) io.to('kitchen').emit('drivers:updated');
  });

  socket.on('disconnect', () => {
    const driverId = socket.data.driverId as string | undefined;
    if (!driverId) return;
    // Cair não é ir embora: `driverPresence` agenda o desligamento e a volta do
    // motoboy dentro da janela cancela o agendamento.
    void driverPresence.disconnect(driverId);
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
