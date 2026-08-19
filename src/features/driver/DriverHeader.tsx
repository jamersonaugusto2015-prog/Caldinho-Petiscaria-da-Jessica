import React from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../../lib/auth';
import { useDriver } from './DriverStore';
import { LogOut } from 'lucide-react';

export const DriverHeader: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useDriver();

  const handleLogout = () => {
    logout('driver');
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 bg-[#121214] text-white border-b border-[#27272A] shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 select-none">
            <div className="w-10 h-10 rounded-2xl bg-[#B91C1C] flex items-center justify-center text-white font-extrabold text-xl shadow-md">
              🛵
            </div>
            <div>
              <div className="flex items-center gap-2 leading-none">
                <span className="font-extrabold text-lg tracking-tight">Entregador Caldinho Express</span>
                <span className="hidden sm:inline-block text-[10px] bg-[#B91C1C] text-white font-bold px-2.5 py-0.5 rounded-full">
                  {profile?.name || 'Entregador'}
                </span>
              </div>
              <span className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-extrabold mt-0.5 block">
                {profile ? (
                  <>{profile.bikeModel || 'Modo Entregador'} • {profile.plate || 'GPS • Recife'}</>
                ) : (
                  'Modo Entregador GPS • Recife'
                )}
              </span>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 bg-[#B91C1C] hover:bg-[#991B1B] text-white px-4 py-2 rounded-full text-xs font-bold shadow-md transition"
            title="Sair do app do entregador"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </div>
    </header>
  );
};