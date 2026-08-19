import React from 'react';
import { useDriver } from './DriverStore';
import { LiveMap } from '../../components/common/LiveMap';
import { formatKm } from '../../shared/geo';
import {
  Bike,
  Power,
  DollarSign,
  MapPin,
  Phone,
  CheckCircle2,
  Navigation,
  Clock,
  ShieldAlert,
  ExternalLink,
  Flame,
  ShoppingBag,
} from 'lucide-react';

export const DriverView: React.FC = () => {
  const {
    profile,
    settings,
    isOnline,
    toggleOnline,
    myDeliveries,
    availableOrders,
    completedToday,
    cancelledDeliveries,
    dismissCancellation,
    earningsToday,
    feeForOrder,
    acceptAndStart,
    confirmDelivery,
    notificationToast,
    locationStatus,
    retryLocation,
  } = useDriver();

  const activeDeliveries = [...availableOrders, ...myDeliveries];
  const gpsDown = locationStatus === 'denied' || locationStatus === 'unavailable';

  return (
    <div className="space-y-6 pb-16">
      {notificationToast && (
        <div className="bg-[#7C3AED] text-white px-4 py-2.5 text-center text-xs font-bold flex items-center justify-center gap-2 rounded-2xl shadow-md animate-pulse">
          <Flame className="w-4 h-4 text-[#FDE68A]" />
          <span>{notificationToast}</span>
        </div>
      )}

      {gpsDown && (isOnline || myDeliveries.length > 0) && (
        <div className="bg-[#B91C1C] text-white px-4 py-3 rounded-2xl shadow-md flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <span>GPS desligado — o cliente não vê sua localização.</span>
          </div>
          <button
            onClick={retryLocation}
            className="bg-white text-[#B91C1C] px-3 py-1.5 rounded-full text-[11px] font-black shrink-0"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {cancelledDeliveries.length > 0 && (
        <div className="space-y-3">
          {cancelledDeliveries.map((ord) => (
            <div
              key={ord.id}
              className="bg-[#FEF2F2] border-2 border-[#B91C1C] rounded-2xl p-4 shadow-md flex items-start justify-between gap-3"
            >
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-6 h-6 text-[#B91C1C] shrink-0 mt-0.5" />
                <div>
                  <div className="font-extrabold text-[#B91C1C] text-sm">
                    Corrida cancelada — Pedido {ord.id}
                  </div>
                  <p className="text-xs text-[#7C2D12] mt-0.5">
                    {ord.cancellationReason || 'Motivo não informado'}
                  </p>
                  <p className="text-[11px] text-[#57534E] mt-1">
                    Não siga para o endereço. Se já estiver a caminho, volte para a loja.
                  </p>
                </div>
              </div>
              <button
                onClick={() => dismissCancellation(ord.id)}
                className="bg-white text-[#B91C1C] border border-[#FECACA] px-3 py-1.5 rounded-full text-[11px] font-black shrink-0"
              >
                OK, ciente
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-[#121214] border border-[#27272A] rounded-2xl p-6 text-white shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#B91C1C] flex items-center justify-center text-white text-2xl font-bold shadow-md">
            🛵
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-white">
                {profile?.name || 'Entregador'}
              </h2>
              {isOnline && (
                <span className="text-[10px] bg-[#059669] text-white font-bold px-2.5 py-0.5 rounded-full">
                  DISPONÍVEL
                </span>
              )}
            </div>
            <p className="text-xs text-[#A1A1AA]">
              {profile?.bikeModel || 'Motocicleta'} {profile?.plate ? `• ${profile.plate}` : ''}
            </p>
          </div>
        </div>

        <button
          onClick={toggleOnline}
          className={`flex items-center gap-2 px-5 py-3 rounded-full text-xs font-black shadow-md transition ${
            isOnline
              ? 'bg-[#059669] text-white hover:bg-[#047857]'
              : 'bg-[#B91C1C] text-white hover:bg-[#991B1B]'
          }`}
        >
          <Power className="w-4 h-4" />
          <span>{isOnline ? 'ONLINE • DISPONÍVEL' : 'OFFLINE'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-[#E7E5E4] flex items-center gap-3 shadow-xs">
          <div className="p-3 rounded-2xl bg-[#FEF2F2] text-[#B91C1C]">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-[#57534E] uppercase font-bold">Ganhos de Hoje</span>
            <div className="font-extrabold text-xl text-[#1C1917]">
              R$ {earningsToday.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-[#E7E5E4] flex items-center gap-3 shadow-xs">
          <div className="p-3 rounded-2xl bg-[#ECFDF5] text-[#059669]">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-[#57534E] uppercase font-bold">Entregas Hoje</span>
            <div className="font-extrabold text-xl text-[#1C1917]">{completedToday.length}</div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-[#E7E5E4] flex items-center gap-3 shadow-xs">
          <div className="p-3 rounded-2xl bg-[#FFFBEB] text-[#D97706]">
            <Bike className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-[#57534E] uppercase font-bold">Taxa por Entrega</span>
            <div className="font-extrabold text-xl text-[#D97706]">
              {settings && settings.driverFeePerDelivery > 0
                ? `R$ ${settings.driverFeePerDelivery.toFixed(2)}`
                : 'Taxa do pedido'}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-extrabold text-[#1C1917] flex items-center gap-2">
          <Navigation className="w-5 h-5 text-[#B91C1C]" />
          <span>Corridas</span>
        </h3>

        {!isOnline ? (
          <div className="bg-white rounded-2xl p-8 text-center text-[#57534E] border border-[#E7E5E4] shadow-xs">
            <ShieldAlert className="w-10 h-10 text-[#B91C1C] mx-auto mb-2" />
            <p className="text-base font-extrabold text-[#1C1917]">Você está Offline</p>
            <p className="text-xs">
              Fique online para receber chamados de entregas. O app usa o GPS do seu celular para o
              rastreamento em tempo real.
            </p>
          </div>
        ) : activeDeliveries.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center text-[#57534E] border border-[#E7E5E4] shadow-xs">
            <Clock className="w-10 h-10 text-[#D97706] mx-auto mb-2 animate-spin" />
            <p className="text-base font-extrabold text-[#1C1917]">Aguardando chamados...</p>
            <p className="text-xs">
              Assim que a cozinha marcar um pedido como pronto, ele aparecerá aqui para você aceitar a entrega!
            </p>
          </div>
        ) : (
          activeDeliveries.map((ord) => {
            const isMine = ord.driverId === profile?.id;
            const fee = feeForOrder(ord);
            const customerLat = ord.address.lat ?? settings?.storeLat;
            const customerLng = ord.address.lng ?? settings?.storeLng;
            const hasCustomerLocation = customerLat != null && customerLng != null;
            return (
              <div key={ord.id} className="bg-white border-2 border-[#121214] rounded-2xl p-5 shadow-md space-y-4">
                <div className="flex items-center justify-between border-b border-[#E7E5E4] pb-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-lg text-[#1C1917]">Pedido {ord.id}</span>
                      <span className="bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0] text-xs font-black px-2.5 py-0.5 rounded-full">
                        Taxa R$ {fee.toFixed(2)}
                      </span>
                      {isMine && (
                        <span className="bg-[#F5F3FF] text-[#7C3AED] border border-[#DDD6FE] text-[10px] font-black px-2 py-0.5 rounded-full">
                          SUA CORRIDA
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#57534E] mt-0.5">
                      Cliente: <strong>{ord.customerName}</strong> ({ord.customerPhone})
                    </p>
                  </div>

                  <a
                    href={`tel:${ord.customerPhone.replace(/\D/g, '')}`}
                    className="bg-[#F5F5F4] hover:bg-[#E7E5E4] text-[#1C1917] p-2.5 rounded-full text-xs font-bold flex items-center gap-1.5 border border-[#E7E5E4] transition"
                  >
                    <Phone className="w-4 h-4 text-[#B91C1C]" />
                    <span>Ligar</span>
                  </a>
                </div>

                {hasCustomerLocation ? (
                  <LiveMap
                    store={
                      settings
                        ? { lat: settings.storeLat, lng: settings.storeLng, name: settings.storeName }
                        : null
                    }
                    customer={{ lat: customerLat as number, lng: customerLng as number }}
                    driver={
                      ord.driverLat != null && ord.driverLng != null
                        ? { lat: ord.driverLat, lng: ord.driverLng, name: ord.driverName }
                        : null
                    }
                    heightClass="h-56"
                  />
                ) : (
                  <div className="h-56 rounded-2xl border border-[#E7E5E4] bg-[#F5F5F4] flex flex-col items-center justify-center gap-1.5 text-center text-[#57534E]">
                    <MapPin className="w-6 h-6 text-[#A8A29E]" />
                    <p className="text-xs font-bold">Sem localização do cliente</p>
                  </div>
                )}

                <div className="bg-[#F5F5F4] p-3.5 rounded-2xl border border-[#E7E5E4] flex items-start justify-between gap-3 text-xs">
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-[#B91C1C] shrink-0 mt-0.5" />
                    <div>
                      <div className="font-extrabold text-[#1C1917]">Endereço de Entrega:</div>
                      <div className="text-[#57534E]">
                        {ord.address.street}, {ord.address.number} - {ord.address.neighborhood} (
                        {ord.distanceKm > 0 ? formatKm(ord.distanceKm) : '—'} da loja)
                      </div>
                      {ord.address.complement && (
                        <div className="text-[#A8A29E] italic text-[11px]">{ord.address.complement}</div>
                      )}
                    </div>
                  </div>

                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(
                      `${ord.address.street}, ${ord.address.number}, ${ord.address.neighborhood}, ${ord.address.city}`
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-[#1C1917] hover:bg-[#292524] text-white px-3 py-2 rounded-full font-bold text-[11px] flex items-center gap-1 shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>GPS Maps</span>
                  </a>
                </div>

                <div className="bg-[#F5F5F4]/60 p-3 rounded-2xl border border-[#E7E5E4] space-y-1 text-xs text-[#57534E]">
                  <div className="font-extrabold text-[#1C1917] text-[11px] uppercase flex items-center gap-1.5">
                    <ShoppingBag className="w-3.5 h-3.5 text-[#B91C1C]" />
                    Itens da bolsa térmica:
                  </div>
                  {ord.items.map((it) => (
                    <div key={it.id} className="flex justify-between">
                      <span>
                        <strong>{it.quantity}x</strong> {it.product.name}
                      </span>
                      <span className="font-bold text-[#1C1917]">
                        {it.isFree ? 'GRÁTIS' : `R$ ${it.itemTotalPrice.toFixed(2)}`}
                      </span>
                    </div>
                  ))}
                  <div className="pt-1.5 text-xs text-[#059669] font-extrabold border-t border-[#E7E5E4]">
                    Pagamento: {ord.payment.method.toUpperCase()}{' '}
                    {ord.payment.isPaid ? '• PAGO' : '• PENDENTE'}
                    {ord.payment.changeForAmount
                      ? `(Trazer troco p/ R$ ${ord.payment.changeForAmount})`
                      : ''}
                  </div>
                </div>

                <div className="pt-2">
                  {!isMine && ord.status === 'pronto' && (
                    <button
                      onClick={() => acceptAndStart(ord.id)}
                      className="w-full bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-extrabold py-3.5 rounded-full shadow-md text-sm flex items-center justify-center gap-2 transition"
                    >
                      <Bike className="w-5 h-5" />
                      <span>Aceitar Entrega & Iniciar Rota</span>
                    </button>
                  )}

                  {isMine && ord.status === 'pronto' && (
                    <div className="text-center text-[11px] text-[#7C3AED] font-extrabold bg-[#F5F3FF] border border-[#DDD6FE] rounded-full py-2.5">
                      Dirija até a loja para retirar o pedido
                    </div>
                  )}

                  {isMine && ord.status === 'saiu_entrega' && (
                    <button
                      onClick={() => confirmDelivery(ord.id)}
                      className="w-full bg-[#059669] hover:bg-[#047857] text-white font-extrabold py-3.5 rounded-full shadow-md text-sm flex items-center justify-center gap-2 transition"
                    >
                      <CheckCircle2 className="w-5 h-5" />
                      <span>Confirmar Entrega ao Cliente (Receber R$ {fee.toFixed(2)})</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {completedToday.length > 0 && (
        <div className="bg-white rounded-2xl p-5 border border-[#E7E5E4] space-y-3 shadow-xs">
          <h3 className="text-base font-extrabold text-[#1C1917]">Histórico de Corridas de Hoje</h3>
          <div className="space-y-2">
            {completedToday.map((cd) => (
              <div
                key={cd.id}
                className="bg-[#F5F5F4] p-3 rounded-2xl border border-[#E7E5E4] flex items-center justify-between text-xs text-[#57534E]"
              >
                <div>
                  <span className="font-extrabold text-[#1C1917]">{cd.id}</span> • {cd.customerName} (
                  {cd.address.neighborhood})
                </div>
                <span className="font-extrabold text-[#059669]">+ R$ {feeForOrder(cd).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
