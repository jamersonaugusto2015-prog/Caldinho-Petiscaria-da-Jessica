import assert from 'node:assert/strict';
import test from 'node:test';
import { describeSettingsError, parseStoredSettings, shopSettingsPatchSchema } from './settings';
import type { StoreSettings } from './types';

function erroDe(body: unknown): string {
  const parsed = shopSettingsPatchSchema.safeParse(body);
  assert.equal(parsed.success, false, 'esperava que este corpo fosse recusado');
  return describeSettingsError(parsed.error!);
}

test('corpo vazio é válido: o painel manda só o que mudou', () => {
  assert.equal(shopSettingsPatchSchema.safeParse({}).success, true);
});

test('frete negativo é recusado', () => {
  // Aceito antes do schema existir: a loja passava a PAGAR o cliente por entregar.
  assert.match(erroDe({ deliveryBaseFee: -50 }), /Taxa base de entrega.*menor que 0/);
  assert.match(erroDe({ deliveryPricePerKm: -1 }), /Preço por km/);
  assert.match(erroDe({ minOrderValue: -0.01 }), /Pedido mínimo/);
});

test('campo com nome errado é recusado em vez de sumir em silêncio', () => {
  assert.match(erroDe({ delivryBaseFee: 5 }), /Configuração desconhecida/);
});

test('coordenada fora do planeta é recusada', () => {
  assert.match(erroDe({ storeLat: 999 }), /Latitude da loja.*90/);
  assert.match(erroDe({ storeLng: -200 }), /Longitude da loja/);
});

test('o fator de rota não pode dizer que a rua é mais curta que a reta', () => {
  assert.match(erroDe({ routeFactor: 0.5 }), /Fator de rota/);
  assert.equal(shopSettingsPatchSchema.safeParse({ routeFactor: 1.35 }).success, true);
});

test('PIN curto demais é recusado, com a frase em português', () => {
  assert.match(erroDe({ kitchenPin: '12' }), /PIN da cozinha.*pelo menos 4/);
});

test('PIN vazio passa: significa "não mexer no PIN"', () => {
  const parsed = shopSettingsPatchSchema.safeParse({ kitchenPin: '   ' });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.kitchenPin, '');
});

test('o texto é aparado e cortado no tamanho', () => {
  const parsed = shopSettingsPatchSchema.parse({
    storeName: '  Loja Teste  ',
    pixMerchantName: 'A'.repeat(50),
  });
  assert.equal(parsed.storeName, 'Loja Teste');
  // O BR Code limita o nome do recebedor a 25 caracteres.
  assert.equal(parsed.pixMerchantName?.length, 25);
});

test('o WhatsApp perde a máscara e fica só com os dígitos', () => {
  assert.equal(
    shopSettingsPatchSchema.parse({ storeWhatsApp: '(81) 99999-0000' }).storeWhatsApp,
    '81999990000'
  );
});

test('o horário precisa ter 7 dias e formato HH:MM', () => {
  const semana = Array(7).fill({ open: '09:00', close: '23:00' });
  assert.equal(shopSettingsPatchSchema.safeParse({ openingHours: semana }).success, true);
  // `null` = fechado naquele dia
  assert.equal(
    shopSettingsPatchSchema.safeParse({ openingHours: [null, ...semana.slice(1)] }).success,
    true
  );
  assert.match(erroDe({ openingHours: semana.slice(0, 5) }), /Horário de funcionamento/);
  assert.equal(
    shopSettingsPatchSchema.safeParse({
      openingHours: [{ open: '25:00', close: '23:00' }, ...semana.slice(1)],
    }).success,
    false
  );
});

test('taxa base e taxa mínima são independentes: qualquer par não-negativo vale', () => {
  // `max(mínima, base + km*preço)` aceita os dois sentidos. Mínima acima da
  // base é "a entrega começa em R$ X"; mínima abaixo só nunca vincula.
  assert.equal(
    shopSettingsPatchSchema.safeParse({ deliveryBaseFee: 8, deliveryMinFee: 3 }).success,
    true
  );
  assert.equal(
    shopSettingsPatchSchema.safeParse({ deliveryBaseFee: 3, deliveryMinFee: 8 }).success,
    true
  );
});

test('dinheiro de configuração recusa valor absurdo e sub-centavo', () => {
  assert.equal(shopSettingsPatchSchema.safeParse({ deliveryBaseFee: 1e12 }).success, false);
  assert.equal(shopSettingsPatchSchema.safeParse({ deliveryBaseFee: 0.005 }).success, false);
  assert.equal(shopSettingsPatchSchema.safeParse({ deliveryBaseFee: 7.5 }).success, true);
});

test('nome de loja vazio é recusado', () => {
  assert.equal(shopSettingsPatchSchema.safeParse({ storeName: '   ' }).success, false);
});

test('minutos de retirada são arredondados e têm um piso', () => {
  assert.equal(shopSettingsPatchSchema.parse({ pickupReadyMinutes: 20.6 }).pickupReadyMinutes, 21);
  assert.match(erroDe({ pickupReadyMinutes: 2 }), /Minutos até ficar pronto/);
});

test('quem cobra o PIX só pode ser mercadopago ou a chave da loja', () => {
  assert.equal(shopSettingsPatchSchema.safeParse({ pixProvider: 'local' }).success, true);
  assert.match(erroDe({ pixProvider: 'picpay' }), /Quem cobra o PIX/);
});

test('a lista de tamanhos não pode chegar vazia e apagar o cardápio', () => {
  assert.match(erroDe({ sizeOptions: [] }), /Tamanhos/);
  assert.equal(
    shopSettingsPatchSchema.safeParse({ sizeOptions: [{ label: 'Médio', priceDelta: 0 }] }).success,
    true
  );
});

// ---------- Leitura do banco ----------

const padrao: StoreSettings = {
  storeName: 'Loja',
  city: 'Recife',
  storeAddress: '',
  storeLat: -8.05,
  storeLng: -34.9,
  pickupEnabled: true,
  pickupReadyMinutes: 20,
  deliveryPricePerKm: 2,
  deliveryBaseFee: 5,
  deliveryMinFee: 5,
  freeDeliveryAbove: 0,
  maxDeliveryKm: 20,
  minOrderValue: 0,
  routeFactor: 1.35,
  driverFeePerDelivery: 0,
  pixProvider: 'mercadopago',
  pixKey: '',
  pixMerchantName: 'Loja',
  pixMerchantCity: 'Recife',
  cardOnDeliveryEnabled: true,
  storeWhatsApp: '',
  orderSoundUrl: '',
  openingHours: Array(7).fill({ open: '09:00', close: '23:00' }),
  sizeOptions: [{ label: 'Médio', priceDelta: 0 }],
  loyaltyStampCost: 10,
  loyaltyRedeemCategory: 'caldinhos',
  timezone: 'America/Recife',
  orderEnabled: true,
  forceOpen: false,
};

test('um valor torto no banco cai no padrão em vez de fechar a loja', () => {
  const lido = parseStoredSettings(
    // routeFactor 0.2 diria que a rua é mais curta que a linha reta.
    { ...padrao, routeFactor: 0.2, deliveryBaseFee: Number.NaN, storeLat: 999 },
    padrao
  );
  assert.equal(lido.routeFactor, 1.35);
  assert.equal(lido.deliveryBaseFee, 5);
  assert.equal(lido.storeLat, -8.05);
  assert.equal(lido.storeName, 'Loja', 'o resto da configuração não pode ser perdido junto');
});

test('horário corrompido no JSON volta ao padrão', () => {
  const curto = parseStoredSettings(
    { ...padrao, openingHours: [{ open: '09:00', close: '23:00' }] },
    padrao
  );
  assert.equal(curto.openingHours.length, 7);

  const torto = parseStoredSettings(
    { ...padrao, openingHours: Array(7).fill({ open: '99:99', close: '23:00' }) },
    padrao
  );
  assert.deepEqual(torto.openingHours, padrao.openingHours);
});

test('lista de tamanhos vazia volta ao padrão: sem ela o preço não fecha', () => {
  assert.deepEqual(parseStoredSettings({ ...padrao, sizeOptions: [] }, padrao).sizeOptions, padrao.sizeOptions);
});

test('provedor de PIX desconhecido volta ao padrão', () => {
  const lido = parseStoredSettings(
    { ...padrao, pixProvider: 'picpay' as StoreSettings['pixProvider'] },
    padrao
  );
  assert.equal(lido.pixProvider, 'mercadopago');
});

test('uma configuração inteira e correta atravessa sem mudar nada', () => {
  assert.deepEqual(parseStoredSettings(padrao, padrao), padrao);
});
