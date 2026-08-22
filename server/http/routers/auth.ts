import { Router } from 'express';
import type { Driver } from '../../../contract/driver/types';
import { verifyPassword } from '../../auth';
import { findDriverByName } from '../../domain/driver/store';
import { issueDriverToken, publicDriver } from '../../driverSession';
import { getRoleToken, getSecret } from '../../infra/secrets';
import { loginBlockedMs, loginKey, registerLoginFailure, registerLoginSuccess } from '../middleware/auth';
import { asyncRoute } from '../middleware/errors';
import { shopIdOf } from '../middleware/tenant';

/**
 * Login da cozinha e do motoboy.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function authRouter(): Router {
  const router = Router();

  // ---------- Auth ----------
  router.post(
    '/auth/login',
    asyncRoute(async (req, res) => {
    const { role, pin } = req.body ?? {};
    if (role !== 'kitchen' && role !== 'driver') {
      return res.status(400).json({ error: 'Escolha o papel de login: cozinha ou motoboy.' });
    }

    // No papel driver a chave do rate-limit leva o nome informado: com
    // `${ip}:driver` um motoboy errando a senha trancava a equipe inteira, já
    // que todos saem pelo mesmo Wi-Fi da loja.
    const loginName = typeof req.body?.name === 'string' ? req.body.name.trim().toLowerCase() : '';
    // A LOJA entra na chave. Sem ela, cinco erros contra a loja A trancariam o
    // login da loja B para o mesmo IP — e um wi-fi de prédio ou uma operadora
    // móvel põe centenas de pessoas atrás do mesmo endereço.
    const attemptKey = loginKey(
      shopIdOf(req),
      req.ip,
      role === 'driver' ? `driver:${loginName}` : role
    );
    const blockedMs = loginBlockedMs(attemptKey);
    if (blockedMs > 0) {
      return res.status(429).json({
        error: `Muitas tentativas. Aguarde ${Math.ceil(blockedMs / 1000)}s e tente de novo.`,
      });
    }

    if (role === 'driver') {
      // A busca por nome vai ao banco com `COLLATE NOCASE` — a MESMA comparação
      // que o índice único usa. Antes era um `.toLowerCase()` em JavaScript por
      // cima da equipe inteira, com duas regras de igualdade que podiam
      // discordar: um cadastro aceito que o login depois não achava.
      let driver: Driver | undefined =
        (loginName ? findDriverByName(shopIdOf(req), loginName) : null) ?? undefined;
      if (driver && (await verifyPassword(String(pin ?? ''), driver.password || ''))) {
        registerLoginSuccess(attemptKey);
        // Credencial própria do motoboy: o token diz QUEM é, não só que é um
        // motoboy. É o que permite revogar o acesso de um só ao demitir.
        const token = issueDriverToken(shopIdOf(req), driver.id);
        return res.json({ token, role, driver: publicDriver(driver) });
      }
      registerLoginFailure(attemptKey);
      return res.status(401).json({
        error: !loginName
          ? 'Informe seu nome de motoboy.'
          : 'Nome ou senha incorretos. Verifique com a cozinha.',
      });
    }

    // O hash do PIN é SEGREDO: ele saiu da `meta` para `shop_secrets` na
    // migração 019, justamente para não ser serializado junto em `GET /settings`.
    const pinHash = getSecret(shopIdOf(req), 'kitchen_pin_hash');
    if (await verifyPassword(String(pin ?? ''), pinHash)) {
      registerLoginSuccess(attemptKey);
      return res.json({ token: getRoleToken(shopIdOf(req), 'kitchen'), role });
    }
    registerLoginFailure(attemptKey);
    res.status(401).json({ error: 'PIN incorreto. Tente novamente.' });
  })
  );

  return router;
}
