import assert from 'node:assert/strict';
import test from 'node:test';
import { Order, OrderStatus } from '../types';
import {
  actionLabel,
  canTransition,
  handoverRecipient,
  handoverStep,
  isHandover,
  nextStatus,
  statusFlow,
  transitionProblem,
} from './orderFlow';

type FlowOrder = Pick<Order, 'fulfillment' | 'status' | 'driverId'>;

const delivery = (status: OrderStatus, driverId?: string): FlowOrder => ({
  fulfillment: 'delivery',
  status,
  driverId,
});

const pickup = (status: OrderStatus): FlowOrder => ({ fulfillment: 'pickup', status });

test('a entrega passa pela rua; a retirada não', () => {
  assert.deepEqual(statusFlow(delivery('recebido')), [
    'recebido',
    'em_preparo',
    'pronto',
    'saiu_entrega',
    'entregue',
  ]);
  assert.deepEqual(statusFlow(pickup('recebido')), ['recebido', 'em_preparo', 'pronto', 'entregue']);
});

test('pedido antigo sem fulfillment é tratado como entrega', () => {
  assert.deepEqual(statusFlow({ status: 'pronto' } as FlowOrder), statusFlow(delivery('pronto')));
});

test('a passagem de balcão é o mesmo gesto com dois destinos', () => {
  assert.equal(handoverRecipient(delivery('pronto')), 'driver');
  assert.equal(handoverRecipient(pickup('pronto')), 'customer');
  assert.deepEqual(handoverStep(delivery('pronto')), { from: 'pronto', to: 'saiu_entrega' });
  assert.deepEqual(handoverStep(pickup('pronto')), { from: 'pronto', to: 'entregue' });
});

test('isHandover só vale saindo de pronto', () => {
  assert.equal(isHandover(delivery('pronto'), 'saiu_entrega'), true);
  assert.equal(isHandover(delivery('em_preparo'), 'saiu_entrega'), false);
  assert.equal(isHandover(pickup('pronto'), 'entregue'), true);
  assert.equal(isHandover(delivery('saiu_entrega'), 'entregue'), false);
});

test('nextStatus segue o fluxo do tipo do pedido', () => {
  assert.equal(nextStatus(delivery('pronto')), 'saiu_entrega');
  assert.equal(nextStatus(pickup('pronto')), 'entregue');
  assert.equal(nextStatus(delivery('entregue')), null);
});

test('o rótulo do balcão diz quem está levando', () => {
  assert.equal(actionLabel(delivery('pronto', 'drv-1')), 'Pedido despachado');
  assert.equal(actionLabel(pickup('pronto')), 'Cliente retirou');
  assert.equal(actionLabel(pickup('em_preparo')), 'Pronto para retirar');
  assert.equal(actionLabel(delivery('em_preparo')), 'Marcar pronto');
  assert.equal(actionLabel(delivery('entregue')), null);
});

test('a cozinha não pula a passagem de balcão numa entrega', () => {
  // Era por aqui que um pedido virava "entregue" sem nunca ter saído da loja,
  // pagando a taxa a um motoboy que não rodou.
  const problem = transitionProblem(delivery('pronto', 'drv-1'), 'entregue', 'kitchen');
  assert.match(problem?.message ?? '', /passar pelo balcão/);
});

test('a cozinha ainda despacha a entrega, com ou sem motoboy atribuído', () => {
  assert.equal(canTransition(delivery('pronto', 'drv-1'), 'saiu_entrega', 'kitchen'), true);
  // Sem motoboy no app, a loja não pode ficar travada: despachar continua valendo.
  assert.equal(canTransition(delivery('pronto'), 'saiu_entrega', 'kitchen'), true);
  assert.equal(canTransition(delivery('saiu_entrega', 'drv-1'), 'entregue', 'kitchen'), true);
});

test('a retirada nunca vai para a rua', () => {
  assert.equal(
    transitionProblem(pickup('pronto'), 'saiu_entrega', 'kitchen')?.message,
    'Pedido de retirada na loja não sai para entrega.'
  );
});

test('a cozinha pode adiantar o preparo, que não é passagem de balcão', () => {
  assert.equal(canTransition(delivery('recebido'), 'pronto', 'kitchen'), true);
  assert.equal(canTransition(pickup('recebido'), 'pronto', 'kitchen'), true);
});

test('não dá para voltar atrás nem repetir o status', () => {
  assert.equal(transitionProblem(delivery('pronto'), 'em_preparo', 'kitchen')?.message, 'Transição de status inválida.');
  assert.equal(transitionProblem(delivery('pronto'), 'pronto', 'kitchen')?.message, 'Transição de status inválida.');
});

test('pedido encerrado não se mexe mais', () => {
  assert.equal(transitionProblem(delivery('entregue'), 'entregue', 'kitchen')?.message, 'Este pedido já foi encerrado.');
  assert.equal(transitionProblem(delivery('cancelado'), 'entregue', 'kitchen')?.message, 'Este pedido já foi encerrado.');
});

test('cancelar não passa por aqui', () => {
  assert.match(transitionProblem(delivery('pronto'), 'cancelado', 'kitchen')?.message ?? '', /rota de cancelamento/);
});

test('o motoboy só move a corrida dele, e só nos dois passos que são dele', () => {
  const mine = delivery('pronto', 'drv-1');
  assert.equal(canTransition(mine, 'saiu_entrega', 'driver', { driverId: 'drv-1' }), true);
  assert.equal(
    transitionProblem(mine, 'saiu_entrega', 'driver', { driverId: 'drv-2' })?.message,
    'Esta corrida não está atribuída a você.'
  );
  assert.equal(
    transitionProblem(delivery('pronto'), 'saiu_entrega', 'driver', { driverId: 'drv-1' })?.message,
    'Esta corrida não está atribuída a você.'
  );
  assert.equal(
    transitionProblem(delivery('recebido', 'drv-1'), 'em_preparo', 'driver', { driverId: 'drv-1' })?.message,
    'Ação não permitida para o entregador.'
  );
});

test('o motoboy entrega só depois de ter saído', () => {
  assert.equal(
    canTransition(delivery('saiu_entrega', 'drv-1'), 'entregue', 'driver', { driverId: 'drv-1' }),
    true
  );
  assert.match(
    transitionProblem(delivery('pronto', 'drv-1'), 'entregue', 'driver', { driverId: 'drv-1' })?.message ?? '',
    /passar pelo balcão/
  );
});

test('retirada na loja não tem motoboy', () => {
  assert.equal(
    transitionProblem(pickup('pronto'), 'entregue', 'driver', { driverId: 'drv-1' })?.message,
    'Pedido de retirada na loja não tem corrida.'
  );
});
