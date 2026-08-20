import React from 'react';
import { DriverProvider } from './DriverStore';
import { DriverHeader } from './DriverHeader';
import { DriverView } from './DriverView';
import { LoginGate } from '../../components/LoginGate';
import { useRoleSession } from '../../lib/auth';
import { Bike } from 'lucide-react';

export const DriverApp: React.FC = () => {
  const { authenticated, expired, refresh } = useRoleSession('driver');

  if (!authenticated) {
    return (
      <LoginGate
        role="driver"
        title="App do Entregador"
        icon={<Bike className="w-8 h-8" />}
        accentClass="bg-[#121214]"
        onLogin={refresh}
        showNameField
        hint={
          expired
            ? 'Sua sessão expirou. Faça login novamente para continuar.'
            : 'Use seu nome e a senha criada no painel da cozinha.'
        }
      />
    );
  }

  return (
    <DriverProvider>
      <div className="flex min-h-screen justify-center bg-[#121214] font-sans text-[#1C1917] antialiased selection:bg-[#B91C1C] selection:text-white">
        <div className="flex min-h-screen w-full max-w-[430px] flex-col bg-[#F5F5F4] shadow-2xl shadow-black/40">
          <DriverHeader />
          <main className="flex-1 px-3 pb-8 pt-4">
            <DriverView />
          </main>
        </div>
      </div>
    </DriverProvider>
  );
};
