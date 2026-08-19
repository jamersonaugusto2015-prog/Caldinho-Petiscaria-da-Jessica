import { Server } from 'socket.io';
import { Order } from '../src/types';

export function stripPaymentSecrets(order: Order): Order {
  return {
    ...order,
    payment: {
      ...order.payment,
      pixCopyPaste: undefined,
      pixQrCode: undefined,
    },
  };
}

/**
 * Nome, telefone e endereço só podem chegar ao motoboy que aceitou a corrida.
 * Os outros ainda precisam do evento para tirar o card da lista de disponíveis,
 * mas sem os dados do cliente.
 */
export function stripCustomerContact(order: Order): Order {
  return {
    ...order,
    customerName: '',
    customerPhone: '',
    address: {
      ...order.address,
      street: '',
      number: '',
      complement: undefined,
      cep: undefined,
      lat: undefined,
      lng: undefined,
    },
  };
}

export function emitOrder(io: Server, event: 'order:new' | 'order:updated', order: Order): void {
  io.to('kitchen').emit(event, order);

  const forDrivers = stripPaymentSecrets(order);
  if (order.driverId) {
    io.to(`driver:${order.driverId}`).emit(event, forDrivers);
    io.to('drivers')
      .except(`driver:${order.driverId}`)
      .emit(event, stripCustomerContact(forDrivers));
  } else if (order.status === 'pronto') {
    // Corrida aberta: o motoboy precisa do endereço para decidir se aceita.
    io.to('drivers').emit(event, forDrivers);
  } else if (order.status === 'cancelado') {
    // Ninguém vai entregar este pedido. A sala compartilhada só precisa do
    // evento para tirar o card da lista, nunca dos dados do cliente.
    io.to('drivers').emit(event, stripCustomerContact(forDrivers));
  }

  if (order.customerId && order.customerId !== 'anon') {
    io.to(`customer:${order.customerId}`).emit(event, order);
  }
}

export function emitLoyalty(io: Server, customerId: string, points: number): void {
  if (!customerId || customerId === 'anon') return;
  io.to(`customer:${customerId}`).emit('loyalty:updated', { customerId, points });
}
