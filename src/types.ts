export type Role = 'client' | 'store' | 'driver';

// Categoria de produto (id estável; rótulo/emoji/cor são editáveis no painel)
export type CategoryId = string;

// Categoria editável no painel da cozinha
export interface Category {
  id: string;
  label: string;
  emoji: string;
  color: string;
  sort: number;
}

export interface ExtraOption {
  id: string;
  name: string;
  price: number;
}

// Tamanho configurável no admin (rótulo + acréscimo de preço)
export interface SizeOption {
  label: string; // ex: 'Médio (500ml)'
  priceDelta: number; // acréscimo sobre o preço base
}

// Opção de sabor dentro de um slot de combo
export interface ComboSlotOption {
  id: string;
  label: string; // ex: 'Caldinho de Feijão Preto'
  priceDelta?: number; // acréscimo opcional
}

// Slot de escolha de um combo (ex: "1º Caldinho")
export interface ComboSlot {
  id: string;
  label: string; // ex: '1º Caldinho'
  options: ComboSlotOption[];
  required: boolean;
}

// Escolha feita pelo cliente em um slot do combo
export interface ComboChoice {
  slotId: string;
  slotLabel: string;
  optionId: string;
  optionLabel: string;
  priceDelta: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  category: CategoryId;
  basePrice: number;
  image: string;
  isPopular?: boolean;
  isCaldinhoDoDia?: boolean;
  isFlashPromo?: boolean;
  originalPrice?: number;
  /** Quanto o prato custa para a loja. Alimenta o guarda de margem das promoções. */
  costPrice?: number;
  available: boolean;
  rating: number;
  reviewsCount: number;
  prepTimeMinutes: number;
  allowedExtras?: ExtraOption[];
  hasSizeOption?: boolean;
  comboSlots?: ComboSlot[];
}

export interface CartItemExtra {
  id: string;
  name: string;
  price: number;
}

export interface CartItem {
  id: string;
  product: Product;
  size?: string;
  selectedExtras: CartItemExtra[];
  comboChoices?: ComboChoice[];
  observation?: string;
  quantity: number;
  itemTotalPrice: number;
  isFree?: boolean;
  freeToken?: string;
}

/** Como o pedido chega ao cliente: motoboy leva ou o cliente retira no balcao. */
export type Fulfillment = 'delivery' | 'pickup';

export type OrderStatus =
  | 'recebido'
  | 'em_preparo'
  | 'pronto'
  | 'saiu_entrega'
  | 'entregue'
  | 'cancelado';

/** 'pendente' = a loja deve esse dinheiro ao cliente e ainda não devolveu. */
export type RefundStatus = 'pendente' | 'devolvido' | 'falhou';

export type PaymentMethod = 'pix' | 'card' | 'cash';

/** Quando o dinheiro entra: agora no site, ou com o motoboy/balcão. */
export type PaymentTiming = 'online' | 'delivery';

export interface PaymentDetails {
  method: PaymentMethod;
  /** Ausente em pedidos antigos — veja normalizePaymentTiming em shared/payment. */
  timing?: PaymentTiming;
  pixQrCode?: string;
  pixCopyPaste?: string;
  mpPaymentId?: string;
  mpTicketUrl?: string;
  changeForAmount?: number;
  cardBrand?: string;
  isPaid: boolean;
  /** Quem confirmou um pagamento manual (a cozinha compartilha um PIN). */
  confirmedBy?: string;
  refundStatus?: RefundStatus;
  refundedAt?: string;
  refundedBy?: string;
  mpRefundId?: string;
  refundError?: string;
}

export interface DeliveryAddress {
  id: string;
  label: string; // e.g., 'Casa', 'Trabalho'
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  complement?: string;
  cep?: string;
  lat?: number; // latitude real
  lng?: number; // longitude real
  distanceKm: number;
}

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  address: DeliveryAddress;
  /** Ausente em pedidos antigos, gravados antes da retirada existir: leia como 'delivery'. */
  fulfillment?: Fulfillment;
  items: CartItem[];
  subtotal: number;
  discount: number;
  /** Desconto vindo das promoções automáticas (separado do cupom). */
  promoDiscount?: number;
  /** Quais promoções pegaram neste pedido — base do relatório de resultado. */
  appliedPromotions?: AppliedPromotion[];
  deliveryFee: number;
  total: number;
  distanceKm: number;
  status: OrderStatus;
  payment: PaymentDetails;
  createdAt: string; // ISO string
  /** Quando o pedido foi entregue. Ausente em pedidos gravados antes deste campo. */
  deliveredAt?: string;
  estimatedDeliveryMinutes: number;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  driverLat?: number; // latitude real (GPS do entregador)
  driverLng?: number;
  /**
   * Quando o ponto acima foi tirado. Sem ele o mapa do cliente não tem como
   * separar "o motoboy está aqui" de "o motoboy estava aqui há dez minutos e o
   * celular dele dormiu" — os dois desenham o mesmo pino. Ausente nos pedidos
   * gravados antes do carimbo existir, e num ponto semeado, que é palpite.
   */
  driverLocationAt?: string;
  rating?: number;
  ratingComment?: string;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: CancelActor;
  cancellationRequest?: CancellationRequest;
  complaint?: OrderComplaint;
  loyaltyPointsEarned: number;
}

export type CancelActor = 'cliente' | 'loja';

/** Minutos que a cozinha tem para responder um pedido de cancelamento. */
export const CANCEL_REQUEST_RESPONSE_MINUTES = 5;

export interface CancellationRequest {
  reason: string;
  requestedAt: string;
  status: 'pendente' | 'aceito' | 'recusado';
  respondedAt?: string;
  responseNote?: string;
}

/** Reclamação pós-entrega. Prazo em COMPLAINT_WINDOW_HOURS a partir da criação. */
export interface OrderComplaint {
  text: string;
  openedAt: string;
  status: 'aberta' | 'resolvida';
  resolvedAt?: string;
}

export const COMPLAINT_WINDOW_HOURS = 24;

export interface ChatMessage {
  id: string;
  orderId: string;
  sender: 'client' | 'store' | 'driver';
  senderName: string;
  text: string;
  timestamp: string;
}

export interface Coupon {
  code: string;
  discountPercent?: number;
  discountFixed?: number;
  minOrderValue: number;
  description: string;
}

// ---------- Promoções automáticas ----------
// Diferente do cupom, a promoção não precisa de código: ela vale sozinha quando
// a regra bate (produto, horário, canal, valor mínimo).

/** O que a promoção faz com o preço. */
export type PromotionKind =
  | 'desconto' // tira % ou R$ do item, ou fixa um "por apenas"
  | 'leve_pague' // leve 3 pague 2 dentro do mesmo grupo de itens
  | 'brinde' // acima de X reais, um produto vai junto sem custo
  | 'frete'; // zera ou abate a taxa de entrega

/** Em quais itens a promoção pega. */
export type PromotionScope = 'produtos' | 'categorias' | 'todos';

/** Canal de venda: entrega, retirada ou os dois. */
export type PromotionChannel = 'ambos' | 'delivery' | 'pickup';

/** Quando a promoção vale. Campos vazios = sem restrição. */
export interface PromotionWindow {
  startDate?: string; // 'YYYY-MM-DD'
  endDate?: string; // 'YYYY-MM-DD'
  weekdays: number[]; // 0=domingo ... 6=sábado; vazio = todo dia
  startTime?: string; // 'HH:MM'
  endTime?: string; // 'HH:MM'; menor que startTime = cruza a meia-noite
}

export interface Promotion {
  id: string;
  name: string;
  kind: PromotionKind;
  enabled: boolean;

  scope: PromotionScope;
  productIds: string[];
  categoryIds: string[];

  // kind = 'desconto' (usa só um dos três)
  discountPercent?: number;
  discountFixed?: number;
  fixedPrice?: number;

  // kind = 'leve_pague'
  buyQty?: number;
  payQty?: number;

  // kind = 'brinde'
  giftProductId?: string;

  // kind = 'frete'
  deliveryFree?: boolean;
  deliveryDiscount?: number;

  minOrderValue: number;
  channel: PromotionChannel;
  /** 0 = sem limite. Conta pedidos, não itens. */
  maxUses: number;
  usedCount: number;
  /** false = o cliente escolhe entre a promoção e o cupom, nunca os dois. */
  stacksWithCoupon: boolean;
  /** Aparece na vitrine do cardápio do cliente. */
  highlight: boolean;
  /** Selo curto mostrado ao cliente (ex.: 'HAPPY HOUR'). */
  badge?: string;
  window: PromotionWindow;
  createdAt: string;

  // Resultado acumulado, gravado a cada pedido que usou a promoção.
  totalDiscount: number;
  totalRevenue: number;
  totalOrders: number;
}

/** Registro leve do que a promoção fez em um pedido. */
export interface AppliedPromotion {
  id: string;
  name: string;
  kind: PromotionKind;
  /** Quanto de desconto esta promoção deu neste pedido. */
  discount: number;
  /** Preenchido só em kind = 'brinde'. */
  giftProductId?: string;
  giftProductName?: string;
}

export interface Driver {
  id: string;
  name: string;
  phone?: string;
  password?: string;
  bikeModel?: string;
  plate?: string;
  active: boolean;
  online?: boolean;
  lat?: number;
  lng?: number;
  /** Quando `lat`/`lng` foram tirados. Ver `locationFreshness` em `driverLocation.ts`. */
  locationAt?: string;
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
  pixKey: string;
  pixMerchantName: string;
  pixMerchantCity: string;
  cardOnDeliveryEnabled: boolean; // a loja tem maquininha para levar na entrega
  storeWhatsApp: string; // WhatsApp da loja p/ receber comprovantes (ex: 5581999990000)
  orderSoundUrl: string; // áudio MP3 personalizado do alerta de novo pedido ('' = voz do sistema)
  openingHours: (OpeningHour | null)[]; // 7 dias: domingo=0 ... sábado=6
  sizeOptions: SizeOption[]; // tamanhos ofertados (ex: caldinhos em ml)
  orderEnabled: boolean; // chave geral aberta/fechada
  forceOpen: boolean; // aberto manualmente, ignora o horário de funcionamento
}

export interface PublicStoreSettings extends StoreSettings {
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

export interface SalesReport {
  totalRevenue: number;
  totalOrders: number;
  avgTicket: number;
  topSellingProducts: { name: string; count: number; total: number }[];
  hourlyDistribution: { hour: string; orders: number }[];
  avgRating: number;
}

export interface RevenuePoint {
  label: string;
  date: string;
  revenue: number;
  orders: number;
}

export interface RevenueTrends {
  daily: RevenuePoint[];
  weekly: RevenuePoint[];
  monthly: RevenuePoint[];
}
