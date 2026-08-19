import React from 'react';
import { useClientShell } from './ClientStore';
import { Clock, X } from 'lucide-react';
import { OpeningHour } from '../../types';

const WEEKDAY_NAMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

export const ClosedStoreModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { settings } = useClientShell();
  const today = new Date().getDay();

  const fmt = (hours: OpeningHour | null) =>
    hours ? `${hours.open} às ${hours.close}` : 'Fechado';

  return (
    <div className="fixed inset-0 z-[75] bg-black/60 backdrop-blur-xs flex items-end justify-center">
      <div className="bg-white text-[#1C1917] w-full max-w-[430px] rounded-t-3xl border border-[#E7E5E4] shadow-2xl p-6 relative animate-slide-up">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-[#F5F5F4] text-[#57534E]"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-14 h-14 rounded-2xl bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center mb-4">
          <Clock className="w-7 h-7" />
        </div>

        <h3 className="text-xl font-extrabold text-[#1C1917]">
          {settings.storeName} está fechado no momento
        </h3>
        <p className="text-xs text-[#57534E] mt-1.5">
          Não é possível fazer pedidos agora. Confira nossos dias e horários de funcionamento:
        </p>

        <div className="mt-4 bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-3.5 space-y-1">
          {WEEKDAY_NAMES.map((dayName, day) => {
            const hours = settings.openingHours[day] || null;
            const isToday = day === today;
            return (
              <div
                key={day}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs ${
                  isToday
                    ? 'bg-white border border-[#B91C1C]/30 font-extrabold text-[#B91C1C]'
                    : 'text-[#57534E]'
                }`}
              >
                <span className="font-bold">
                  {dayName}
                  {isToday && <span className="ml-1 text-[9px] uppercase">(hoje)</span>}
                </span>
                <span className={`font-bold ${!hours ? 'text-[#A8A29E]' : ''}`}>{fmt(hours)}</span>
              </div>
            );
          })}
        </div>

        <button
          onClick={onClose}
          className="w-full mt-5 py-3.5 rounded-full bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold text-sm shadow-md transition"
        >
          Entendi
        </button>
      </div>
    </div>
  );
};
