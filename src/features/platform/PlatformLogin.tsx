import React, { useState } from 'react';
import { Building2, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { platformLogin, type PlatformAdmin } from './platformAuth';

export const PlatformLogin: React.FC<{ onLogin: (admin: PlatformAdmin) => void; hint?: string }> = ({
  onLogin,
  hint,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await platformLogin(email, password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onLogin(res.admin);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dscreen bg-[#F5F5F4] text-[#1C1917] font-sans antialiased flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-3xl border border-[#E7E5E4] shadow-xl p-8 text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-3xl shadow-md mx-auto mb-4 bg-[#1C1917]">
          <Building2 className="w-8 h-8" />
        </div>

        <h1 className="text-xl font-extrabold text-[#1C1917]">Painel da plataforma</h1>
        <p className="text-xs text-[#57534E] mt-1.5 mb-6">Entre com o e-mail e a senha de administrador.</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <label htmlFor="platform-email" className="sr-only">
              E-mail
            </label>
            <Mail className="w-4 h-4 text-[#57534E] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="platform-email"
              name="email"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="E-mail"
              className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl py-3 pl-10 pr-4 text-sm font-bold text-left text-[#1C1917] placeholder-[#A8A29E] placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#1C1917]"
            />
          </div>

          <div className="relative">
            <label htmlFor="platform-password" className="sr-only">
              Senha
            </label>
            <KeyRound className="w-4 h-4 text-[#57534E] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="platform-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Senha"
              className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl py-3 pl-10 pr-4 text-sm font-bold text-left text-[#1C1917] placeholder-[#A8A29E] placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#1C1917]"
            />
          </div>

          {error && (
            <p role="alert" className="text-[11px] text-[#B91C1C] font-bold bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl py-2 px-2">
              {error}
            </p>
          )}

          {!error && hint && (
            <p role="status" className="text-[11px] text-[#B45309] font-bold bg-[#FFFBEB] border border-[#FDE68A] rounded-xl py-2 px-2">
              {hint}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full bg-[#1C1917] hover:bg-[#292524] text-white font-extrabold py-3 rounded-full shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            <span>{loading ? 'Validando…' : 'Entrar'}</span>
          </button>
        </form>

        <p className="text-[10px] text-[#A8A29E] mt-5">Acesso restrito à equipe da plataforma.</p>
      </div>
    </div>
  );
};
