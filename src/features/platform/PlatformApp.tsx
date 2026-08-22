import React from 'react';
import { PlatformLogin } from './PlatformLogin';
import { PlatformHeader } from './PlatformHeader';
import { PlatformShopsPanel } from './PlatformShopsPanel';
import { usePlatformSession } from './platformAuth';

/**
 * O 4º app: o painel de quem é dono da plataforma, não de uma loja.
 *
 * Vive fora do domínio de qualquer loja — por isso a rota é `/admin`, e não
 * um papel dentro de `resolveTenant` — e por isso a sessão usa seu próprio
 * token (`platformAuth.ts`), separado do `x-role-token` da cozinha e do
 * entregador.
 */
export const PlatformApp: React.FC = () => {
  const { admin, authenticated, expired, setAdmin, logout } = usePlatformSession();

  if (!authenticated) {
    return <PlatformLogin onLogin={setAdmin} hint={expired ? 'Sua sessão expirou. Entre de novo.' : undefined} />;
  }

  return (
    <div className="min-h-dscreen bg-[#F5F5F4] font-sans text-[#1C1917] antialiased">
      <PlatformHeader admin={admin} onLogout={logout} />
      <PlatformShopsPanel />
    </div>
  );
};
