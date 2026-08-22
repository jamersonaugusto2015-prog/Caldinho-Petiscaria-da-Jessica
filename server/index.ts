// O `.env` entra ANTES de qualquer outro import: `./config` é avaliado no
// momento em que é importado, e ele precisa encontrar o ambiente já montado.
import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { config } from './config';
import type { ShopId } from '../contract/shop/types';
import {
  customerRoom,
  driverRoom,
  driversRoom,
  kitchenRoom,
  shopRoom,
} from '../contract/shop/rooms';
import { resolveShop, resolveTenant } from './http/middleware/tenant';
import { platformRouter } from './http/routers/platform';
import { requestLogger } from './http/middleware/logging';
import {
  driverLocationDeps,
  driverPresenceDeps,
  orderLifecycleDeps,
} from './domain/deps';
import { createRoutes, emitOrder, errorHandler } from './routes';
import { LOJA_PADRAO, db, getMetaValue } from './db';
import { getRoleToken, setSecret } from './infra/secrets';
import { listShops, onShopsChanged, shopById } from './infra/shops';
import { hashPasswordSync } from './auth';
import { runBackup } from './backup';
import { legacyUploadFallback, shopUploadsGuard } from './http/routers/uploads';
import { UPLOADS_DIR } from './paths';
import { applyOrderEvent } from './orderLifecycle';
import { driverFromToken } from './driverSession';
import { recordDriverLocation } from './driverLocation';
import { createDriverPresence } from './driverPresence';

// Redefinição de emergência do PIN da cozinha via variável de ambiente:
// defina KITCHEN_PIN_RESET=<novo pin> no painel do Render, faça deploy,
// entre com o novo PIN e depois REMOVA a variável (senão ela redefine a cada boot).
// ⚠ Isto redefine o PIN da loja 1 e SÓ dela: uma variável de ambiente não sabe
// endereçar uma loja entre várias. Na Fase 9 este bloco sai daqui e vira
// `POST /api/platform/shops/:id/reset-pin`, no painel super-admin.
if (config.KITCHEN_PIN_RESET) {
  setSecret(LOJA_PADRAO, 'kitchen_pin_hash', hashPasswordSync(config.KITCHEN_PIN_RESET));
  console.log('🔑 PIN da cozinha redefinido via KITCHEN_PIN_RESET');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();

// Atrás do proxy do Render (e de qualquer CDN), o IP do cliente chega em
// `X-Forwarded-For`. Sem isto o Express reporta o IP do proxy em `req.ip`:
// todo mundo vira o MESMO IP, e o rate limit de login e os throttles passam a
// contar o tráfego do prédio inteiro como se fosse uma pessoa só. `1` = confia
// em exatamente um salto de proxy (o do Render), não na cadeia inteira.
app.set('trust proxy', 1);

app.use(express.json({ limit: '25mb' }));

/**
 * O log vem antes de tudo: uma requisição que morre no middleware de loja (404
 * de loja inexistente) é justamente a que precisa aparecer.
 */
app.use(requestLogger);

// Headers de segurança básicos
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const server = http.createServer(app);
const corsOrigins = config.corsOrigins;
const io = new Server(server, {
  cors: { origin: corsOrigins, methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
});

/**
 * A loja entra AQUI, antes de qualquer rota.
 *
 * Toda rota de `/api` depende de `req.shop`, e `currentShop` lança se ele não
 * estiver lá — de propósito. Uma rota que resolvesse a loja sozinha, ou que
 * caísse na loja 1 em silêncio, é exatamente como uma loja passa a servir dados
 * da outra sem ninguém perceber.
 */
/**
 * Sem `SHOP_BASE_DOMAIN`, a resolução por `Host` cai numa heurística ambígua:
 * `dominio.com.br` tem os mesmos três rótulos de `loja.dominio.com`, e o
 * domínio raiz seria lido como uma loja chamada "dominio". Em produção isso é
 * um erro de configuração que precisa aparecer no boot, não num 404 estranho
 * semanas depois.
 */
if (config.isProduction && !config.SHOP_BASE_DOMAIN) {
  console.warn(
    '⚠️  SHOP_BASE_DOMAIN não configurado: a loja será resolvida por heurística de subdomínio, que é ambígua em domínios .com.br. Defina SHOP_BASE_DOMAIN=seudominio.com.br.'
  );
}

/**
 * `NODE_ENV` ausente liga, em silêncio, os atalhos de desenvolvimento — o
 * header `x-shop-slug` passa a escolher a loja. Num deploy de verdade isso
 * não pode passar despercebido.
 */
if (!process.env.NODE_ENV) {
  console.warn(
    '⚠️  NODE_ENV não definido: rodando em modo desenvolvimento (o header x-shop-slug escolhe a loja). Em produção, defina NODE_ENV=production.'
  );
}

/**
 * O painel da plataforma vem ANTES do `resolveTenant`, e é isso que o mantém
 * fora de qualquer loja.
 *
 * Passar por ele significaria que `/api/platform/*` só responderia num
 * subdomínio de loja — e o painel que CRIA lojas moraria dentro de uma delas.
 * Ele atende no domínio raiz, onde `resolveTenant` responde "plataforma".
 */
app.use('/api/platform', platformRouter());

/**
 * `/api/health` fica ANTES do `resolveTenant`: o Render sonda essa rota com o
 * Host do serviço (`*.onrender.com`), que não resolve loja nenhuma — atrás do
 * `resolveTenant` a sonda levava 404 e o deploy inteiro era marcado como
 * doente. Toca o banco de propósito: um "ok" tem que significar disco lido.
 */
app.get('/api/health', (_req, res) => {
  try {
    // `SELECT count(*) FROM shops` LÊ uma página do arquivo — `SELECT 1` era
    // respondido sem tocar no disco, então dizia "ok" com o volume desmontado
    // ou o arquivo corrompido, que é justamente o que o health precisa pegar.
    db.prepare('SELECT count(*) FROM shops').get();
  } catch (err) {
    console.error('[health] o banco não respondeu:', err);
    return res.status(503).json({ ok: false, error: 'Banco de dados indisponível.' });
  }
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use('/api', resolveTenant, createRoutes(io));
// `legacyUploadFallback` reescreve as URLs sem loja gravadas antes da Fase 10
// para a pasta da loja padrão (ver server/http/routers/uploads.ts).
app.use('/api/uploads', legacyUploadFallback, shopUploadsGuard, express.static(UPLOADS_DIR));

/**
 * Caminho de `/api` que nenhum router atendeu para aqui.
 *
 * Sem esta linha, ele caía no `app.get('*')` lá embaixo e recebia o HTML do
 * SPA — com status 200. Quem chamou esperava JSON: o `fetch` do app quebra num
 * "Unexpected token '<'", que não diz nada sobre o endereço estar errado.
 */
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Endereço não encontrado nesta API.' });
});

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
/**
 * Uma presença POR LOJA. Ela guarda estado (temporizadores da janela de graça,
 * contagem de abas), e uma instância só serviria a loja errada: o motoboy da
 * loja B sairia do turno porque um da loja A fechou a aba.
 *
 * O mapa é preenchido sob demanda — a maior parte das lojas não tem motoboy
 * conectado na maior parte do tempo.
 */
const presencaPorLoja = new Map<ShopId, ReturnType<typeof createDriverPresence>>();

function presencaDe(shopId: ShopId) {
  let presenca = presencaPorLoja.get(shopId);
  if (!presenca) {
    presenca = createDriverPresence(
      driverPresenceDeps(shopId, {
        resolveDriver: (token) => driverFromToken(shopId, token),
        countSessions: async (driverId) =>
          (await io.in(driverRoom(shopId, driverId)).fetchSockets()).length,
        onPresenceChanged: () => io.to(kitchenRoom(shopId)).emit('drivers:updated'),
      })
    );
    presencaPorLoja.set(shopId, presenca);
  }
  return presenca;
}

/**
 * Desativou a loja no painel? O HTTP corta na requisição seguinte, mas um
 * socket já conectado viveria para sempre recebendo pedido, chat e presença.
 * Toda escrita em `shops` invalida o cache — e este ouvinte derruba os
 * sockets das lojas que deixaram de estar ativas.
 */
onShopsChanged(() => {
  void io.fetchSockets().then((sockets) => {
    for (const conectado of sockets) {
      const daLoja = conectado.data.shopId as ShopId | undefined;
      if (daLoja != null && !shopById(daLoja)?.active) conectado.disconnect(true);
    }
  });
});

io.on('connection', (socket) => {
  /**
   * A LOJA DO SOCKET SAI DO HANDSHAKE, nunca do payload.
   *
   * É a mesma regra do HTTP, e pelo mesmo motivo: um `shopId` que o cliente
   * informa é a chave da sala da cozinha de qualquer loja — cada pedido novo,
   * com nome, telefone e endereço, entregue a quem pedisse.
   */
  const resolvida = resolveShop({
    host: socket.handshake.headers.host,
    // Em dev o slug pode chegar pelo header (transporte polling) OU pela query
    // (WebSocket, onde o header não passa). Em produção o `resolveShop` ignora
    // os dois: a loja sai do `Host`.
    headerSlug:
      (socket.handshake.headers['x-shop-slug'] as string | undefined) ||
      (typeof socket.handshake.query.loja === 'string' ? socket.handshake.query.loja : undefined),
  });
  if (!resolvida || resolvida === 'plataforma' || !resolvida.active) {
    // Sem loja não há sala nenhuma para entrar. Derrubar é mais honesto do que
    // deixar um socket conectado que nunca receberia evento algum.
    socket.disconnect(true);
    return;
  }
  const shopId = resolvida.id;
  socket.data.shopId = shopId;

  // Sala de todo mundo desta loja: é por ela que passam os avisos de catálogo,
  // cupom e configuração, que antes iam num `io.emit` para o servidor inteiro.
  socket.join(shopRoom(shopId));

  socket.on(
    'join',
    (payload: { role?: string; token?: string; customerId?: string; online?: boolean }) => {
      const { role, token, customerId, online } = payload ?? {};
      // Desativar a loja no painel vale para socket vivo também: o handshake
      // aconteceu horas atrás, e este é o primeiro lugar onde dá para recusar.
      if (!shopById(shopId)?.active) {
        socket.disconnect(true);
        return;
      }
      // O `token &&` recusa o vazio: `getRoleToken` devolve '' quando a loja
      // não tem token gravado, e `'' === ''` abriria a sala da cozinha para
      // qualquer socket anônimo dessa loja.
      if (role === 'kitchen' && token && token === getRoleToken(shopId, 'kitchen')) {
        socket.join(kitchenRoom(shopId));
      }
      if (role === 'driver') {
        // A identidade sai do token, nunca do payload: o `driverId` enviado pelo
        // app punha qualquer motoboy dentro da sala privada de outro, que é por
        // onde passa o contato do cliente da corrida.
        //
        // O `online` do payload é intenção, não identidade: diz "ainda estou de
        // turno", e é o que traz o motoboy de volta ao quadro da cozinha depois
        // de a tela ficar bloqueada tempo demais — sem ele precisar tocar em
        // nada. Quem ele é continua saindo da credencial.
        const driver = presencaDe(shopId).join(typeof token === 'string' ? token : '', online);
        if (driver) {
          socket.data.driverId = driver.id;
          socket.join(driversRoom(shopId));
          // Sala própria: só ela recebe os dados do cliente da corrida aceita.
          socket.join(driverRoom(shopId, driver.id));
        }
      }
      if (typeof customerId === 'string' && customerId.trim() && customerId !== 'anon') {
        socket.join(customerRoom(shopId, customerId.trim().slice(0, 80)));
      }
    }
  );

  // Largar as salas de papel sem derrubar a conexão: é o que um logout no
  // mesmo aparelho precisa, para o próximo usuário não herdar as salas do
  // anterior. A sala da loja (catálogo, cupom, configuração) fica.
  socket.on('leave', () => {
    for (const sala of socket.rooms) {
      if (sala !== socket.id && sala !== shopRoom(shopId)) socket.leave(sala);
    }
    socket.data.driverId = undefined;
  });

  socket.on('driver:location', (payload: { lat?: number; lng?: number }) => {
    const driverId = socket.data.driverId as string | undefined;
    if (!driverId) return;
    const { lat, lng } = payload ?? {};

    const moved = recordDriverLocation(
      driverId,
      lat,
      lng,
      // A loja sai do socket, que a resolveu pelo `Host` do handshake. Sem
      // isto, um ponto de GPS de um motoboy da loja A varreria as corridas da
      // loja B procurando qual atualizar.
      driverLocationDeps(shopId, (order, id, pointLat, pointLng, at) =>
        applyOrderEvent(
          order,
          { type: 'move', driverId: id, lat: pointLat, lng: pointLng, at },
          orderLifecycleDeps(shopId)
        ).order
      )
    );

    for (const order of moved) emitOrder(io, shopId, 'order:updated', order);
    // O pino do motoboy no mapa da cozinha não vem do pedido, então precisa
    // deste aviso — mas só quando alguma corrida de fato andou.
    if (moved.length) io.to(kitchenRoom(shopId)).emit('drivers:updated');
  });

  socket.on('disconnect', () => {
    const driverId = socket.data.driverId as string | undefined;
    if (!driverId) return;
    // Cair não é ir embora: `driverPresence` agenda o desligamento e a volta do
    // motoboy dentro da janela cancela o agendamento.
    void presencaDe(shopId).disconnect(driverId);
  });
});

const PORT = config.PORT;
server.listen(PORT, () => {
  console.log(`🍲 Caldinho Express API rodando em http://localhost:${PORT}`);
  console.log('PIN da cozinha padrão: 1234 (alterável em Configurações)');
});

// ---------- Scheduler de backup automático (Google Drive) ----------
const BACKUP_CHECK_MS = 30 * 60 * 1000; // verifica a cada 30 min
setInterval(async () => {
  // Itera as lojas ATIVAS, cada uma com a sua frequência e a sua credencial do
  // Drive. Sequencial de propósito, não `Promise.all`: são poucas lojas, e
  // rodar uma de cada vez evita que várias fiquem tirando snapshot do mesmo
  // SQLite ao mesmo tempo só para disputar I/O. O try/catch por loja é o que
  // garante que uma falhando (credencial vencida, pasta do Drive apagada) não
  // impede a próxima de rodar.
  for (const shop of listShops()) {
    if (!shop.active) continue;
    try {
      const meta = (key: string, fallback = '') => getMetaValue(shop.id, key, fallback);
      if (meta('backup_enabled', 'true') !== 'true') continue;
      const freqDays = Number(meta('backup_frequency_days', '1')) || 1;
      const last = meta('backup_last_run');
      if (last) {
        const hoursSince = (Date.now() - new Date(last).getTime()) / 3600000;
        if (hoursSince < freqDays * 24) continue;
      }
      const result = await runBackup(shop.id);
      console.log(
        result.ok
          ? `[backup] ${shop.slug}: ok (${meta('backup_last_file')})`
          : `[backup] ${shop.slug}: erro: ${result.error}`
      );
    } catch (err) {
      console.error(`[backup] ${shop.slug}: falha inesperada no scheduler`, err);
    }
  }
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
