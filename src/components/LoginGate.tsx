import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { login } from '../lib/auth';
import { ShieldCheck, KeyRound, ArrowLeft, UserRound } from 'lucide-react';

interface LoginGateProps {
  role: 'kitchen' | 'driver';
  title: string;
  icon: React.ReactNode;
  accentClass: string;
  onLogin?: () => void;
  showNameField?: boolean;
  hint?: string;
}

export const LoginGate: React.FC<LoginGateProps> = ({
  role,
  title,
  icon,
  accentClass,
  onLogin,
  showNameField,
  hint,
}) => {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(role, pin, showNameField ? name : undefined);
      if (!res.ok) {
        setError(res.error || (showNameField ? 'Nome ou senha incorretos.' : 'PIN incorreto.'));
        return;
      }
      onLogin?.();
    } catch {
      // login() já trata erros de rede internamente, mas isto evita um
      // botão travado em "Validando..." para sempre caso isso mude.
      setError('Não foi possível entrar. Verifique sua internet e tente de novo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    /* O inset lateral entra por lado, com piso de 1rem, em vez de `px-safe`:
       `px-safe` fica fora das camadas do Tailwind e zerava o `p-4` deste mesmo
       elemento — no celular estreito o cartão de login encostava nas duas
       bordas da tela. */
    <div className="min-h-dscreen bg-[#F5F5F4] text-[#1C1917] font-sans antialiased flex flex-col items-center justify-center p-4 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]">
      {/* O link vivia a 20 px do topo — no app instalado isso é debaixo do
          relógio do iPhone, que desenha sobre a página. Agora ele desce o inset
          da barra de status e nunca sobe menos que os 20 px do desenho. */}
      <Link
        to="/"
        className="absolute top-[calc(env(safe-area-inset-top,0px)+1.25rem)] left-[calc(env(safe-area-inset-left,0px)+1.25rem)] flex items-center gap-1.5 text-xs font-bold text-[#57534E] hover:text-[#B91C1C] transition"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Voltar ao cardápio</span>
      </Link>

      <div className="bg-white w-full max-w-sm rounded-3xl border border-[#E7E5E4] shadow-xl p-8 text-center">
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white text-3xl shadow-md mx-auto mb-4 ${accentClass}`}>
          {icon}
        </div>

        <h1 className="text-xl font-extrabold text-[#1C1917]">{title}</h1>
        <p className="text-xs text-[#57534E] mt-1.5 mb-6">
          {showNameField
            ? 'Digite seu nome e a senha de acesso.'
            : 'Digite a senha de acesso.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          {showNameField && (
            <div className="relative">
              <label htmlFor="login-name" className="sr-only">
                Seu nome completo
              </label>
              <UserRound className="w-4 h-4 text-[#57534E] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="login-name"
                name="username"
                type="text"
                autoComplete="username"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome completo"
                className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl py-3 pl-10 pr-4 text-sm font-bold text-left text-[#1C1917] placeholder-[#A8A29E] placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#B91C1C]"
              />
            </div>
          )}

          <div className="relative">
            <label htmlFor="login-pin" className="sr-only">
              Senha (PIN)
            </label>
            <KeyRound className="w-4 h-4 text-[#57534E] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="login-pin"
              name="password"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              autoFocus={!showNameField}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Senha (PIN)"
              className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl py-3 pl-10 pr-4 text-sm font-bold text-center tracking-[0.5em] text-[#1C1917] placeholder-[#A8A29E] placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-[#B91C1C]"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="text-[11px] text-[#B91C1C] font-bold bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl py-2"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !pin || (showNameField && !name.trim())}
            className="w-full bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold py-3 rounded-full shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            <span>{loading ? 'Validando…' : 'Entrar'}</span>
          </button>
        </form>

        <p className="text-[10px] text-[#A8A29E] mt-5">
          {hint || 'Use a senha cadastrada no painel da cozinha.'}
        </p>
      </div>
    </div>
  );
};