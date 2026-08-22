import React, { useState } from 'react';
import { X } from 'lucide-react';

interface OrderActionSheetProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel: string;
  dismissLabel?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonRequired?: boolean;
  maxLength?: number;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/**
 * Confirmação dentro do app. O window.confirm nativo some ou trava dentro das
 * webviews do WhatsApp/Instagram, que é onde a maioria dos clientes abre a loja.
 */
export const OrderActionSheet: React.FC<OrderActionSheetProps> = ({
  icon,
  title,
  description,
  confirmLabel,
  busyLabel,
  dismissLabel = 'Voltar',
  reasonLabel,
  reasonPlaceholder,
  reasonRequired = false,
  maxLength = 200,
  busy = false,
  onConfirm,
  onClose,
}) => {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  const blocked = busy || (reasonRequired && trimmed.length < 3);

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-xs flex items-end justify-center">
      {/* `max-h`/`overflow-y` em `dvh`: com o teclado aberto para escrever o
          motivo, a folha passava da tela e o botão "Enviar" sumia embaixo, sem
          rolagem que o alcançasse. Agora ela rola por dentro. */}
      <div className="bg-white text-[#1C1917] w-full max-w-[430px] max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-3xl border border-[#E7E5E4] shadow-2xl p-6 pb-[calc(env(safe-area-inset-bottom)+24px)] relative animate-slide-up">
        {/* 36 px → 44 px sem tirar o X do lugar: top-3/right-3 + 44 px cai no
            mesmo ponto que top-4/right-4 + 36 px. */}
        <button
          onClick={onClose}
          disabled={busy}
          aria-label="Fechar"
          className="absolute top-3 right-3 min-h-11 min-w-11 flex items-center justify-center rounded-full hover:bg-[#F5F5F4] text-[#57534E] disabled:opacity-50"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-14 h-14 rounded-2xl bg-[#FEF2F2] flex items-center justify-center mb-4 text-[#B91C1C]">
          {icon}
        </div>

        <h3 className="text-xl font-extrabold text-[#1C1917] pr-8">{title}</h3>
        <p className="text-xs text-[#57534E] mt-1.5">{description}</p>

        {reasonLabel && (
          <div className="mt-4">
            <label className="text-[10px] font-extrabold text-[#57534E] uppercase tracking-wider">
              {reasonLabel}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={maxLength}
              placeholder={reasonPlaceholder}
              className="mt-1.5 w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-3 text-xs text-[#1C1917] placeholder-[#A8A29E] focus:outline-none focus:ring-1 focus:ring-[#B91C1C] resize-none"
            />
            {reasonRequired && trimmed.length < 3 && (
              <p className="text-[10px] text-[#A8A29E] font-semibold px-1">
                Escreva pelo menos algumas palavras para a loja entender.
              </p>
            )}
          </div>
        )}

        <button
          onClick={() => onConfirm(trimmed)}
          disabled={blocked}
          className="w-full mt-5 py-3.5 rounded-full bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold text-sm shadow-md transition disabled:opacity-50"
        >
          {busy ? busyLabel : confirmLabel}
        </button>
        <button
          onClick={onClose}
          disabled={busy}
          className="w-full mt-2 py-3 rounded-full text-[#57534E] font-bold text-xs hover:bg-[#F5F5F4] transition disabled:opacity-50"
        >
          {dismissLabel}
        </button>
      </div>
    </div>
  );
};
