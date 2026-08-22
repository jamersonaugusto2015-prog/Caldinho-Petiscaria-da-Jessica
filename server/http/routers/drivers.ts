import { Router } from 'express';
import type { Server } from 'socket.io';
import type { Driver } from '../../../contract/driver/types';
import { shopRoom } from '../../../contract/shop/rooms';
import { hashPassword } from '../../auth';
import { deleteDriver, getDriver, insertDriver, listDrivers, updateDriver } from '../../domain/driver/store';
import { currentDriver, publicDriver, revokeDriverTokens } from '../../driverSession';
import { driverGuard } from '../context';
import { requireStaff } from '../middleware/auth';
import { asyncRoute } from '../middleware/errors';
import { shopIdOf } from '../middleware/tenant';
import { randomUUID } from 'crypto';

/**
 * O cadastro e a presença dos motoboys.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function driversRouter(io: Server): Router {
  const router = Router();

  // ---------- Drivers / Motoboys ----------
  router.get('/drivers', requireStaff('kitchen'), (req, res) => {
    res.json(listDrivers(shopIdOf(req)).map(publicDriver));
  });

  router.post(
    '/drivers',
    requireStaff('kitchen'),
    asyncRoute(async (req, res) => {
    const d = req.body as Driver;
    // Tipo conferido: `{name: 123}` passava no teste de truthy e o `.trim()`
    // abaixo estourava um 500 em vez de um 400 que a cozinha entende.
    if (typeof d?.name !== 'string' || !d.name.trim() || typeof d?.password !== 'string' || !d.password) {
      return res.status(400).json({ error: 'Nome e senha do motoboy são obrigatórios.' });
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
    // O nome repetido é recusado pelo índice `UNIQUE(shop_id, name)` — e é
    // `insertDriver` que traduz a violação na frase que a cozinha lê. O laço em
    // JavaScript que fazia essa checagem antes perdia a corrida entre dois
    // cadastros simultâneos.
    insertDriver(shopIdOf(req), driver);
    io.to(shopRoom(shopIdOf(req))).emit('drivers:updated');
    res.status(201).json(publicDriver(driver));
  })
  );

  router.patch(
    '/drivers/:id',
    requireStaff('kitchen'),
    asyncRoute(async (req, res) => {
    const driver = getDriver(shopIdOf(req), req.params.id);
    if (!driver) return res.status(404).json({ error: 'Motoboy não encontrado.' });

    const b = req.body ?? {};
    if (typeof b.name === 'string' && b.name.trim()) driver.name = b.name.trim();
    if (typeof b.phone === 'string') driver.phone = b.phone.trim() || undefined;
    const passwordChanged = typeof b.password === 'string' && !!b.password.trim();
    if (passwordChanged) driver.password = await hashPassword(b.password);
    if (typeof b.bikeModel === 'string') driver.bikeModel = b.bikeModel.trim() || undefined;
    if (typeof b.plate === 'string') driver.plate = b.plate.trim().toUpperCase() || undefined;
    const deactivated = b.active === false && driver.active !== false;
    if (typeof b.active === 'boolean') driver.active = b.active;

    updateDriver(shopIdOf(req), driver);
    // Demitir ou trocar a senha precisa cortar o acesso agora: sem isso o token
    // guardado no celular do ex-funcionário continuava lendo os pedidos.
    if (deactivated || passwordChanged) revokeDriverTokens(shopIdOf(req), driver.id);
    io.to(shopRoom(shopIdOf(req))).emit('drivers:updated');
    res.json(publicDriver(driver));
  })
  );

  router.delete('/drivers/:id', requireStaff('kitchen'), (req, res) => {
    if (!getDriver(shopIdOf(req), req.params.id)) {
      return res.status(404).json({ error: 'Motoboy não encontrado.' });
    }
    deleteDriver(shopIdOf(req), req.params.id);
    revokeDriverTokens(shopIdOf(req), req.params.id);
    io.to(shopRoom(shopIdOf(req))).emit('drivers:updated');
    res.json({ ok: true });
  });

  // Presença do entregador (online/offline + última posição)
  // O app do motoboy recarrega sem estado: sem esta leitura ele voltaria sempre
  // como OFFLINE mesmo tendo ficado online no servidor.
  // A presença é do próprio motoboy: qualquer um podia ler e escrever o
  // cadastro de qualquer outro, inclusive desligá-lo do turno.
  router.get('/drivers/:id/presence', driverGuard, (req, res) => {
    const driver = currentDriver(res);
    if (req.params.id !== driver.id) {
      return res.status(403).json({ error: 'Você só pode ver a sua própria presença.' });
    }
    res.json(publicDriver(driver));
  });

  router.post('/drivers/:id/presence', driverGuard, (req, res) => {
    const driver = currentDriver(res);
    if (req.params.id !== driver.id) {
      return res.status(403).json({ error: 'Você só pode mudar a sua própria presença.' });
    }
    // Só `online` entra aqui. A posição é responsabilidade do módulo
    // `driverLocation`, que valida a coordenada e move as corridas junto.
    if (typeof req.body?.online === 'boolean') driver.online = req.body.online;
    updateDriver(shopIdOf(req), driver);
    io.to(shopRoom(shopIdOf(req))).emit('drivers:updated');
    res.json(publicDriver(driver));
  });

  return router;
}
