import type { OrderIntakeDependencies } from '../orderIntake';
import type { OrderLifecycleDeps } from '../orderLifecycle';
import { liveOrderPaymentAdapter } from '../payment';
import { getSettings } from '../db';
import { listCoupons, listProducts } from '../catalog';
import {
  listPromotions,
  recordPromotionSale,
  registerPromotionUses,
  releasePromotionUses,
  reservePromotionUses,
} from '../promotions';
import {
  consumeFreeItems,
  earnStamp,
  getCustomerStamps,
  hasFreeRedeem,
  releaseFreeItems,
} from '../loyalty';
import {
  deleteOrder,
  insertOrderWithBeforeInsert,
  listOrders,
  loadDriver,
  loadProduct,
  orderIdExists,
  saveDriver,
  saveOrder,
} from '../orderStore';
import type { ShopId } from '../../contract/shop/types';
import type { OrderStatus } from '../../contract/order/types';
import type { DriverLocationDeps } from '../driverLocation';
import type { DriverPresenceDeps } from '../driverPresence';
import { recordOrderEvent } from './order/events';

/**
 * O ponto de composição: onde o domínio ganha as coisas de que precisa.
 *
 * O domínio (`orderIntake`, `orderLifecycle`, `cancellation`) recebe suas
 * dependências em vez de importar o banco — é o ADR-0001, e é o que deixa 400
 * testes rodarem sem SQLite. O problema não era esse: era que o pacote de
 * dependências estava COPIADO em 8 lugares. O literal
 * `{ getSettings, getDriver: loadDriver, saveOrder, earnStamp }` aparecia sete
 * vezes em `routes.ts`, uma em `index.ts` e mais uma em `cancellation.ts`.
 *
 * Nove cópias significam que acrescentar uma dependência é acertar nove lugares
 * — e que esquecer um deles compila, sobe e só quebra na rota que ninguém
 * testou. É exatamente onde o multi-tenant ia doer: cada cópia precisaria
 * aprender a sua loja.
 *
 * É aqui que o `shopId` entra no sistema. O domínio continua sem saber que
 * lojas existem — as interfaces `OrderLifecycleDeps` e
 * `OrderIntakeDependencies` não têm `shopId` em lugar nenhum. Quem amarra a
 * loja são os fechamentos montados abaixo. Foi exatamente para isso que a Fase
 * 4 juntou as nove cópias num lugar só.
 */

/**
 * O que o ciclo de vida do pedido precisa para avançar um status: a
 * configuração da loja, o motoboy, o selo de fidelidade e onde gravar.
 */
export function orderLifecycleDeps(shopId: ShopId): OrderLifecycleDeps {
  return {
    getSettings: () => getSettings(shopId),
    getDriver: (id) => loadDriver(shopId, id),
    saveOrder: (order) => saveOrder(shopId, order),
    earnStamp: (customerId) => earnStamp(shopId, customerId),
    recordEvent: ({ orderId, ...evento }) => {
      try {
        recordOrderEvent(shopId, orderId, evento);
      } catch (err) {
        // A trilha é registro, não regra: perder uma linha de auditoria é ruim,
        // travar a cozinha por causa dela é pior.
        console.error('[trilha] não deu para gravar o evento do pedido', orderId, err);
      }
    },
  };
}

/**
 * O que a entrada de um pedido novo precisa: cardápio, cupons, promoções,
 * cobrança, fidelidade e persistência.
 */
export function orderIntakeDeps(shopId: ShopId): OrderIntakeDependencies {
  return {
    settings: () => getSettings(shopId),
    loadProduct: (id) => loadProduct(shopId, id),
    listCoupons: () => listCoupons(shopId),
    listPromotions: () => listPromotions(shopId),
    listProducts: () => listProducts(shopId),
    registerPromotionUses: (applied, total) =>
      registerPromotionUses(shopId, applied ?? [], total),
    reservePromotionUses: (applied) => reservePromotionUses(shopId, applied ?? []),
    releasePromotionUses: (applied) => releasePromotionUses(shopId, applied ?? []),
    recordPromotionSale: (applied, total) => recordPromotionSale(shopId, applied ?? [], total),
    payment: liveOrderPaymentAdapter(shopId),
    peekFreeRedeem: (token, productId, customerId) =>
      hasFreeRedeem(shopId, token, productId, customerId),
    consumeFreeItems: (items, customerId) => consumeFreeItems(shopId, items, customerId),
    releaseFreeItems: (items) => releaseFreeItems(shopId, items),
    persistOrder: (order, beforePersist) =>
      insertOrderWithBeforeInsert(shopId, order, beforePersist),
    updateOrder: (order) => saveOrder(shopId, order),
    releaseOrder: (id) => deleteOrder(shopId, id),
    getLoyaltyPoints: (customerId) => getCustomerStamps(shopId, customerId),
    orderIdExists,
  };
}

/**
 * O que o GPS do motoboy precisa: quem ele é, quais corridas dele estão na rua
 * e como aplicar o movimento.
 *
 * O `listOrdersByStatus` daqui já filtra pela loja — sem isso, o ponto de GPS
 * de um motoboy da loja A varreria as corridas da loja B procurando qual
 * atualizar.
 */
export function driverLocationDeps(
  shopId: ShopId,
  applyMove: DriverLocationDeps['applyMove']
): DriverLocationDeps {
  return {
    loadDriver: (id) => loadDriver(shopId, id),
    saveDriver: (driver) => saveDriver(shopId, driver),
    listOrdersByStatus: (status) => listOrders(shopId, { status: status as OrderStatus }),
    applyMove,
  };
}

/**
 * O que a presença do motoboy precisa. `resolveDriver`, `countSessions` e
 * `onPresenceChanged` continuam vindo de fora: dependem do socket.io, e
 * `server/domain/**` não pode importar transporte.
 */
export function driverPresenceDeps(
  shopId: ShopId,
  transporte: Pick<DriverPresenceDeps, 'resolveDriver' | 'countSessions' | 'onPresenceChanged'>
): DriverPresenceDeps {
  return {
    ...transporte,
    loadDriver: (id) => loadDriver(shopId, id),
    saveDriver: (driver) => saveDriver(shopId, driver),
  };
}
