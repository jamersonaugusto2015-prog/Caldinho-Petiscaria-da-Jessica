import React, { useEffect, useRef, useState } from 'react';
import { useCheckout } from './CheckoutStore';
import { useClientShell } from './ClientStore';
import { LiveMap } from '../../components/common/LiveMap';
import { formatKm } from '../../shared/geo';
import { whatsAppLink } from '../../lib/whatsapp';
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
  QrCode,
  Copy,
  Check,
  ShieldCheck,
  MessageCircle,
  AlertCircle,
  AlertTriangle,
  Timer,
  Undo2,
} from 'lucide-react';
import { OrderStatus } from '../../types';
import { usePixPaymentPoll } from './usePixPoll';
import { copyToClipboard, selectElementText } from './clipboard';
import { OrderActionSheet } from './OrderActionSheet';
import {
  cancelRequestDeadline,
  canOpenComplaint,
  formatShortDate,
  isCancelRequestExpired,
  isOrderLate,
  minutesLeft,
  useNow,
} from './orderTiming';

const REQUESTABLE_STATUSES: OrderStatus[] = ['em_preparo', 'pronto', 'saiu_entrega'];

interface OrderTrackingModalProps {
  orderId: string;
  onClose: () => void;
  onOpenChat: () => void;
}

export const OrderTrackingModal: React.FC<OrderTrackingModalProps> = ({ orderId, onClose, onOpenChat }) => {
  const {
    orders,
    rateOrder,
    cancelOrder,
    requestOrderCancellation,
    openOrderComplaint,
    customerId,
    applyOrderUpdate,
  } = useCheckout();
  const { settings } = useClientShell();
  const order = orders.find((o) => o.id === orderId);

  const [ratingStars, setRatingStars] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sheet, setSheet] = useState<'cancel' | 'request' | 'complaint' | null>(null);
  const [pixCopied, setPixCopied] = useState(false);
  const [pixCopyFailed, setPixCopyFailed] = useState(false);
  const pixCodeRef = useRef<HTMLDivElement>(null);

  const hasPendingRequest = order?.cancellationRequest?.status === 'pendente';
  const now = useNow(hasPendingRequest ? 10000 : 60000);

  const { failed: pixPollFailed, retry: retryPixPoll } = usePixPaymentPoll({
    orderId: order?.id,
    customerId,
    mpPaymentId: order?.payment.mpPaymentId,
    isPaid: order?.payment.isPaid ?? false,
    isCanceled: order?.status === 'cancelado',
    onUpdate: applyOrderUpdate,
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

  if (!order) return null;

  const isCanceled = order.status === 'cancelado';
  const cancelRequest = order.cancellationRequest;
  const requestExpired = isCancelRequestExpired(cancelRequest, now);
  const requestPending = cancelRequest?.status === 'pendente' && !requestExpired;
  const canRequestCancel =
    !isCanceled &&
    REQUESTABLE_STATUSES.includes(order.status) &&
    (!cancelRequest || cancelRequest.status === 'recusado');
  const isLate = isOrderLate(order, now);
  const refundStatus = order.payment.refundStatus;
  const canComplain = canOpenComplaint(order, now);

  const handleImmediateCancel = async (reason: string) => {
    setIsSubmitting(true);
    const ok = await cancelOrder(order.id, reason || 'Cancelado pelo cliente');
    setIsSubmitting(false);
    if (ok) setSheet(null);
  };

  const handleRequestCancel = async (reason: string) => {
    setIsSubmitting(true);
    const ok = await requestOrderCancellation(order.id, reason);
    setIsSubmitting(false);
    if (ok) setSheet(null);
  };

  const handleComplaint = async (text: string) => {
    setIsSubmitting(true);
    const ok = await openOrderComplaint(order.id, text);
    setIsSubmitting(false);
    if (ok) setSheet(null);
  };

  const actionSheet =
    sheet === 'cancel' ? (
      <OrderActionSheet
        emoji="🚫"
        title="Cancelar este pedido?"
        description="A loja ainda não começou o preparo, então o cancelamento é na hora. Depois de cancelar não dá para voltar atrás."
        reasonLabel="Motivo (opcional)"
        reasonPlaceholder="Ex: pedi sem querer, mudei de endereço..."
        confirmLabel="Sim, cancelar pedido"
        busyLabel="Cancelando..."
        dismissLabel="Não, manter o pedido"
        busy={isSubmitting}
        onConfirm={handleImmediateCancel}
        onClose={() => setSheet(null)}
      />
    ) : sheet === 'request' ? (
      <OrderActionSheet
        emoji="🙋"
        title="Pedir cancelamento"
        description="Seu caldinho já está sendo preparado, então quem decide é a loja. Ela tem 5 minutos para responder."
        reasonLabel="Conte o motivo"
        reasonPlaceholder="Ex: está muito atrasado, não posso mais receber..."
        reasonRequired
        confirmLabel="Enviar pedido de cancelamento"
        busyLabel="Enviando..."
        busy={isSubmitting}
        onConfirm={handleRequestCancel}
        onClose={() => setSheet(null)}
      />
    ) : sheet === 'complaint' ? (
      <OrderActionSheet
        emoji="😕"
        title="Tive um problema"
        description="Conte o que aconteceu com este pedido. A loja recebe sua mensagem no chat e responde por lá."
        reasonLabel="O que aconteceu?"
        reasonPlaceholder="Ex: veio faltando um item, chegou frio..."
        reasonRequired
        maxLength={400}
        confirmLabel="Enviar reclamação"
        busyLabel="Enviando..."
        busy={isSubmitting}
        onConfirm={handleComplaint}
        onClose={() => setSheet(null)}
      />
    ) : null;

  const storeWhatsAppButton = (label: string, message: string) =>
    settings.storeWhatsApp ? (
      <a
        href={whatsAppLink(settings.storeWhatsApp, message)}
        target="_blank"
        rel="noreferrer"
        className="mt-2.5 w-full bg-[#25D366] hover:bg-[#1EBE5B] text-white font-extrabold py-3 px-4 rounded-full shadow-md flex items-center justify-center gap-2 transition text-xs"
      >
        <MessageCircle className="w-4 h-4" />
        {label}
      </a>
    ) : null;

  const immediateCancelButton = order.status === 'recebido' && (
    <button
      onClick={() => setSheet('cancel')}
      disabled={isSubmitting}
      className="w-full py-3 rounded-2xl border border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#FEE2E2] transition disabled:opacity-50"
    >
      <Ban className="w-4 h-4" />
      <span>{isSubmitting ? 'Cancelando...' : 'Cancelar pedido'}</span>
    </button>
  );

  const refundPanel = refundStatus && (
    <div
      className={`rounded-2xl p-3.5 border text-xs font-bold flex items-start gap-2 ${
        refundStatus === 'devolvido'
          ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
          : refundStatus === 'falhou'
          ? 'bg-[#FEF2F2] border-[#FCA5A5] text-[#B91C1C]'
          : 'bg-[#FEF3C7] border-[#FCD34D] text-[#92400E]'
      }`}
    >
      <Undo2 className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="flex-1">
        {refundStatus === 'pendente' && (
          <>
            <p>Devolução de R$ {order.total.toFixed(2)} em andamento.</p>
            <p className="font-semibold mt-0.5">
              O dinheiro volta pelo mesmo jeito que você pagou. Qualquer dúvida, fale com a loja pelo chat.
            </p>
          </>
        )}
        {refundStatus === 'devolvido' && <p>Valor devolvido em {formatShortDate(order.payment.refundedAt)}.</p>}
        {refundStatus === 'falhou' && (
          <>
            <p>A devolução falhou. A loja ainda deve R$ {order.total.toFixed(2)} a você.</p>
            {storeWhatsAppButton(
              'Falar com a loja no WhatsApp',
              `Olá! 🍲 Pedido ${order.id} foi cancelado e a devolução de R$ ${order.total.toFixed(
                2
              )} não foi concluída. Podem verificar?`
            )}
          </>
        )}
      </div>
    </div>
  );

  // Pagamento PIX pendente: bloqueia o detalhe/rastreio até a cozinha confirmar.
  // Pedido cancelado nunca entra aqui — seria pedir dinheiro por um pedido que não existe mais.
  if (!isCanceled && order.payment.method === 'pix' && !order.payment.isPaid) {
    return (
      <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end justify-center">
        <div className="bg-white text-[#1C1917] w-full max-w-[430px] h-full rounded-t-3xl border border-[#E7E5E4] shadow-2xl flex flex-col overflow-hidden relative">
          <div className="p-4 border-b border-[#E7E5E4] bg-white flex items-center justify-between shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-extrabold text-[#1C1917]">Pedido {order.id}</span>
                <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full text-white bg-[#B45309]">
                  Aguardando pagamento
                </span>
              </div>
              <p className="text-xs text-[#57534E]">Pagamento PIX de R$ {order.total.toFixed(2)}</p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-[#F5F5F4] text-[#57534E] hover:text-[#1C1917] transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#F5F5F4]/30">
            <div className="bg-white rounded-2xl p-4 border border-[#E7E5E4] text-center space-y-3 shadow-xs">
              <div className="inline-flex items-center gap-1 text-xs font-bold text-[#B45309] bg-[#FEF3C7] px-3 py-1 rounded-full border border-[#FCD34D]">
                <QrCode className="w-3.5 h-3.5" />
                <span>Pague para liberar o acompanhamento do pedido</span>
              </div>

              <div>
                <p className="text-[11px] text-[#57534E] mb-1.5">
                  Pague <strong>R$ {order.total.toFixed(2)}</strong> no app do banco.
                  {order.payment.mpPaymentId
                    ? ' Esta tela libera sozinha quando o PIX cair.'
                    : ' Envie o comprovante no WhatsApp.'}
                </p>
                {order.payment.pixQrCode && (
                  <img
                    src={`data:image/png;base64,${order.payment.pixQrCode}`}
                    alt="QR Code PIX"
                    className="w-44 h-44 mx-auto rounded-xl border border-[#E7E5E4] bg-white p-1"
                  />
                )}
                <div className="bg-[#F5F5F4] border-2 border-dashed border-[#B91C1C]/40 rounded-2xl p-3.5">
                  <div className="text-[9px] font-extrabold text-[#57534E] uppercase tracking-wider mb-1">
                    PIX copia e cola
                  </div>
                  <div ref={pixCodeRef} className="font-mono text-xs font-bold text-[#1C1917] break-all select-all">
                    {order.payment.pixCopyPaste || settings.pixKey}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyPix(order.payment.pixCopyPaste || settings.pixKey)}
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
                    `Olá! 🍲 Pedido ${order.id} no valor de R$ ${order.total.toFixed(
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
                  Após pagar, aguarde a loja confirmar o pagamento.
                </p>
              )}
            </div>

            <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-2xl p-3.5 text-[11px] text-[#065F46] font-bold flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Já pagou? O rastreio é liberado automaticamente assim que a loja confirmar o pagamento —
                esta tela atualiza sozinha. Você também pode avisar a loja pelo chat após a liberação.
              </span>
            </div>

            {immediateCancelButton}
          </div>
        </div>
      </div>
      {actionSheet}
      </>
  );
}

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

  return (
    <>
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
            <p className={`text-xs ${isLate ? 'text-[#B45309] font-bold' : 'text-[#57534E]'}`}>
              {isCanceled
                ? order.cancellationReason || 'Pedido cancelado'
                : isLate
                ? `A previsão de ~${order.estimatedDeliveryMinutes} minutos já passou`
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
          {isCanceled && (
            <div className="bg-white rounded-2xl p-4 border border-[#FCA5A5] shadow-xs space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-extrabold text-[#B91C1C]">
                <Ban className="w-4 h-4 shrink-0" />
                <span>Pedido cancelado</span>
              </div>
              {cancelRequest?.status === 'aceito' && (
                <p className="text-xs font-bold text-[#1C1917]">Cancelamento aceito pela loja.</p>
              )}
              <p className="text-xs text-[#57534E]">
                {order.cancellationReason || 'Este pedido não será mais preparado nem entregue.'}
              </p>
              {order.cancelledAt && (
                <p className="text-[10px] text-[#A8A29E] font-bold">
                  {order.cancelledBy === 'loja' ? 'Cancelado pela loja' : 'Cancelado por você'} em{' '}
                  {new Date(order.cancelledAt).toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </p>
              )}
              {!refundStatus && order.payment.isPaid && (
                <p className="text-[11px] text-[#57534E] font-semibold">
                  Se você já pagou, fale com a loja pelo chat para acertar a devolução.
                </p>
              )}
            </div>
          )}

          {refundPanel}

          {isLate && (
            <div className="bg-[#FEF3C7] border border-[#FCD34D] rounded-2xl p-3.5 text-xs font-bold text-[#92400E] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p>Seu pedido está atrasado.</p>
                <p className="font-semibold mt-0.5">
                  A loja continua com ele. Fale pelo chat ou peça o cancelamento aqui embaixo se não puder
                  mais esperar.
                </p>
              </div>
            </div>
          )}

          {requestPending && (
            <div className="bg-white rounded-2xl p-3.5 border border-[#FCD34D] shadow-xs text-xs space-y-1">
              <div className="flex items-center gap-2 font-extrabold text-[#92400E]">
                <Timer className="w-4 h-4 shrink-0" />
                <span>Pedido de cancelamento enviado. A loja tem 5 minutos para responder.</span>
              </div>
              <p className="text-[11px] text-[#57534E] font-bold">
                Faltam {minutesLeft(cancelRequestDeadline(cancelRequest), now)} min para a resposta.
              </p>
              {cancelRequest?.reason && (
                <p className="text-[11px] text-[#A8A29E]">Seu motivo: {cancelRequest.reason}</p>
              )}
            </div>
          )}

          {requestExpired && (
            <div className="bg-white rounded-2xl p-3.5 border border-[#FCA5A5] shadow-xs text-xs">
              <div className="flex items-center gap-2 font-extrabold text-[#B91C1C]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>A loja ainda não respondeu. Fale com ela pelo WhatsApp.</span>
              </div>
              {storeWhatsAppButton(
                'Falar com a loja no WhatsApp',
                `Olá! 🍲 Pedi o cancelamento do pedido ${order.id} e ainda não tive resposta. Podem me ajudar?`
              )}
            </div>
          )}

          {cancelRequest?.status === 'recusado' && !isCanceled && (
            <div className="bg-white rounded-2xl p-3.5 border border-[#E7E5E4] shadow-xs text-xs space-y-1">
              <div className="flex items-center gap-2 font-extrabold text-[#1C1917]">
                <AlertCircle className="w-4 h-4 shrink-0 text-[#B45309]" />
                <span>A loja não aceitou o cancelamento.</span>
              </div>
              {cancelRequest.responseNote && (
                <p className="text-[11px] text-[#57534E]">{cancelRequest.responseNote}</p>
              )}
              <p className="text-[11px] text-[#A8A29E]">Seu pedido segue normalmente.</p>
            </div>
          )}

          {order.complaint && (
            <div className="bg-white rounded-2xl p-3.5 border border-[#E7E5E4] shadow-xs text-xs space-y-1">
              <div className="flex items-center gap-2 font-extrabold text-[#1C1917]">
                <AlertCircle className="w-4 h-4 shrink-0 text-[#B91C1C]" />
                <span>
                  {order.complaint.status === 'resolvida'
                    ? 'Reclamação resolvida pela loja.'
                    : 'Reclamação aberta.'}
                </span>
              </div>
              <p className="text-[11px] text-[#57534E]">{order.complaint.text}</p>
              <p className="text-[10px] text-[#A8A29E] font-bold">
                Aberta em {formatShortDate(order.complaint.openedAt)}
                {order.complaint.status === 'aberta' && ' — continue a conversa pelo chat.'}
              </p>
            </div>
          )}

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

          {/* O chat continua acessível no pedido cancelado: é a hora em que mais se precisa falar. */}
          <div className="bg-white p-3.5 rounded-2xl border border-[#E7E5E4] flex items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#B91C1C] flex items-center justify-center text-white font-bold text-lg shadow-xs">
                {isCanceled ? '💬' : '🛵'}
              </div>
              <div>
                <div className="text-xs font-bold text-[#1C1917]">
                  {isCanceled
                    ? 'Fale com a loja'
                    : order.driverName || (order.status === 'pronto' ? 'Aguardando motoboy' : 'A definir')}
                </div>
                <div className="text-[10px] text-[#57534E]">
                  {isCanceled ? 'O chat deste pedido continua aberto' : 'Moto Boy Exclusivo da Loja'}
                </div>
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
              {!isCanceled && order.driverPhone && (
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

          {immediateCancelButton}

          {canRequestCancel && (
            <button
              onClick={() => setSheet('request')}
              disabled={isSubmitting}
              className="w-full py-3 rounded-2xl border border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#FEE2E2] transition disabled:opacity-50"
            >
              <Ban className="w-4 h-4" />
              <span>Pedir cancelamento</span>
            </button>
          )}

          {canComplain && (
            <button
              onClick={() => setSheet('complaint')}
              disabled={isSubmitting}
              className="w-full py-3 rounded-2xl border border-[#E7E5E4] bg-white text-[#57534E] text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#F5F5F4] transition disabled:opacity-50"
            >
              <AlertCircle className="w-4 h-4" />
              <span>Tive um problema com este pedido</span>
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
    {actionSheet}
    </>
  );
};
