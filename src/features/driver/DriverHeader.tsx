import React from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../../lib/auth';
import { useDriver } from './DriverStore';
import { Bike, LogOut } from 'lucide-react';

export const DriverHeader: React.FC = () => {
  const navigate = useNavigate();
  const { profile, presenceState, myDeliveries, availableOrders } = useDriver();

  const handleLogout = () => {
    logout('driver');
    navigate('/');
  };

  const activeCount = myDeliveries.length + availableOrders.length;
  const working = myDeliveries.length > 0;
  // Três cores para três estados. O amarelo é o que faltava: com o celular no
  // bolso o motoboy continua de turno, e pintar isso de cinza (Offline) fazia
  // ele achar que tinha caído do quadro e tocar o botão à toa.
  const dotClass =
    presenceState === 'online'
      ? 'bg-[#4ADE80]'
      : presenceState === 'reconnecting'
        ? 'bg-[#FACC15]'
        : 'bg-[#71717A]';
  const presenceLabel =
    presenceState === 'online' ? 'Online' : presenceState === 'reconnecting' ? 'Reconectando' : 'Offline';

  return (
    <header className="pt-safe sticky top-0 z-40 border-b border-[#27272A] bg-[#121214] text-white shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
      <div className="mx-auto flex max-w-[430px] items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#B91C1C] text-white shadow-md">
            <Bike className="h-5 w-5" strokeWidth={2.4} />
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-[#121214] ${dotClass}`}
              aria-hidden
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-extrabold leading-tight tracking-tight">
              {profile?.name || 'Entregador'}
            </p>
            <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-[#A1A1AA]">
              {working
                ? `Em corrida · ${myDeliveries[0]?.id || ''}`
                : activeCount > 0
                  ? `${activeCount} oferta${activeCount > 1 ? 's' : ''}`
                  : presenceLabel}
              {!working && profile?.plate ? ` · ${profile.plate}` : ''}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="tap-44 flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-bold text-white transition hover:bg-white/15 active:scale-95"
          title="Sair do app do entregador"
        >
          <LogOut className="h-4 w-4" />
          <span>Sair</span>
        </button>
      </div>
    </header>
  );
};
