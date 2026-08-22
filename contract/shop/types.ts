/**
 * A Loja.
 *
 * `Shop` e `ShopId` são novos: até aqui NENHUMA camada do sistema sabia que
 * lojas existem. São a base do multi-tenant — a partir da Fase 5 toda tabela
 * carrega um `shopId`, e ele NUNCA vem do corpo da requisição: vem do `Host`
 * (cliente) ou da credencial (equipe).
 */

import type { PixProvider } from '../order/types';
import type { SizeOption } from '../catalog/types';
/**
 * A chave de tudo no multi-tenant. Inteiro e não string: ele entra em índice
 * composto de quase toda tabela, e um TEXT ali custa espaço e comparação em
 * cima de milhões de linhas sem devolver nada em troca.
 */
export type ShopId = number;

/** Uma loja da plataforma. */
export interface Shop {
  id: ShopId;
  /**
   * O subdomínio. `loja-x` atende em `loja-x.dominio.com.br`, e é assim que o
   * middleware de tenant descobre de quem é a requisição — pelo `Host`, nunca
   * pelo corpo.
   */
  slug: string;
  name: string;
  /** Loja desligada recebe 404 no middleware, em vez de servir meio app. */
  active: boolean;
  createdAt: string;
}

export interface OpeningHour {
  open: string; // 'HH:MM'
  close: string; // 'HH:MM'
}

// Configurações da loja (persistidas no servidor, tabela meta)
export interface StoreSettings {
  storeName: string;
  city: string;
  storeAddress: string; // endereco escrito da loja, mostrado a quem vai retirar
  storeLat: number;
  storeLng: number;
  pickupEnabled: boolean; // aceita retirada na loja
  pickupReadyMinutes: number; // minutos ate o pedido ficar pronto para retirar
  deliveryPricePerKm: number; // R$ por km
  deliveryBaseFee: number; // R$ taxa base
  deliveryMinFee: number; // R$ taxa mínima
  freeDeliveryAbove: number; // R$ (0 = desligado)
  maxDeliveryKm: number; // raio máximo de entrega (0 = ilimitado)
  minOrderValue: number; // pedido mínimo (0 = desligado)
  routeFactor: number; // multiplicador linha reta -> rota real (ex: 1.35)
  driverFeePerDelivery: number; // R$ fixo por entrega p/ motoboy (0 = usa taxa do pedido)
  pixProvider: PixProvider; // quem gera a cobrança PIX: Mercado Pago ou a chave da loja
  pixKey: string;
  pixMerchantName: string;
  pixMerchantCity: string;
  cardOnDeliveryEnabled: boolean; // a loja tem maquininha para levar na entrega
  storeWhatsApp: string; // WhatsApp da loja p/ receber comprovantes (ex: 5581999990000)
  orderSoundUrl: string; // áudio MP3 personalizado do alerta de novo pedido ('' = voz do sistema)
  openingHours: (OpeningHour | null)[]; // 7 dias: domingo=0 ... sábado=6
  sizeOptions: SizeOption[]; // tamanhos ofertados (ex: caldinhos em ml)
  /**
   * Quantos selos compram um brinde. Era uma constante do sistema inteiro
   * (`LOYALTY_STAMP_COST = 10`), o que obriga toda loja da plataforma à mesma
   * regra de fidelidade.
   */
  loyaltyStampCost: number;
  /**
   * A categoria cujos itens podem ser resgatados com selos.
   *
   * Estava FIXA em `'caldinhos'` dentro de `loyalty.ts` — o que não quer dizer
   * nada numa pizzaria. Vazia = qualquer item do cardápio pode ser resgatado.
   */
  loyaltyRedeemCategory: string;
  /**
   * O fuso da loja, no formato IANA (`America/Recife`).
   *
   * Os relatórios usavam o fuso do PROCESSO: com lojas em fusos diferentes, o
   * pedido das 23h50 de uma cairia no dia seguinte da outra. Vazio = o fuso do
   * processo, que é o comportamento de sempre.
   */
  timezone: string;
  orderEnabled: boolean; // chave geral aberta/fechada
  forceOpen: boolean; // aberto manualmente, ignora o horário de funcionamento
}

export interface PublicStoreSettings extends StoreSettings {
  /**
   * A cor da marca desta loja, em `#RRGGBB`. Vazio = a cor padrão.
   *
   * É público de propósito: quem pinta a tela é o app do cliente, e a cor da
   * fachada de uma loja não é segredo de ninguém.
   */
  brandPrimaryColor: string;
  kitchenPinSet: boolean;
  isOpen: boolean;
  pixEnabled: boolean;
  mercadoPagoConnected: boolean;
  mercadoPagoOAuthReady: boolean;
  mercadoPagoTestMode: boolean;
  mercadoPagoPublicKey: string;
  mercadoPagoUserId: string;
  backupEnabled: boolean;
  backupFrequencyDays: number;
  backupFolderId: string;
  backupKeySet: boolean;
  backupLastRun: string;
  backupLastStatus: string;
  backupLastFile: string;
}
