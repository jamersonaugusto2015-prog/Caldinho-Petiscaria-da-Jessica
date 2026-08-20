import { Order } from '../src/types';

/**
 * A única forma de um Order sair do servidor rumo a um motoboy.
 *
 * A redação existia só no caminho do socket, então a rota HTTP entregava nome,
 * telefone e endereço de qualquer corrida a qualquer motoboy — e `customerId`
 * sobrevivia à redação, servindo de chave para buscar o resto pela rota do
 * cliente. Com uma vista só, o transporte deixa de decidir: quem não é o dono
 * da corrida não recebe o contato, seja por socket ou por HTTP.
 */

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
 * Tira do pedido tudo que identifica o cliente. O bairro, a distância e os itens
 * ficam: é com isso que o motoboy decide se aceita a corrida, e nada disso
 * aponta para uma pessoa.
 */
export function stripCustomerContact(order: Order): Order {
  return {
    ...order,
    customerId: '',
    customerName: '',
    customerPhone: '',
    // O telefone do motoboy dono da corrida não interessa a quem não é ele.
    driverPhone: undefined,
    address: {
      ...order.address,
      label: '',
      street: '',
      number: '',
      complement: undefined,
      cep: undefined,
      lat: undefined,
      lng: undefined,
    },
    // A observação do item costuma trazer referência de casa ("portão azul",
    // "deixar com a vizinha do 302").
    items: order.items.map((item) => ({ ...item, observation: undefined })),
  };
}

/**
 * `viewerDriverId` é o motoboy autenticado que vai receber o evento — nunca um
 * id vindo do cliente. Só o dono da corrida vê o contato.
 */
export function orderForDriver(order: Order, viewerDriverId: string | null | undefined): Order {
  const safe = stripPaymentSecrets(order);
  const isOwner = Boolean(viewerDriverId) && order.driverId === viewerDriverId;
  return isOwner ? safe : stripCustomerContact(safe);
}
