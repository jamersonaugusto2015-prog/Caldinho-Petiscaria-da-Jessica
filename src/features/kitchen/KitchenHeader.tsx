import React from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../../lib/auth';
import { useKitchen } from './KitchenStore';
import { announceNewOrder } from '../../lib/sound';
import { Sparkles, LogOut, Bell, BellOff } from 'lucide-react';

export const KitchenHeader: React.FC = () => {
  const navigate = useNavigate();
  const { settings, storeLogo, saveSettings, soundEnabled, toggleSound } = useKitchen();

  const handleToggleSound = () => {
    const turningOn = !soundEnabled;
    toggleSound();
    if (turningOn) announceNewOrder(); // teste da voz ao ligar
  };

  const handleLogout = () => {
    logout('kitchen');
    navigate('/');
  };

  const toggleStore = () => {
    const opening = !settings.orderEnabled;
    // Ao abrir, força a abertura (prioridade sobre o horário); ao fechar, volta ao normal
    saveSettings({ orderEnabled: opening, forceOpen: opening });
  };

  return (
    <header className="sticky top-0 z-40 bg-[#1C1917] text-white border-b border-[#292524] shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 select-none">
            {storeLogo ? (
              <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center overflow-hidden border border-[#292524]">
                <img src={storeLogo} alt="Logo da loja" className="w-full h-full object-contain p-1" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-2xl bg-[#B91C1C] flex items-center justify-center text-white font-extrabold text-xl shadow-md">
                🏪
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 leading-none">
                <span className="font-extrabold text-lg tracking-tight">{settings.storeName}</span>
                <button
                  onClick={toggleStore}
                  title={
                    settings.orderEnabled
                      ? 'Clique para fechar a loja'
                      : 'Clique para abrir a loja'
                  }
                  className={`hidden sm:flex items-center gap-1 border text-[10px] font-bold px-2.5 py-0.5 rounded-full transition active:scale-95 ${
                    settings.orderEnabled
                      ? 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0] hover:bg-[#D1FAE5]'
                      : 'bg-[#FEF2F2] text-[#FCA5A5] border-[#FCA5A5] hover:bg-[#FEE2E2]'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      settings.orderEnabled ? 'bg-[#059669] animate-ping' : 'bg-[#FCA5A5]'
                    }`}
                  />
                  {settings.orderEnabled
                    ? settings.isOpen
                      ? 'COZINHA ABERTA'
                      : 'ABERTA (fora do horário)'
                    : 'LOJA FECHADA'}
                </button>
              </div>
              <span className="text-[10px] uppercase tracking-wider text-[#A8A29E] font-extrabold flex items-center gap-1 mt-0.5">
                <Sparkles className="w-3 h-3 text-[#D97706]" />
                Modo Gestão da Loja
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleSound}
              title={soundEnabled ? 'Alerta sonoro ligado — clique para desligar' : 'Alerta sonoro desligado — clique para ligar e testar a voz'}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-bold transition border ${
                soundEnabled
                  ? 'bg-[#1C1917] text-[#FDE68A] border-[#44403C] hover:bg-[#292524]'
                  : 'bg-[#292524] text-[#A8A29E] border-[#44403C] hover:bg-[#1C1917]'
              }`}
            >
              {soundEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              <span className="hidden md:inline">{soundEnabled ? 'Som Ligado' : 'Som Desligado'}</span>
            </button>

            <button
              onClick={handleLogout}
              className="flex items-center gap-2 bg-[#B91C1C] hover:bg-[#991B1B] text-white px-4 py-2 rounded-full text-xs font-bold shadow-md transition"
              title="Sair do painel da cozinha"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
