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
      <div className="min-h-screen bg-[#F5F5F4] text-[#1C1917] font-sans antialiased selection:bg-[#B91C1C] selection:text-white">
        <DriverHeader />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <DriverView />
        </main>
      </div>
    </DriverProvider>
  );
};
