import React, { useEffect, useRef, useState } from 'react';
import { useCart } from './CartStore';
import { useCheckout } from './CheckoutStore';
import { useClientShell, useCartTotals } from './ClientStore';
import { formatKm } from '../../shared/geo';
import { formatAddressLine, isUsableAddress } from '../../shared/address';
import { storeAddressLine } from '../../shared/fulfillment';
import { normalizePaymentTiming, requiresOnlineCharge, timingLabel } from '../../shared/payment';
import { FulfillmentPicker } from './FulfillmentPicker';
import { whatsAppLink } from '../../lib/whatsapp';
import {
  X,
  QrCode,
  CreditCard,
  Banknote,
  Check,
  Copy,
  ArrowLeft,
  ShieldCheck,
  MapPin,
  UserRound,
  Phone,
  ChevronDown,
  Loader2,
  Clock,
  AlertCircle,
  MessageCircle,
  Store,
} from 'lucide-react';
import { Order, PaymentMethod, PaymentTiming } from '../../types';
import { CardPaymentForm, CardPaymentHandle } from './CardPaymentForm';
import { usePixPaymentPoll } from './usePixPoll';
import { copyToClipboard, selectElementText } from './clipboard';

interface CheckoutModalProps {
  onClose: () => void;
  onOrderPlaced: () => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({ onClose, onOrderPlaced }) => {
  const { cart, addresses, selectedAddress, setSelectedAddress, openAddressForm, fulfillment } = useCart();
  const { placeOrder, customerId, applyOrderUpdate } = useCheckout();
  const { settings } = useClientShell();
  const pixOk = !!(settings.pixEnabled || settings.pixKey || settings.mercadoPagoConnected);
  const { subtotal, discount, deliveryFee, total } = useCartTotals();
  const isPickupMode = fulfillment === 'pickup';
  const outOfRange = !isPickupMode && deliveryFee < 0;

  const [step, setStep] = useState<'dados' | 'pagamento'>('dados');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [paymentTiming, setPaymentTiming] = useState<PaymentTiming>('online');
  const [changeForAmount, setChangeForAmount] = useState<string>('');
  const [pixCopied, setPixCopied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAddressList, setShowAddressList] = useState(false);
  const [pendingPix, setPendingPix] = useState<Order | null>(null);
  const [confirmError, setConfirmError] = useState('');
  const [pixCopyFailed, setPixCopyFailed] = useState(false);
  const cardRef = React.useRef<CardPaymentHandle>(null);
  const pixCodeRef = useRef<HTMLDivElement>(null);
  const cardOnline = !!(settings.mercadoPagoConnected && settings.mercadoPagoPublicKey);
  const cardOnDelivery = settings.cardOnDeliveryEnabled !== false;
  const cardOk = cardOnline || cardOnDelivery;
  // Cartão é o único método com escolha de momento. Se só um dos dois existe,
  // não mostramos a escolha: o cliente não decide nada e ainda assim acerta.
  const cardTimingChoice = paymentMethod === 'card' && cardOnline && cardOnDelivery;
  const payNow = paymentMethod !== null && requiresOnlineCharge(paymentMethod, paymentTiming);

  // Cada método tem seus momentos possíveis: dinheiro só na entrega, PIX só
  // online, cartão os dois (respeitando o que a loja realmente aceita).
  useEffect(() => {
    if (!paymentMethod) return;
    if (paymentMethod === 'card') {
      setPaymentTiming(cardOnline ? 'online' : 'delivery');
      return;
    }
    setPaymentTiming(normalizePaymentTiming(paymentMethod, undefined));
  }, [paymentMethod, cardOnline]);

  const nameValid = customerName.trim().length >= 3;
  const phoneValid = customerPhone.replace(/\D/g, '').length >= 10;
  const dadosValid = nameValid && phoneValid;

  // Sem endereço cadastrado: abre o formulário de cadastro automaticamente.
  // Na retirada não há endereço a pedir, então a tela não abre nada.
  useEffect(() => {
    if (!isPickupMode && addresses.length === 0) openAddressForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPickupMode]);

  const { failed: pixPollFailed, retry: retryPixPoll } = usePixPaymentPoll({
    orderId: pendingPix?.id,
    customerId,
    mpPaymentId: pendingPix?.payment.mpPaymentId,
    isPaid: pendingPix?.payment.isPaid ?? false,
    onUpdate: (updated) => {
      applyOrderUpdate(updated);
      setPendingPix(updated);
      if (updated.payment.isPaid) onOrderPlaced();
    },
  });

  const handleCopyPix = async (text?: string) => {
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (ok) {
      setPixCopyFailed(false);
      setPixCopied(true);
      setTimeout(() => setPixCopied(false), 3000);
      return;
    }
    setPixCopied(false);
    setPixCopyFailed(true);
    if (pixCodeRef.current) selectElementText(pixCodeRef.current);
    setTimeout(() => setPixCopyFailed(false), 5000);
  };

  /** Retirada não usa endereço: só a entrega precisa de um endereço válido e no raio. */
  const deliveryBlocked = (): boolean => {
    if (isPickupMode) return false;
    if (!isUsableAddress(selectedAddress)) {
      setConfirmError('Informe um endereço com localização no mapa.');
      openAddressForm();
      return true;
    }
    if (outOfRange) {
      setConfirmError('Este endereço está fora da área de entrega.');
      return true;
    }
    return false;
  };

  const placeAndHandle = async (method: PaymentMethod, timing: PaymentTiming) => {
    if (deliveryBlocked()) return;
    setConfirmError('');
    setIsProcessing(true);
    let card;
    // Só o cartão online passa pelo Mercado Pago. Na maquininha ninguém digita
    // o cartão aqui: o motoboy cobra na porta.
    if (method === 'card' && timing === 'online') {
      if (!settings.mercadoPagoPublicKey) {
        setIsProcessing(false);
        setConfirmError('Falta a chave pública do Mercado Pago na cozinha.');
        return;
      }
      try {
        card = await cardRef.current?.tokenize();
        if (!card) throw new Error('Preencha os dados do cartão.');
      } catch (err) {
        setIsProcessing(false);
        setConfirmError(err instanceof Error ? err.message : 'Confira os dados do cartão.');
        return;
      }
    }
    const res = await placeOrder(
      method,
      timing,
      method === 'cash' && changeForAmount ? Number(changeForAmount) : undefined,
      { name: customerName.trim(), phone: customerPhone.trim() },
      card
    );
    setIsProcessing(false);
    if (!res) return;
    if ('error' in res) {
      setConfirmError(res.error);
      return;
    }
    const order = res.order;
    if (method === 'pix' && order.payment.pixCopyPaste) {
      setPendingPix(order);
    } else {
      onOrderPlaced();
    }
  };

  const handleConfirmOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deliveryBlocked()) return;
    if (!dadosValid) {
      setStep('dados');
      return;
    }
    if (!paymentMethod) {
      setConfirmError('Escolha a forma de pagamento: PIX, Cartão ou Dinheiro.');
      return;
    }
    await placeAndHandle(paymentMethod, paymentTiming);
  };

  // "Continuar para Pagamento": abre a escolha da forma (PIX padrão, cartão e dinheiro disponíveis)
  const handleContinueToPayment = () => {
    if (!dadosValid) return;
    setStep('pagamento');
  };

  const deliveryLabel = isPickupMode
    ? 'Retirada na loja'
    : selectedAddress && selectedAddress.distanceKm > 0
    ? `Entrega (${formatKm(selectedAddress.distanceKm)})`
    : 'Entrega';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end justify-center">
      <div className="bg-white text-[#1C1917] w-full max-w-[430px] h-full rounded-t-3xl border border-[#E7E5E4] shadow-2xl flex flex-col overflow-hidden relative">
        <div className="p-4 border-b border-[#E7E5E4] bg-white flex items-center justify-between shrink-0">
          <button
            onClick={pendingPix ? () => setPendingPix(null) : step === 'pagamento' ? () => setStep('dados') : onClose}
            className="p-1.5 rounded-full hover:bg-[#F5F5F4] text-[#57534E] hover:text-[#1C1917] transition flex items-center gap-1 text-xs font-bold"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>
              {pendingPix ? 'Voltar' : step === 'pagamento' ? 'Voltar aos dados' : 'Voltar ao carrinho'}
            </span>
          </button>

          <h2 className="text-base font-extrabold text-[#1C1917]">
            {pendingPix ? 'Pagamento PIX' : step === 'dados' ? 'Seus Dados' : 'Finalizar Pedido'}
          </h2>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#F5F5F4] text-[#57534E] hover:text-[#1C1917]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {pendingPix ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#F5F5F4]/30">
            <div className="bg-white rounded-2xl p-4 border border-[#E7E5E4] text-center space-y-3 shadow-xs">
              <div className="inline-flex items-center gap-1 text-xs font-bold text-[#059669] bg-[#ECFDF5] px-3 py-1 rounded-full border border-[#A7F3D0]">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Pedido {pendingPix.id} aguardando PIX de R$ {pendingPix.total.toFixed(2)}</span>
              </div>

              <div>
                <p className="text-[11px] text-[#57534E] mb-1.5">
                  Pague <strong>R$ {pendingPix.total.toFixed(2)}</strong> no app do banco.
                  {pendingPix.payment.mpPaymentId
                    ? ' Esta tela confirma sozinha quando o PIX cair.'
                    : ' Envie o comprovante no WhatsApp.'}
                </p>
                {pendingPix.payment.pixQrCode && (
                  <img
                    src={`data:image/png;base64,${pendingPix.payment.pixQrCode}`}
                    alt="QR Code PIX"
                    className="w-44 h-44 mx-auto rounded-xl border border-[#E7E5E4] bg-white p-1"
                  />
                )}
                <div className="bg-[#F5F5F4] border-2 border-dashed border-[#B91C1C]/40 rounded-2xl p-3.5">
                  <div className="text-[9px] font-extrabold text-[#57534E] uppercase tracking-wider mb-1">
                    PIX copia e cola
                  </div>
                  <div ref={pixCodeRef} className="font-mono text-xs font-bold text-[#1C1917] break-all select-all">
                    {pendingPix.payment.pixCopyPaste || settings.pixKey}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyPix(pendingPix.payment.pixCopyPaste || settings.pixKey)}
                    className="mt-2 inline-flex items-center gap-1.5 bg-[#B91C1C] hover:bg-[#991B1B] text-white font-bold px-4 py-2 rounded-full text-xs transition"
                  >
                    {pixCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{pixCopied ? 'PIX copiado!' : 'Copiar PIX'}</span>
                  </button>
                  {pixCopyFailed && (
                    <p className="mt-2 text-[10px] text-[#B91C1C] font-bold">
                      Não conseguimos copiar automaticamente. Selecionamos o código acima — copie manualmente.
                    </p>
                  )}
                </div>
              </div>

              {pixPollFailed && (
                <button
                  type="button"
                  onClick={retryPixPoll}
                  className="w-full bg-[#FEF2F2] border border-[#FCA5A5] rounded-2xl p-3.5 text-xs text-[#B91C1C] font-bold flex items-center justify-center gap-2 hover:bg-[#FEE2E2] transition"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Não conseguimos confirmar o pagamento. Toque para tentar de novo.</span>
                </button>
              )}

              {settings.storeWhatsApp ? (
                <a
                  href={whatsAppLink(
                    settings.storeWhatsApp,
                    `Olá! 🍲 Pedido ${pendingPix.id} no valor de R$ ${pendingPix.total.toFixed(
                      2
                    )} pago via PIX. Segue o comprovante:`
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full bg-[#25D366] hover:bg-[#1EBE5B] text-white font-extrabold py-3.5 px-4 rounded-full shadow-md flex items-center justify-center gap-2 transition text-sm"
                >
                  <MessageCircle className="w-5 h-5" />
                  Enviar comprovante no WhatsApp
                </a>
              ) : (
                <p className="text-[11px] text-[#A8A29E]">
                  Após pagar, aguarde a loja confirmar o pagamento pelo WhatsApp.
                </p>
              )}

              <p className="text-[11px] text-[#57534E] max-w-xs mx-auto">
                A loja confirma o pagamento manualmente quando receber o seu comprovante. Assim que
                confirmar, o acompanhamento do pedido é liberado automaticamente.
              </p>
            </div>

            <button
              onClick={onOrderPlaced}
              className="w-full bg-[#059669] hover:bg-[#047857] text-white font-extrabold py-4 px-4 rounded-full shadow-md transition text-sm"
            >
              Já realizei o pagamento ✅
            </button>
            <p className="text-center text-[10px] text-[#A8A29E]">
              Acompanhe o status do pedido em "Pedidos" assim que o pagamento for confirmado.
            </p>
          </div>
        ) : (
          <>
            {/* Indicador de etapas */}
            <div className="px-4 pt-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 text-[11px] font-black ${step === 'dados' ? 'text-[#B91C1C]' : 'text-[#059669]'}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 'dados' ? 'bg-[#B91C1C] text-white' : 'bg-[#059669] text-white'}`}>
                    {step === 'pagamento' ? <Check className="w-3 h-3" /> : '1'}
                  </span>
                  Dados & Endereço
                </div>
                <div className="flex-1 h-0.5 bg-[#E7E5E4] rounded-full">
                  <div className={`h-full rounded-full transition-all ${step === 'pagamento' ? 'w-full bg-[#059669]' : 'w-0'}`} />
                </div>
                <div className={`flex items-center gap-1.5 text-[11px] font-black ${step === 'pagamento' ? 'text-[#B91C1C]' : 'text-[#A8A29E]'}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 'pagamento' ? 'bg-[#B91C1C] text-white' : 'bg-[#E7E5E4] text-[#A8A29E]'}`}>
                    2
                  </span>
                  Pagamento
                </div>
              </div>
            </div>

            <form id="checkout-form" onSubmit={handleConfirmOrder} className="flex-1 overflow-y-auto p-4 space-y-4">
              {!settings.isOpen && (
                <div className="bg-[#FEF3C7] border border-[#FCD34D] rounded-2xl p-3.5 text-xs text-[#92400E] font-bold flex items-start gap-2">
                  <Clock className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    A loja está fechada no momento. Os pedidos só são aceitos dentro do horário de
                    funcionamento cadastrado.
                  </span>
                </div>
              )}
              {step === 'dados' ? (
                <>
                  <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-2xl p-3.5 text-xs text-[#B91C1C] font-bold flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>Preencha seus dados para continuar. Todos os campos são obrigatórios.</span>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-[#1C1917] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <UserRound className="w-4 h-4 text-[#B91C1C]" />
                      Nome Completo *
                    </label>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Ex: Maria Silva"
                      className={`w-full bg-[#F5F5F4] border rounded-2xl p-3 text-sm text-[#1C1917] placeholder-[#A8A29E] focus:outline-none focus:ring-2 transition ${
                        customerName && !nameValid
                          ? 'border-[#FCA5A5] ring-[#B91C1C]/20'
                          : 'border-[#E7E5E4] focus:ring-[#B91C1C]'
                      }`}
                    />
                    {customerName && !nameValid && (
                      <p className="text-[10px] text-[#B91C1C] font-bold mt-1">Digite seu nome completo (mínimo 3 letras).</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-black text-[#1C1917] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Phone className="w-4 h-4 text-[#B91C1C]" />
                      Telefone / WhatsApp *
                    </label>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="(81) 99999-0000"
                      className={`w-full bg-[#F5F5F4] border rounded-2xl p-3 text-sm text-[#1C1917] placeholder-[#A8A29E] focus:outline-none focus:ring-2 transition ${
                        customerPhone && !phoneValid
                          ? 'border-[#FCA5A5] ring-[#B91C1C]/20'
                          : 'border-[#E7E5E4] focus:ring-[#B91C1C]'
                      }`}
                    />
                    {customerPhone && !phoneValid && (
                      <p className="text-[10px] text-[#B91C1C] font-bold mt-1">Digite um telefone válido com DDD (mínimo 10 dígitos).</p>
                    )}
                  </div>

                  {settings.pickupEnabled && (
                    <div>
                      <label className="block text-xs font-black text-[#1C1917] uppercase tracking-wider mb-2">
                        Como você quer receber *
                      </label>
                      <FulfillmentPicker />
                    </div>
                  )}

                  {isPickupMode ? (
                    <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-2xl p-3.5 space-y-1">
                      <div className="flex items-center gap-2 text-[#059669] font-bold text-xs">
                        <Store className="w-4 h-4" />
                        <span>Retirar em {settings.storeName}</span>
                      </div>
                      <p className="text-[11px] text-[#065F46]">{storeAddressLine(settings)}</p>
                      <p className="text-[11px] text-[#065F46]">
                        Sem taxa de entrega. Avisamos aqui quando o pedido estiver pronto para retirar.
                      </p>
                    </div>
                  ) : (
                  <div>
                    <label className="block text-xs font-black text-[#1C1917] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-[#B91C1C]" />
                      Endereço de Entrega *
                    </label>
                    {addresses.length === 0 ? (
                      <button
                        type="button"
                        onClick={openAddressForm}
                        className="w-full bg-[#FEF2F2] border-2 border-dashed border-[#B91C1C] rounded-2xl p-4 text-center hover:bg-[#FEE2E2] transition"
                      >
                        <div className="text-xs font-extrabold text-[#B91C1C] flex items-center justify-center gap-1.5">
                          <MapPin className="w-4 h-4" />
                          <span>Cadastrar meu endereço</span>
                        </div>
                        <p className="text-[10px] text-[#B91C1C]/70 mt-1">
                          Informe o CEP ou arraste o pino no mapa para calcular a entrega
                        </p>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowAddressList(!showAddressList)}
                        className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-3 text-left focus:outline-none focus:ring-2 focus:ring-[#B91C1C] transition"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-extrabold text-[#1C1917]">
                              {isUsableAddress(selectedAddress)
                                ? selectedAddress?.label || 'Endereço'
                                : 'Selecione'}
                            </div>
                            <div className="text-[11px] text-[#57534E] truncate">
                              {isUsableAddress(selectedAddress)
                                ? formatAddressLine(selectedAddress)
                                : 'Selecione um endereço'}
                            </div>
                          </div>
                          <ChevronDown className={`w-4 h-4 text-[#57534E] shrink-0 transition-transform ${showAddressList ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                    )}

                    {showAddressList && (
                      <div className="mt-2 space-y-2">
                        {addresses.map((addr) => (
                          <button
                            key={addr.id}
                            type="button"
                            onClick={() => {
                              setSelectedAddress(addr);
                              setShowAddressList(false);
                            }}
                            className={`w-full p-3 rounded-2xl border text-left transition flex items-center justify-between gap-2 ${
                              selectedAddress?.id === addr.id
                                ? 'bg-[#FEF2F2] border-[#B91C1C] ring-2 ring-[#B91C1C]/15'
                                : 'bg-white border-[#E7E5E4] hover:bg-[#F5F5F4]'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-extrabold text-[#1C1917]">{addr.label}</div>
                              <div className="text-[11px] text-[#57534E] truncate">
                                {formatAddressLine(addr) || `${addr.street || ''}, ${addr.number || ''}`}
                              </div>
                            </div>
                            {selectedAddress?.id === addr.id && (
                              <span className="w-5 h-5 rounded-full bg-[#B91C1C] text-white flex items-center justify-center shrink-0">
                                <Check className="w-3 h-3" />
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  )}

                  <div className="bg-[#F5F5F4] p-3.5 rounded-2xl border border-[#E7E5E4] space-y-1.5 text-xs">
                    <div className="flex justify-between text-[#57534E]">
                      <span>Itens ({cart.length})</span>
                      <span className="text-[#1C1917] font-semibold">R$ {subtotal.toFixed(2)}</span>
                    </div>
                    {discount > 0 && (
                      <div className="flex justify-between text-[#059669] font-bold">
                        <span>Desconto</span>
                        <span>- R$ {discount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[#57534E]">
                      <span>{deliveryLabel}</span>
                      <span className={`font-semibold ${outOfRange ? 'text-[#B91C1C]' : 'text-[#1C1917]'}`}>
                        {outOfRange ? 'Fora da área' : deliveryFee > 0 ? `R$ ${deliveryFee.toFixed(2)}` : 'Grátis'}
                      </span>
                    </div>
                    <div className="flex justify-between text-base font-black text-[#1C1917] pt-2 border-t border-[#E7E5E4]">
                      <span>Total a Pagar</span>
                      <span className="text-[#B91C1C]">R$ {total.toFixed(2)}</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-3.5 space-y-1">
                    <div className="flex items-center gap-2 text-[#B91C1C] font-bold text-xs">
                      {isPickupMode ? <Store className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                      <span>{isPickupMode ? 'Retirada na loja por' : 'Entrega para'}</span>
                    </div>
                    <p className="text-xs font-extrabold text-[#1C1917]">{customerName}</p>
                    <p className="text-xs text-[#57534E]">{customerPhone}</p>
                    <p className="text-xs text-[#57534E] border-t border-[#E7E5E4] pt-1.5 mt-1.5">
                      {isPickupMode
                        ? storeAddressLine(settings)
                        : isUsableAddress(selectedAddress)
                        ? formatAddressLine(selectedAddress)
                        : 'Endereço não informado'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-[#1C1917] uppercase tracking-wider mb-2">
                      Forma de Pagamento
                    </label>
                    <div className="grid grid-cols-3 gap-2.5">
                      {[
                        { id: 'pix' as const, label: 'PIX', icon: QrCode, enabled: pixOk },
                        { id: 'card' as const, label: 'Cartão', icon: CreditCard, enabled: cardOk },
                        { id: 'cash' as const, label: 'Dinheiro', icon: Banknote, enabled: true },
                      ].map((method) => {
                        const Icon = method.icon;
                        const isSelected = paymentMethod === method.id;
                        return (
                          <button
                            key={method.id}
                            type="button"
                            disabled={!method.enabled}
                            onClick={() => setPaymentMethod(method.id)}
                            className={`p-3.5 rounded-2xl border text-center transition flex flex-col items-center justify-center gap-1.5 ${
                              isSelected
                                ? 'bg-[#FEF2F2] border-[#B91C1C] text-[#B91C1C] ring-2 ring-[#B91C1C]/20 shadow-xs'
                                : 'bg-[#F5F5F4]/60 border-[#E7E5E4] hover:bg-[#F5F5F4] text-[#57534E]'
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                          >
                            <Icon className={`w-5 h-5 ${isSelected ? 'text-[#B91C1C]' : 'text-[#57534E]'}`} />
                            <span className="text-xs font-bold">{method.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    {paymentMethod === 'pix' && !pixOk && (
                      <p className="text-[10px] text-[#B91C1C] font-bold mt-2">
                        PIX indisponível: a loja ainda não conectou o Mercado Pago nem cadastrou a chave.
                      </p>
                    )}
                    {!cardOk && (
                      <p className="text-[10px] text-[#57534E] mt-2">
                        Cartão indisponível. Pague no PIX ou em dinheiro
                        {isPickupMode ? ' na retirada.' : ' na entrega.'}
                      </p>
                    )}
                  </div>

                  {paymentMethod === 'card' && cardOk && (
                    <div>
                      <label className="block text-xs font-black text-[#1C1917] uppercase tracking-wider mb-2">
                        Quando pagar
                      </label>
                      {cardTimingChoice ? (
                        <div className="grid grid-cols-2 gap-2.5">
                          {[
                            {
                              id: 'online' as const,
                              title: 'Pagar agora',
                              hint: 'Cartão pelo site',
                            },
                            {
                              id: 'delivery' as const,
                              title: isPickupMode ? 'Na retirada' : 'Na entrega',
                              hint: isPickupMode ? 'Maquininha no balcão' : 'Maquininha com o motoboy',
                            },
                          ].map((option) => {
                            const isSelected = paymentTiming === option.id;
                            return (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => setPaymentTiming(option.id)}
                                className={`p-3 rounded-2xl border text-left transition ${
                                  isSelected
                                    ? 'bg-[#FEF2F2] border-[#B91C1C] ring-2 ring-[#B91C1C]/20 shadow-xs'
                                    : 'bg-[#F5F5F4]/60 border-[#E7E5E4] hover:bg-[#F5F5F4]'
                                }`}
                              >
                                <span
                                  className={`block text-xs font-extrabold ${
                                    isSelected ? 'text-[#B91C1C]' : 'text-[#1C1917]'
                                  }`}
                                >
                                  {option.title}
                                </span>
                                <span className="block text-[10px] text-[#57534E] leading-tight">
                                  {option.hint}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[11px] text-[#57534E] bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-3">
                          {cardOnline
                            ? 'Só dá para pagar o cartão agora, pelo site — a loja não leva maquininha.'
                            : `A loja ainda não cobra cartão pelo site. Você paga na maquininha ${
                                isPickupMode ? 'do balcão.' : 'do motoboy.'
                              }`}
                        </p>
                      )}
                    </div>
                  )}

                  {paymentMethod === 'pix' && pixOk && (
                    <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-2xl p-4 text-center space-y-2">
                      <div className="inline-flex items-center gap-1 text-xs font-bold text-[#059669]">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>PIX de R$ {total.toFixed(2)} — QR na próxima tela</span>
                      </div>
                      <p className="text-[11px] text-[#57534E]">
                        {settings.mercadoPagoConnected
                          ? 'Após confirmar, pague o PIX. O pedido libera sozinho quando o dinheiro cair.'
                          : 'Após confirmar, copie o PIX, pague no banco e envie o comprovante no WhatsApp.'}
                      </p>
                    </div>
                  )}

                  {paymentMethod === 'card' && paymentTiming === 'online' && settings.mercadoPagoPublicKey && (
                    <CardPaymentForm
                      ref={cardRef}
                      publicKey={settings.mercadoPagoPublicKey}
                      amount={total > 0 ? total : 1}
                    />
                  )}

                  {paymentMethod === 'card' &&
                    paymentTiming === 'online' &&
                    settings.mercadoPagoConnected &&
                    !settings.mercadoPagoPublicKey && (
                    <div className="bg-[#FEF3C7] border border-[#FCD34D] rounded-2xl p-3 text-[11px] text-[#92400E] font-bold">
                      Falta a chave pública na cozinha. Sem ela o cartão não abre nesta tela.
                    </div>
                  )}

                  {paymentMethod === 'card' && paymentTiming === 'delivery' && cardOnDelivery && (
                    <div className="bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-4">
                      <div className="flex items-start gap-2.5 text-xs text-[#57534E]">
                        <CreditCard className="w-4 h-4 text-[#B91C1C] shrink-0 mt-0.5" />
                        <p>
                          <strong className="text-[#1C1917]">
                            {isPickupMode ? 'Cartão na retirada.' : 'Cartão na entrega.'}
                          </strong>{' '}
                          A maquininha
                          {isPickupMode ? ' fica no balcão da loja.' : ' vai com o motoboy.'} Você paga
                          R$ {total.toFixed(2)} na hora, em débito ou crédito.
                        </p>
                      </div>
                    </div>
                  )}

                  {paymentMethod === 'cash' && (
                    <div className="bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-4 space-y-3">
                      <label className="block text-[11px] text-[#1C1917] font-bold mb-1">
                        Precisa de troco? Digite para quanto:
                      </label>
                      <div className="flex gap-2">
                        {[
                          { label: 'Sem Troco', value: '' },
                          { label: 'R$ 50,00', value: '50' },
                          { label: 'R$ 100,00', value: '100' },
                        ].map((opt) => (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => setChangeForAmount(opt.value)}
                            className={`flex-1 py-2 rounded-xl border text-xs font-bold transition ${
                              changeForAmount === opt.value
                                ? 'bg-[#B91C1C] border-[#B91C1C] text-white shadow-xs'
                                : 'bg-white border-[#E7E5E4] text-[#1C1917] hover:bg-[#E7E5E4]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={changeForAmount}
                        onChange={(e) => setChangeForAmount(e.target.value)}
                        placeholder="Ex: 50.00"
                        className="w-full bg-white border border-[#E7E5E4] rounded-xl p-2.5 text-xs text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                      />
                    </div>
                  )}

                  <div className="bg-[#F5F5F4] p-3.5 rounded-2xl border border-[#E7E5E4] space-y-1.5 text-xs">
                    <div className="flex justify-between text-[#57534E]">
                      <span>Itens ({cart.length})</span>
                      <span className="text-[#1C1917] font-semibold">R$ {subtotal.toFixed(2)}</span>
                    </div>
                    {discount > 0 && (
                      <div className="flex justify-between text-[#059669] font-bold">
                        <span>Desconto</span>
                        <span>- R$ {discount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[#57534E]">
                      <span>{deliveryLabel}</span>
                      <span className={`font-semibold ${outOfRange ? 'text-[#B91C1C]' : 'text-[#1C1917]'}`}>
                        {outOfRange ? 'Fora da área' : deliveryFee > 0 ? `R$ ${deliveryFee.toFixed(2)}` : 'Grátis'}
                      </span>
                    </div>
                    <div className="flex justify-between text-base font-black text-[#1C1917] pt-2 border-t border-[#E7E5E4]">
                      <span>Total a Pagar</span>
                      <span className="text-[#B91C1C]">R$ {total.toFixed(2)}</span>
                    </div>
                  </div>
                </>
              )}
            </form>

            {/* Rodapé fixo com CTA (mobile) */}
            <div className="shrink-0 p-4 pb-[calc(env(safe-area-inset-bottom)+12px)] bg-white border-t border-[#E7E5E4]">
              {confirmError && (
                <div className="mb-2 bg-[#FEF2F2] border border-[#FCA5A5] rounded-2xl p-3 text-[11px] text-[#B91C1C] font-bold flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{confirmError}</span>
                </div>
              )}
              {step === 'dados' ? (
                <button
                  type="button"
                  disabled={!dadosValid}
                  onClick={handleContinueToPayment}
                  className="w-full bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold py-4 px-4 rounded-full shadow-md flex items-center justify-center gap-2 transition text-sm disabled:opacity-50"
                >
                  <span>Continuar para Pagamento</span>
                  <span className="text-xs font-bold text-[#FDE68A]">R$ {total.toFixed(2)}</span>
                </button>
              ) : (
                <button
                  type="submit"
                  form="checkout-form"
                  disabled={isProcessing || !paymentMethod}
                  className="w-full bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold py-4 px-4 rounded-full shadow-md flex items-center justify-center gap-2 transition text-sm disabled:opacity-50"
                >
                  {isProcessing ? (
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      <span>Confirmando pedido...</span>
                    </div>
                  ) : (
                    <span>
                      {!paymentMethod
                        ? 'Escolha a forma de pagamento'
                        : payNow
                        ? `Pagar R$ ${total.toFixed(2)} agora 🍲`
                        : `Confirmar e pagar ${timingLabel(
                            { method: paymentMethod, timing: paymentTiming },
                            fulfillment
                          )} 🍲`}
                    </span>
                  )}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
