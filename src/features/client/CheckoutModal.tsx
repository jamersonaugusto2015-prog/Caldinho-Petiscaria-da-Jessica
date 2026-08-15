import React, { useEffect, useState } from 'react';
import { useClient, useCartTotals } from './ClientStore';
import { formatKm } from '../../shared/geo';
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
} from 'lucide-react';
import { Order } from '../../types';

interface CheckoutModalProps {
  onClose: () => void;
  onOrderPlaced: () => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({ onClose, onOrderPlaced }) => {
  const { cart, addresses, selectedAddress, setSelectedAddress, placeOrder, settings, openAddressForm } =
    useClient();
  const { subtotal, discount, deliveryFee, total } = useCartTotals();

  const [step, setStep] = useState<'dados' | 'pagamento'>('dados');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'card' | 'cash'>(
    settings.pixKey ? 'pix' : 'card'
  );
  const [changeForAmount, setChangeForAmount] = useState<string>('');
  const [pixCopied, setPixCopied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAddressList, setShowAddressList] = useState(false);
  const [pendingPix, setPendingPix] = useState<Order | null>(null);
  const [confirmError, setConfirmError] = useState('');

  const nameValid = customerName.trim().length >= 3;
  const phoneValid = customerPhone.replace(/\D/g, '').length >= 10;
  const dadosValid = nameValid && phoneValid;

  // Sem endereço cadastrado: abre o formulário de cadastro automaticamente
  useEffect(() => {
    if (addresses.length === 0) openAddressForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopyPixKey = () => {
    if (!settings.pixKey) return;
    navigator.clipboard
      .writeText(settings.pixKey)
      .then(() => {
        setPixCopied(true);
        setTimeout(() => setPixCopied(false), 3000);
      })
      .catch(() => {});
  };

  const placeAndHandle = async (method: 'pix' | 'card' | 'cash') => {
    setConfirmError('');
    setIsProcessing(true);
    const res = await placeOrder(
      method,
      method === 'cash' && changeForAmount ? Number(changeForAmount) : undefined,
      { name: customerName.trim(), phone: customerPhone.trim() }
    );
    setIsProcessing(false);
    if (!res) return;
    if ('error' in res) {
      setConfirmError(res.error);
      return;
    }
    const order = res.order;
    if (method === 'pix' && order.payment.pixCopyPaste) {
      setPendingPix(order); // mostra o PIX real para pagamento
    } else {
      onOrderPlaced();
    }
  };

  const handleConfirmOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dadosValid) {
      setStep('dados');
      return;
    }
    await placeAndHandle(paymentMethod);
  };

  // "Continuar para Pagamento": abre a escolha da forma (PIX padrão, cartão e dinheiro disponíveis)
  const handleContinueToPayment = () => {
    if (!dadosValid) return;
    setStep('pagamento');
  };

  const deliveryLabel =
    selectedAddress.distanceKm > 0
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
                  Pague <strong>R$ {pendingPix.total.toFixed(2)}</strong> para a chave PIX abaixo e envie o
                  comprovante no WhatsApp:
                </p>
                <div className="bg-[#F5F5F4] border-2 border-dashed border-[#B91C1C]/40 rounded-2xl p-3.5">
                  <div className="text-[9px] font-extrabold text-[#57534E] uppercase tracking-wider mb-1">
                    Chave PIX da loja
                  </div>
                  <div className="font-mono text-xs font-bold text-[#1C1917] break-all select-all">
                    {settings.pixKey}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyPixKey}
                    className="mt-2 inline-flex items-center gap-1.5 bg-[#B91C1C] hover:bg-[#991B1B] text-white font-bold px-4 py-2 rounded-full text-xs transition"
                  >
                    {pixCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{pixCopied ? 'Chave copiada!' : 'Copiar chave PIX'}</span>
                  </button>
                </div>
              </div>

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
                            <div className="text-xs font-extrabold text-[#1C1917]">{selectedAddress.label || 'Selecione'}</div>
                            <div className="text-[11px] text-[#57534E] truncate">
                              {selectedAddress.street
                                ? `${selectedAddress.street}, ${selectedAddress.number} - ${selectedAddress.neighborhood}`
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
                              selectedAddress.id === addr.id
                                ? 'bg-[#FEF2F2] border-[#B91C1C] ring-2 ring-[#B91C1C]/15'
                                : 'bg-white border-[#E7E5E4] hover:bg-[#F5F5F4]'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-extrabold text-[#1C1917]">{addr.label}</div>
                              <div className="text-[11px] text-[#57534E] truncate">
                                {addr.street}, {addr.number} - {addr.neighborhood} (
                                {addr.distanceKm > 0 ? formatKm(addr.distanceKm) : 'sem localização'})
                              </div>
                            </div>
                            {selectedAddress.id === addr.id && (
                              <span className="w-5 h-5 rounded-full bg-[#B91C1C] text-white flex items-center justify-center shrink-0">
                                <Check className="w-3 h-3" />
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

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
                      <span className="text-[#1C1917] font-semibold">
                        {deliveryFee > 0 ? `R$ ${deliveryFee.toFixed(2)}` : 'Grátis'}
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
                      <MapPin className="w-4 h-4" />
                      <span>Entrega para</span>
                    </div>
                    <p className="text-xs font-extrabold text-[#1C1917]">{customerName}</p>
                    <p className="text-xs text-[#57534E]">{customerPhone}</p>
                    <p className="text-xs text-[#57534E] border-t border-[#E7E5E4] pt-1.5 mt-1.5">
                      {selectedAddress.street}, {selectedAddress.number} - {selectedAddress.neighborhood}
                      {selectedAddress.distanceKm > 0 && (
                        <span className="text-[#B91C1C] font-bold"> ({formatKm(selectedAddress.distanceKm)})</span>
                      )}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-[#1C1917] uppercase tracking-wider mb-2">
                      Forma de Pagamento
                    </label>
                    <div className="grid grid-cols-3 gap-2.5">
                      {[
                        { id: 'pix' as const, label: 'PIX', icon: QrCode, enabled: !!settings.pixKey },
                        { id: 'card' as const, label: 'Cartão', icon: CreditCard, enabled: true },
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
                    {paymentMethod === 'pix' && !settings.pixKey && (
                      <p className="text-[10px] text-[#B91C1C] font-bold mt-2">
                        PIX indisponível: a loja ainda não cadastrou a chave PIX.
                      </p>
                    )}
                  </div>

                  {paymentMethod === 'pix' && settings.pixKey && (
                    <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-2xl p-4 text-center space-y-2">
                      <div className="inline-flex items-center gap-1 text-xs font-bold text-[#059669]">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>PIX de R$ {total.toFixed(2)} — chave da loja na próxima tela</span>
                      </div>
                      <p className="text-[11px] text-[#57534E]">
                        Após confirmar, você copia a chave PIX da loja, paga no seu banco e envia o
                        comprovante pelo WhatsApp. A cozinha confirma o pedido.
                      </p>
                    </div>
                  )}

                  {paymentMethod === 'card' && (
                    <div className="bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-4 space-y-3">
                      <div className="flex items-start gap-2.5 text-xs text-[#57534E]">
                        <CreditCard className="w-4 h-4 text-[#B91C1C] shrink-0 mt-0.5" />
                        <p>
                          <strong className="text-[#1C1917]">Cartão pago na entrega.</strong> O entregador leva a
                          maquininha (débito ou crédito) e você paga ao receber o pedido.
                        </p>
                      </div>
                      <div className="bg-white border border-[#E7E5E4] rounded-xl p-2.5 text-[11px] text-[#57534E]">
                        Taxa da maquininha: a loja pode aplicar uma taxa adicional na entrega, se aplicável.
                      </div>
                    </div>
                  )}

                  {paymentMethod === 'cash' && (
                    <div className="bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-4 space-y-3">
                      <label className="block text-[11px] text-[#1C1917] font-bold mb-1">
                        Precisa de troco? Digite para quanto:
                      </label>
                      <div className="flex gap-2">
                        {['Sem Troco', '50,00', '100,00'].map((amt) => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => setChangeForAmount(amt === 'Sem Troco' ? '' : amt)}
                            className="flex-1 py-2 rounded-xl bg-white border border-[#E7E5E4] text-xs font-bold text-[#1C1917] hover:bg-[#E7E5E4] transition"
                          >
                            {amt}
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
                      <span className="text-[#1C1917] font-semibold">
                        {deliveryFee > 0 ? `R$ ${deliveryFee.toFixed(2)}` : 'Grátis'}
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
                  disabled={isProcessing}
                  className="w-full bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold py-4 px-4 rounded-full shadow-md flex items-center justify-center gap-2 transition text-sm disabled:opacity-50"
                >
                  {isProcessing ? (
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      <span>Confirmando pedido...</span>
                    </div>
                  ) : (
                    <span>Confirmar Pedido & Enviar para a Cozinha 🍲</span>
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
