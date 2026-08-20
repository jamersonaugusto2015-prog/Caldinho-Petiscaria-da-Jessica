import assert from 'node:assert/strict';
import test from 'node:test';
import { Driver } from '../src/types';
import { DRIVER_OFFLINE_GRACE_MS, DriverPresenceDeps, createDriverPresence } from './driverPresence';

function driver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'drv-1',
    name: 'Marcos Motoboy',
    phone: '81988887777',
    active: true,
    online: true,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

interface Harness {
  presence: ReturnType<typeof createDriverPresence>;
  saved: Driver[];
  notified: Driver[];
  timers: { fn: () => void; ms: number }[];
  cleared: number;
  sessions: Map<string, number>;
  drivers: Map<string, Driver>;
}

function harness(options: { drivers?: Driver[]; tokens?: Record<string, string> } = {}): Harness {
  const drivers = new Map<string, Driver>();
  for (const d of options.drivers ?? [driver()]) drivers.set(d.id, { ...d });
  const tokens = options.tokens ?? { 'tok-drv-1': 'drv-1' };
  const sessions = new Map<string, number>();
  const saved: Driver[] = [];
  const notified: Driver[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const state = { cleared: 0 };

  const deps: DriverPresenceDeps = {
    resolveDriver: (token) => {
      const id = tokens[token];
      const found = id ? drivers.get(id) : undefined;
      return found ? { ...found } : null;
    },
    loadDriver: (id) => {
      const found = drivers.get(id);
      return found ? { ...found } : null;
    },
    saveDriver: (d) => {
      drivers.set(d.id, { ...d });
      saved.push({ ...d });
    },
    countSessions: async (id) => sessions.get(id) ?? 0,
    onPresenceChanged: (d) => notified.push({ ...d }),
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length - 1;
    },
    clearTimer: () => {
      state.cleared += 1;
    },
  };

  return {
    presence: createDriverPresence(deps),
    saved,
    notified,
    timers,
    sessions,
    drivers,
    get cleared() {
      return state.cleared;
    },
  } as Harness;
}

// --- janela de graça ---------------------------------------------------------

test('a queda do socket não desliga a presença na hora, agenda', async () => {
  const h = harness();

  await h.presence.disconnect('drv-1');

  assert.equal(h.saved.length, 0, 'ninguém foi desligado ainda');
  assert.equal(h.presence.isPending('drv-1'), true);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, DRIVER_OFFLINE_GRACE_MS);
});

test('voltar dentro da janela mantém o motoboy online', async () => {
  const h = harness();

  // Celular no bolso: o socket cai...
  await h.presence.disconnect('drv-1');
  // ...e volta antes de a janela fechar, declarando que o turno continua.
  h.sessions.set('drv-1', 1);
  const back = h.presence.join('tok-drv-1', true);

  assert.equal(back?.id, 'drv-1');
  assert.equal(h.presence.isPending('drv-1'), false, 'o desligamento agendado foi cancelado');
  assert.equal(h.cleared, 1);
  assert.equal(h.drivers.get('drv-1')?.online, true);
  assert.deepEqual(h.notified, [], 'quem nunca ficou offline não precisa avisar a cozinha');
});

test('sumir a janela inteira desliga a presença e avisa a cozinha', async () => {
  const h = harness();

  await h.presence.disconnect('drv-1');
  await h.presence.flush('drv-1');

  assert.equal(h.drivers.get('drv-1')?.online, false);
  assert.equal(h.saved.length, 1);
  assert.equal(h.notified.length, 1);
  assert.equal(h.notified[0].id, 'drv-1');
  assert.equal(h.presence.isPending('drv-1'), false);
});

test('uma aba fechada não desliga o motoboy que tem outra aberta', async () => {
  const h = harness();
  h.sessions.set('drv-1', 1); // a outra aba continua na sala privada

  await h.presence.disconnect('drv-1');

  assert.equal(h.timers.length, 0, 'nem chegou a agendar');
  assert.equal(h.presence.isPending('drv-1'), false);
  assert.equal(h.drivers.get('drv-1')?.online, true);
});

test('a janela que fecha com o motoboy de volta por outra aba não desliga nada', async () => {
  const h = harness();

  await h.presence.disconnect('drv-1');
  // Reconexão que só refez as salas, sem passar pelo join.
  h.sessions.set('drv-1', 1);
  await h.presence.flush('drv-1');

  assert.equal(h.drivers.get('drv-1')?.online, true);
  assert.deepEqual(h.saved, []);
});

// --- restauração da presença -------------------------------------------------

test('voltar depois da janela devolve a presença sem o motoboy tocar em nada', async () => {
  const h = harness();

  await h.presence.disconnect('drv-1');
  await h.presence.flush('drv-1');
  assert.equal(h.drivers.get('drv-1')?.online, false);

  h.sessions.set('drv-1', 1);
  h.presence.join('tok-drv-1', true);

  assert.equal(h.drivers.get('drv-1')?.online, true, 'a intenção declarada traz a presença de volta');
  assert.equal(h.notified.at(-1)?.online, true);
});

test('reconectar sem declarar intenção não ressuscita quem tocou OFFLINE', () => {
  const h = harness({ drivers: [driver({ online: false })] });

  h.presence.join('tok-drv-1', undefined);

  assert.equal(h.drivers.get('drv-1')?.online, false);
  assert.deepEqual(h.saved, [], 'reentrar na sala não é intenção');
});

test('o app pode declarar que saiu de turno enquanto o socket estava fora', () => {
  const h = harness();

  h.presence.join('tok-drv-1', false);

  assert.equal(h.drivers.get('drv-1')?.online, false);
  assert.equal(h.notified.length, 1);
});

test('a presença restaurada é a do dono do token, não a do id que veio junto', () => {
  // ADR-0009: o payload do socket não escolhe motoboy. O token é de João; o
  // `driverId` da Maria no payload não pode mexer na presença dela.
  const h = harness({
    drivers: [driver({ id: 'drv-joao', online: false }), driver({ id: 'drv-maria', online: false })],
    tokens: { 'tok-joao': 'drv-joao' },
  });

  const restored = h.presence.join('tok-joao', true);

  assert.equal(restored?.id, 'drv-joao');
  assert.equal(h.drivers.get('drv-joao')?.online, true);
  assert.equal(h.drivers.get('drv-maria')?.online, false, 'a Maria não foi tocada');
});

test('token que não resolve não entra em sala nenhuma nem mexe em presença', () => {
  const h = harness({ drivers: [driver({ online: false })] });

  assert.equal(h.presence.join('tok-inventado', true), null);
  assert.equal(h.presence.join('', true), null);
  assert.deepEqual(h.saved, []);
  assert.equal(h.drivers.get('drv-1')?.online, false);
});

test('motoboy desativado no meio do caminho não volta a ficar online', () => {
  const h = harness({ drivers: [driver({ online: false, active: false })] });

  h.presence.join('tok-drv-1', true);

  assert.equal(h.drivers.get('drv-1')?.online, false);
  assert.deepEqual(h.saved, []);
});

test('a presença é relida antes de gravar, para não ressuscitar o que o motoboy desligou', async () => {
  const h = harness();

  await h.presence.disconnect('drv-1');
  // Entre a queda e a janela fechar, o motoboy tocou OFFLINE pela rota HTTP.
  h.drivers.set('drv-1', driver({ online: false }));
  await h.presence.flush('drv-1');

  assert.deepEqual(h.saved, [], 'já estava offline: nada a gravar');
  assert.deepEqual(h.notified, []);
});
