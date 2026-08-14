import React, { useState } from 'react';
import { useClient } from './ClientStore';
import { LiveMap } from '../../components/common/LiveMap';
import { formatKm } from '../../shared/geo';
import {
  X,
  MessageSquare,
  Phone,
  CheckCircle2,
  Clock,
  Flame,
  Star,
  Send,
  Soup,
  Ban,
} from 'lucide-react';
import { OrderStatus } from '../../types';

interface OrderTrackingModalProps {
  orderId: string;
  onClose: () => void;
  onOpenChat: () => void;
}

export const OrderTrackingModal: React.FC<OrderTrackingModalProps> = ({ orderId, onClose, onOpenChat }) => {
  const { orders, rateOrder, cancelOrder, settings } = useClient();
  const order = orders.find((o) => o.id === orderId);

  const [ratingStars, setRatingStars] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);

  if (!order) return null;

  const STATUS_STEPS: { status: OrderStatus; title: string; desc: string; color: string }[] = [
    { status: 'recebido', title: 'Pedido Recebido', desc: 'Confirmado pela loja', color: '#2563EB' },
    { status: 'em_preparo', title: 'Em Preparo', desc: 'Ajeitando seu caldinho bem quente', color: '#D97706' },
    { status: 'pronto', title: 'Pronto', desc: 'Aguardando o motoboy', color: '#B45309' },
    { status: 'saiu_entrega', title: 'A Caminho', desc: 'Motoboy no trecho', color: '#7C3AED' },
    { status: 'entregue', title: 'Entregue', desc: 'Bom apetite!', color: '#059669' },
  ];

  const getStepIndex = (st: OrderStatus) => {
    switch (st) {
      case 'recebido':
        return 0;
      case 'em_preparo':
        return 1;
      case 'pronto':
        return 2;
      case 'saiu_entrega':
        return 3;
      case 'entregue':
        return 4;
      default:
        return 0;
    }
  };

  const isCanceled = order.status === 'cancelado';
  const currentIndex = getStepIndex(order.status);
  const statusColor =
    order.status === 'cancelado'
      ? '#DC2626'
      : order.status === 'entregue'
      ? '#059669'
      : '#7C3AED';

  const handleRatingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await rateOrder(order.id, ratingStars, ratingComment);
    setRatingSubmitted(true);
  };

  const handleCancel = async () => {
    if (!window.confirm('Tem certeza que deseja cancelar este pedido?')) return;
    setIsCanceling(true);
    await cancelOrder(order.id, 'Cancelado pelo cliente');
    setIsCanceling(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end justify-center">
      <div className="bg-white text-[#1C1917] w-full max-w-[430px] h-full rounded-t-3xl border border-[#E7E5E4] shadow-2xl flex flex-col overflow-hidden relative">
        <div className="p-4 border-b border-[#E7E5E4] bg-white flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-extrabold text-[#1C1917]">Pedido {order.id}</span>
              <span
                className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full text-white"
                style={{ backgroundColor: statusColor }}
              >
                {order.status === 'entregue'
                  ? 'Concluído'
                  : order.status === 'cancelado'
                  ? 'Cancelado'
                  : 'Ao Vivo'}
              </span>
            </div>
            <p className="text-xs text-[#57534E]">
              {isCanceled
                ? order.cancellationReason || 'Pedido cancelado'
                : `Previsão de entrega: ~${order.estimatedDeliveryMinutes} minutos`}
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#F5F5F4] text-[#57534E] hover:text-[#1C1917] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1 bg-[#F5F5F4]/30">
          {!isCanceled && (
            <div className="bg-white p-4 rounded-2xl border border-[#E7E5E4] shadow-xs">
              <div className="flex items-center justify-between relative">
                <div className="absolute top-4 left-6 right-6 h-1 bg-[#E7E5E4] -z-0">
                  <div
                    className="h-full bg-[#B91C1C] transition-all duration-500"
                    style={{ width: `${(currentIndex / (STATUS_STEPS.length - 1)) * 100}%` }}
                  />
                </div>

                {STATUS_STEPS.map((step, idx) => {
                  const isPassed = idx <= currentIndex;
                  const isCurrent = idx === currentIndex;

                  return (
                    <div key={step.status} className="flex flex-col items-center text-center z-10 w-16">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                          isCurrent
                            ? 'text-white ring-4 ring-[#B91C1C]/20 scale-110 shadow-md'
                            : isPassed
                            ? 'text-white'
                            : 'bg-[#F5F5F4] border border-[#E7E5E4] text-[#A8A29E]'
                        }`}
                        style={{
                          backgroundColor: isPassed ? step.color : undefined,
                        }}
                      >
                        {isPassed ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                      </div>
                      <span
                        className={`text-[9px] font-bold mt-1.5 line-clamp-1 ${
                          isCurrent ? 'text-[#1C1917]' : isPassed ? 'text-[#57534E]' : 'text-[#A8A29E]'
                        }`}
                      >
                        {step.title}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {order.status !== 'cancelado' && (
            <LiveMap
              store={{ lat: settings.storeLat, lng: settings.storeLng, name: settings.storeName }}
              customer={{
                lat: order.address.lat || settings.storeLat,
                lng: order.address.lng || settings.storeLng,
                label: `${order.address.street}, ${order.address.number}`,
              }}
              driver={
                order.driverLat != null && order.driverLng != null
                  ? { lat: order.driverLat, lng: order.driverLng, name: order.driverName }
                  : null
              }
              heightClass="h-56"
            />
          )}

          {!isCanceled && (
            <div className="bg-white p-3.5 rounded-2xl border border-[#E7E5E4] flex items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#B91C1C] flex items-center justify-center text-white font-bold text-lg shadow-xs">
                  🛵
                </div>
                <div>
                  <div className="text-xs font-bold text-[#1C1917]">
                    {order.driverName || (order.status === 'pronto' ? 'Aguardando motoboy' : 'A definir')}
                  </div>
                  <div className="text-[10px] text-[#57534E]">Entregador Exclusivo Caldinho Express</div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={onOpenChat}
                  className="bg-[#B91C1C] hover:bg-[#991B1B] text-white p-2.5 rounded-full font-bold text-xs flex items-center gap-1.5 shadow-xs transition"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Chat</span>
                </button>
                {order.driverPhone && (
                  <a
                    href={`tel:${order.driverPhone.replace(/\D/g, '')}`}
                    className="bg-[#F5F5F4] hover:bg-[#E7E5E4] text-[#1C1917] p-2.5 rounded-full font-bold text-xs flex items-center gap-1.5 border border-[#E7E5E4] transition"
                  >
                    <Phone className="w-4 h-4" />
                    <span>Ligar</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {order.status === 'recebido' && (
            <button
              onClick={handleCancel}
              disabled={isCanceling}
              className="w-full py-3 rounded-2xl border border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#FEE2E2] transition disabled:opacity-50"
            >
              <Ban className="w-4 h-4" />
              <span>{isCanceling ? 'Cancelando...' : 'Cancelar pedido'}</span>
            </button>
          )}

          <div className="bg-white p-3.5 rounded-2xl border border-[#E7E5E4] space-y-2 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-[#1C1917] uppercase tracking-wider flex items-center gap-1.5">
                <Soup className="w-3.5 h-3.5 text-[#B91C1C]" />
                <span>Itens do Pedido</span>
              </div>
              {order.distanceKm > 0 && (
                <span className="text-[10px] bg-[#E7E5E4] text-[#57534E] px-2 py-0.5 rounded-full font-bold">
                  {formatKm(order.distanceKm)} da loja
                </span>
              )}
            </div>
            {order.items.map((it) => (
              <div
                key={it.id}
                className="flex justify-between text-xs text-[#57534E] py-1 border-b border-[#F5F5F4] last:border-0"
              >
                <div>
                  <span className="font-bold text-[#1C1917]">{it.quantity}x</span> {it.product.name}
                  {it.size && <span className="text-[10px] text-[#A8A29E]"> ({it.size})</span>}
                  {it.comboChoices && it.comboChoices.length > 0 && (
                    <span className="block text-[10px] text-[#D97706]">
                      {it.comboChoices.map((c) => `${c.slotLabel}: ${c.optionLabel}`).join(' • ')}
                    </span>
                  )}
                  {it.isFree && (
                    <span className="text-[10px] text-[#059669] font-bold ml-1">GRÁTIS</span>
                  )}
                </div>
                <span className="font-bold text-[#1C1917]">
                  {it.isFree ? 'R$ 0,00' : `R$ ${it.itemTotalPrice.toFixed(2)}`}
                </span>
              </div>
            ))}
            <div className="pt-2 space-y-1 border-t border-[#E7E5E4] text-xs text-[#57534E]">
              {order.discount > 0 && (
                <div className="flex justify-between">
                  <span>Desconto</span>
                  <span className="text-[#059669] font-bold">- R$ {order.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Entrega</span>
                <span className="font-bold text-[#1C1917]">
                  {order.deliveryFee > 0 ? `R$ ${order.deliveryFee.toFixed(2)}` : 'Grátis'}
                </span>
              </div>
            </div>
            <div className="pt-2 flex justify-between text-sm font-extrabold text-[#1C1917] border-t border-[#E7E5E4]">
              <span>
                Total ({order.payment.method.toUpperCase()})
                {order.payment.isPaid ? '' : ' - pendente'}
              </span>
              <span className="text-[#B91C1C]">R$ {order.total.toFixed(2)}</span>
            </div>
          </div>

          {order.status === 'entregue' && (
            <div className="bg-[#FEF2F2] p-4 rounded-2xl border border-[#FCA5A5] text-center space-y-3">
              <h4 className="text-sm font-extrabold text-[#1C1917] flex items-center justify-center gap-1.5">
                <Flame className="w-4 h-4 text-[#B91C1C]" />
                <span>Como foi seu Caldinho Express?</span>
              </h4>

              {!ratingSubmitted && !order.rating ? (
                <form onSubmit={handleRatingSubmit} className="space-y-3">
                  <div className="flex justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRatingStars(star)}
                        className="p-1 transition transform hover:scale-125"
                      >
                        <Star
                          className={`w-7 h-7 ${
                            star <= ratingStars ? 'fill-[#D97706] text-[#D97706]' : 'text-[#E7E5E4]'
                          }`}
                        />
                      </button>
                    ))}
                  </div>

                  <input
                    type="text"
                    value={ratingComment}
                    onChange={(e) => setRatingComment(e.target.value)}
                    placeholder="Escreva sua avaliação (ex: Caldinho bem quente, torresmo crocante!)..."
                    className="w-full bg-white border border-[#E7E5E4] rounded-xl p-2.5 text-xs text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                  />

                  <button
                    type="submit"
                    className="w-full bg-[#B91C1C] hover:bg-[#991B1B] text-white font-bold py-2.5 rounded-full text-xs flex items-center justify-center gap-2 transition"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Enviar Avaliação</span>
                  </button>
                </form>
              ) : (
                <div className="text-xs text-[#059669] font-bold bg-[#ECFDF5] p-3 rounded-xl border border-[#A7F3D0]">
                  ⭐ Avaliação registrada! Obrigado pelo carinho!
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
