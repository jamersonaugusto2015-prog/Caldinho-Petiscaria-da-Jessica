import React from 'react';
import { Building2, LogOut } from 'lucide-react';
import type { PlatformAdmin } from './platformAuth';

export const PlatformHeader: React.FC<{ admin: PlatformAdmin | null; onLogout: () => void }> = ({
  admin,
  onLogout,
}) => (
  <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[#E7E5E4] bg-white px-4 py-3 sm:px-6 lg:px-8">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1C1917] text-white">
      <Building2 className="h-[19px] w-[19px]" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-extrabold leading-tight text-[#1C1917]">Painel da plataforma</div>
      <div className="truncate text-[11px] font-bold text-[#78716C]">{admin?.email || 'Administrador'}</div>
    </div>
    <button
      type="button"
      onClick={onLogout}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#E7E5E4] px-3.5 py-2 text-xs font-bold text-[#57534E] transition hover:bg-[#F5F5F4] hover:text-[#B91C1C]"
    >
      <LogOut className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Sair</span>
    </button>
  </header>
);
