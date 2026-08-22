import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, beforeEach } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import type { Driver } from '../contract/driver/types';
// server/db.ts abre o sqlite real assim que é importado, e o DATA_DIR de
// desenvolvimento deste repo é o banco de verdade do usuário. Este override
// precisa rodar ANTES de ./driverSession carregar, daí o import dinâmico abaixo.
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'caldinho-driver-session-test-'));
process.env.DATA_DIR = DATA_DIR;

const {
  currentDriver,
  driverFromRequest,
  driverFromToken,
  issueDriverToken,
  publicDriver,
  requireDriver,
  revokeDriverToken,
  revokeDriverTokens,
  tokenFromRequest,
} = await import('./driverSession');
const { db, LOJA_PADRAO } = await import('./db');

after(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

// `drivers` ganhou UNIQUE(shop_id, name): sem limpar entre testes, um motoboy
// de um teste anterior com o mesmo nome padrão faria o INSERT OR REPLACE
// apagar a linha do teste errado por baixo dos panos.
beforeEach(() => {
  db.prepare('DELETE FROM driver_tokens').run();
  db.prepare('DELETE FROM drivers').run();
});

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  const driver: Driver = {
    id: 'drv-teste',
    name: 'Marcos Motoboy',
    phone: '81988887777',
    password: 'hash-secreto',
    bikeModel: 'Honda Biz 125',
    plate: 'PCD-1A23',
    active: true,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
  db.prepare(
    'INSERT OR REPLACE INTO drivers (id, shop_id, name, active, data) VALUES (?, ?, ?, ?, ?)'
  ).run(driver.id, LOJA_PADRAO, driver.name, driver.active ? 1 : 0, JSON.stringify(driver));
  return driver;
}

function fakeReq(headers: Record<string, unknown> = {}): Request {
  return {
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

interface FakeRes {
  res: Response;
  statusCode: number | null;
  body: unknown;
  locals: Record<string, unknown>;
}

function fakeRes(): FakeRes {
  const state: FakeRes = {
    locals: {},
    statusCode: null,
    body: undefined,
    res: undefined as unknown as Response,
  };
  const res = {
    locals: state.locals,
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  };
  state.res = res as unknown as Response;
  return state;
}

// --- publicDriver ------------------------------------------------------------

test('publicDriver nunca deixa a senha passar', () => {
  const driver = makeDriver({ id: 'drv-public', password: 'hash-secreto' });
  const safe = publicDriver(driver);

  assert.equal('password' in safe, false);
  assert.equal(safe.password, undefined);
  assert.equal(JSON.stringify(safe).includes('hash-secreto'), false);
  // O resto do cadastro continua servindo à cozinha e ao app.
  assert.equal(safe.id, 'drv-public');
  assert.equal(safe.name, 'Marcos Motoboy');
  assert.equal(safe.phone, '81988887777');
  assert.equal(safe.plate, 'PCD-1A23');
  assert.equal(safe.active, true);
  // O motoboy de origem não é alterado.
  assert.equal(driver.password, 'hash-secreto');
});

test('publicDriver aguenta motoboy que já veio sem senha', () => {
  const safe = publicDriver({ ...makeDriver({ id: 'drv-sem-senha' }), password: undefined });
  assert.equal(safe.password, undefined);
});

// --- driverFromToken ---------------------------------------------------------

test('o token emitido resolve o motoboy dono', () => {
  const driver = makeDriver({ id: 'drv-token', name: 'Dona do token' });
  const token = issueDriverToken(LOJA_PADRAO, driver.id);

  const resolved = driverFromToken(LOJA_PADRAO, token);
  assert.notEqual(resolved, null);
  assert.equal(resolved?.id, 'drv-token');
  assert.equal(resolved?.name, 'Dona do token');
});

test('token desconhecido, vazio ou não-string resolve null', () => {
  assert.equal(driverFromToken(LOJA_PADRAO, 'drv-nao-existe'), null);
  assert.equal(driverFromToken(LOJA_PADRAO, ''), null);
  assert.equal(driverFromToken(LOJA_PADRAO, null as unknown as string), null);
  assert.equal(driverFromToken(LOJA_PADRAO, undefined as unknown as string), null);
  assert.equal(driverFromToken(LOJA_PADRAO, 42 as unknown as string), null);
  assert.equal(driverFromToken(LOJA_PADRAO, {} as unknown as string), null);
});

test('o token de um motoboy apagado do cadastro deixa de resolver', () => {
  const driver = makeDriver({ id: 'drv-apagado' });
  const token = issueDriverToken(LOJA_PADRAO, driver.id);
  assert.equal(driverFromToken(LOJA_PADRAO, token)?.id, 'drv-apagado');

  db.prepare('DELETE FROM drivers WHERE id = ?').run('drv-apagado');
  assert.equal(driverFromToken(LOJA_PADRAO, token), null);
});

test('dois motoboys recebem tokens diferentes', () => {
  // Antes os dois recebiam o mesmo token de papel, e era isso que deixava um
  // agir em nome do outro.
  const um = makeDriver({ id: 'drv-um', name: 'Um' });
  const dois = makeDriver({ id: 'drv-dois', name: 'Dois' });

  const tokenUm = issueDriverToken(LOJA_PADRAO, um.id);
  const tokenDois = issueDriverToken(LOJA_PADRAO, dois.id);

  assert.notEqual(tokenUm, tokenDois);
  assert.equal(driverFromToken(LOJA_PADRAO, tokenUm)?.id, 'drv-um');
  assert.equal(driverFromToken(LOJA_PADRAO, tokenDois)?.id, 'drv-dois');
});

test('dois logins do mesmo motoboy também rendem tokens diferentes', () => {
  const driver = makeDriver({ id: 'drv-dois-logins' });
  const primeiro = issueDriverToken(LOJA_PADRAO, driver.id);
  const segundo = issueDriverToken(LOJA_PADRAO, driver.id);

  assert.notEqual(primeiro, segundo);
  assert.equal(driverFromToken(LOJA_PADRAO, primeiro)?.id, 'drv-dois-logins');
  assert.equal(driverFromToken(LOJA_PADRAO, segundo)?.id, 'drv-dois-logins');
});

test('motoboy inativo não resolve, mesmo com token válido', () => {
  // É isso que faz a demissão cortar o acesso em vez de ele sobreviver no
  // localStorage do ex-funcionário.
  const driver = makeDriver({ id: 'drv-demitido', active: true });
  const token = issueDriverToken(LOJA_PADRAO, driver.id);
  assert.equal(driverFromToken(LOJA_PADRAO, token)?.id, 'drv-demitido');

  makeDriver({ id: 'drv-demitido', active: false });
  assert.equal(driverFromToken(LOJA_PADRAO, token), null);
});

// --- revogação ---------------------------------------------------------------

test('revokeDriverTokens derruba todos os tokens daquele motoboy e só dele', () => {
  // Nomes distintos: o índice único é por (loja, nome), e os dois nascem na
  // mesma loja neste teste.
  const alvo = makeDriver({ id: 'drv-alvo', name: 'Alvo' });
  const vizinho = makeDriver({ id: 'drv-vizinho', name: 'Vizinho' });

  const alvoA = issueDriverToken(LOJA_PADRAO, alvo.id);
  const alvoB = issueDriverToken(LOJA_PADRAO, alvo.id);
  const doVizinho = issueDriverToken(LOJA_PADRAO, vizinho.id);

  revokeDriverTokens(LOJA_PADRAO, alvo.id);

  assert.equal(driverFromToken(LOJA_PADRAO, alvoA), null);
  assert.equal(driverFromToken(LOJA_PADRAO, alvoB), null);
  assert.equal(driverFromToken(LOJA_PADRAO, doVizinho)?.id, 'drv-vizinho');
});

test('revokeDriverToken derruba só a sessão daquele aparelho', () => {
  const driver = makeDriver({ id: 'drv-um-aparelho' });
  const celular = issueDriverToken(LOJA_PADRAO, driver.id);
  const tablet = issueDriverToken(LOJA_PADRAO, driver.id);

  revokeDriverToken(celular);

  assert.equal(driverFromToken(LOJA_PADRAO, celular), null);
  assert.equal(driverFromToken(LOJA_PADRAO, tablet)?.id, 'drv-um-aparelho');
});

test('revokeDriverToken com token vazio não derruba nada', () => {
  const driver = makeDriver({ id: 'drv-revoga-vazio' });
  const token = issueDriverToken(LOJA_PADRAO, driver.id);

  revokeDriverToken('');

  assert.equal(driverFromToken(LOJA_PADRAO, token)?.id, 'drv-revoga-vazio');
});

// --- requisição --------------------------------------------------------------

test('tokenFromRequest lê o header x-role-token e apara os espaços', () => {
  assert.equal(tokenFromRequest(fakeReq({ 'x-role-token': '  abc  ' })), 'abc');
  assert.equal(tokenFromRequest(fakeReq({})), '');
  assert.equal(tokenFromRequest(fakeReq({ 'x-role-token': 7 })), '');
});

test('driverFromRequest resolve o motoboy do header', () => {
  const driver = makeDriver({ id: 'drv-header' });
  const token = issueDriverToken(LOJA_PADRAO, driver.id);

  assert.equal(driverFromRequest(LOJA_PADRAO, fakeReq({ 'x-role-token': token }))?.id, 'drv-header');
  assert.equal(driverFromRequest(LOJA_PADRAO, fakeReq({ 'x-role-token': 'lixo' })), null);
  assert.equal(driverFromRequest(LOJA_PADRAO, fakeReq({})), null);
});

// --- requireDriver / currentDriver -------------------------------------------

function runRequire(headers: Record<string, unknown>): { res: FakeRes; nextCalls: number } {
  const res = fakeRes();
  let nextCalls = 0;
  const next: NextFunction = () => {
    nextCalls += 1;
  };
  requireDriver(LOJA_PADRAO, fakeReq(headers), res.res, next);
  return { res, nextCalls };
}

test('requireDriver responde 401 sem token válido', () => {
  for (const headers of [{}, { 'x-role-token': '' }, { 'x-role-token': 'lixo' }]) {
    const { res, nextCalls } = runRequire(headers);
    assert.equal(res.statusCode, 401, `passou com ${JSON.stringify(headers)}`);
    assert.equal(nextCalls, 0);
    assert.equal(res.locals.driver, undefined);
  }
});

test('requireDriver responde 401 para motoboy desativado', () => {
  const driver = makeDriver({ id: 'drv-off', active: true });
  const token = issueDriverToken(LOJA_PADRAO, driver.id);
  makeDriver({ id: 'drv-off', active: false });

  const { res, nextCalls } = runRequire({ 'x-role-token': token });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalls, 0);
});

test('requireDriver põe o motoboy em res.locals.driver e segue', () => {
  const driver = makeDriver({ id: 'drv-ok', name: 'Passou' });
  const token = issueDriverToken(LOJA_PADRAO, driver.id);

  const { res, nextCalls } = runRequire({ 'x-role-token': token });

  assert.equal(res.statusCode, null);
  assert.equal(nextCalls, 1);
  assert.equal((res.locals.driver as Driver).id, 'drv-ok');
  assert.equal((res.locals.driver as Driver).name, 'Passou');
});

test('currentDriver lê o motoboy que requireDriver deixou em res.locals', () => {
  const driver = makeDriver({ id: 'drv-current' });
  const token = issueDriverToken(LOJA_PADRAO, driver.id);

  const { res } = runRequire({ 'x-role-token': token });

  assert.equal(currentDriver(res.res).id, 'drv-current');
});

test('currentDriver estoura fora de uma rota com requireDriver', () => {
  assert.throws(() => currentDriver(fakeRes().res), /requireDriver/);
});
