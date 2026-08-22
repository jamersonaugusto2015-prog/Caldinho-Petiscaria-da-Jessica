import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Brand, BRAND_FACE, detectBrand, formatExpiry, formatNumber, onlyDigits } from '../../../contract/payment/cardBrand';
import { toApiAmount } from '../../../contract/pricing/money';
export type CardPayload = {
  token: string;
  paymentMethodId: string;
  installments: number;
  issuerId?: string;
  email: string;
  identificationType: string;
  identificationNumber: string;
};

type Props = {
  publicKey: string;
  amount: number;
};

type IdType = { id: string; name: string };
type Field = 'number' | 'expiry' | 'cvv' | 'name' | null;

export type CardPaymentHandle = {
  tokenize: () => Promise<CardPayload>;
};

function loadMpSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if ((window as unknown as { MercadoPago?: unknown }).MercadoPago) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mp-sdk]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('sdk')));
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://sdk.mercadopago.com/js/v2';
    s.async = true;
    s.setAttribute('data-mp-sdk', '1');
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha ao carregar o Mercado Pago.'));
    document.head.appendChild(s);
  });
}

function BrandMark({ brand, color }: { brand: Brand; color: string }) {
  if (brand === 'master') {
    return (
      <span className="flex items-center" aria-hidden>
        <span className="w-6 h-6 rounded-full bg-[#EB001B] opacity-95" />
        <span className="w-6 h-6 rounded-full bg-[#F79E1B] -ml-2.5 opacity-95" />
      </span>
    );
  }
  return (
    <span className="text-[13px] font-black tracking-[0.18em] uppercase" style={{ color }}>
      {BRAND_FACE[brand].label}
    </span>
  );
}

const fieldClass =
  'w-full h-11 bg-white border border-[#E7E5E4] rounded-xl px-3 text-sm text-[#1C1917] font-semibold tabular-nums focus:outline-none focus:border-[#B91C1C] focus:ring-2 focus:ring-[#B91C1C]/20';

export const CardPaymentForm = forwardRef<CardPaymentHandle, Props>(({ publicKey, amount }, ref) => {
  const mpRef = useRef<any>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [holder, setHolder] = useState('');
  const [email, setEmail] = useState('');
  const [docType, setDocType] = useState('CPF');
  const [docNumber, setDocNumber] = useState('');
  const [idTypes, setIdTypes] = useState<IdType[]>([{ id: 'CPF', name: 'CPF' }]);
  const [installments, setInstallments] = useState<{ value: number; label: string }[]>([
    { value: 1, label: '1x sem juros' },
  ]);
  const [installment, setInstallment] = useState(1);
  const [paymentMethodId, setPaymentMethodId] = useState('visa');
  const [issuerId, setIssuerId] = useState('');
  const [focus, setFocus] = useState<Field>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const digits = onlyDigits(number);
  const brand = detectBrand(digits);
  const face = BRAND_FACE[brand];
  const amex = brand === 'amex';
  const maxLen = amex ? 15 : 16;
  const cvvLen = amex ? 4 : 3;
  const flipped = focus === 'cvv';
  const groups = formatNumber(digits.padEnd(maxLen, '•'), brand).split(' ');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadMpSdk();
        if (cancelled) return;
        const MP = (window as unknown as { MercadoPago: new (k: string, o?: object) => any }).MercadoPago;
        const mp = new MP(publicKey, { locale: 'pt-BR' });
        mpRef.current = mp;
        try {
          const types = (await mp.getIdentificationTypes()) as IdType[];
          if (Array.isArray(types) && types.length) {
            setIdTypes(types);
            setDocType(types[0].id);
          }
        } catch {
          /* CPF padrão */
        }
        setReady(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Não foi possível abrir o formulário de cartão.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  useEffect(() => {
    const bin = digits.slice(0, 6);
    if (bin.length < 6 || !mpRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const mp = mpRef.current;
        const methods = await mp.getPaymentMethods({ bin });
        if (cancelled) return;
        const method = methods?.results?.[0] || methods?.[0];
        if (method?.id) setPaymentMethodId(method.id);
        if (method?.issuer?.id) setIssuerId(String(method.issuer.id));
        const plans = await mp.getInstallments({
          // O SDK do Mercado Pago espera o valor como texto com PONTO decimal.
          // Não é texto de tela: `formatMoney` escreveria "R$ 25,50" e o SDK
          // não entenderia. `toApiAmount` garante as duas casas antes.
          amount: toApiAmount(amount).toFixed(2),
          bin,
          paymentTypeId: 'credit_card',
        });
        if (cancelled) return;
        const payerCosts = plans?.[0]?.payer_costs || [];
        if (payerCosts.length) {
          setInstallments(
            payerCosts.map((p: { installments: number; recommended_message?: string }) => ({
              value: p.installments,
              label: p.recommended_message || `${p.installments}x`,
            }))
          );
          setInstallment(payerCosts[0].installments);
        }
      } catch {
        setPaymentMethodId(brand === 'master' ? 'master' : brand === 'unknown' ? 'visa' : brand);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [digits.slice(0, 6), amount, brand]);

  useImperativeHandle(ref, () => ({
    tokenize: async () => {
      if (!mpRef.current) throw new Error('Formulário de cartão ainda não carregou.');
      if (digits.length < (amex ? 15 : 16)) throw new Error('Informe o número completo do cartão.');
      if (onlyDigits(expiry).length !== 4) throw new Error('Informe a validade (MM/AA).');
      if (cvv.length < cvvLen) throw new Error('Informe o CVV.');
      if (holder.trim().length < 3) throw new Error('Informe o nome impresso no cartão.');
      if (!email.includes('@')) throw new Error('Informe um e-mail válido para o cartão.');
      const cpf = onlyDigits(docNumber);
      if (cpf.length < 11) throw new Error('Informe o CPF do titular.');
      const mm = onlyDigits(expiry).slice(0, 2);
      const yy = onlyDigits(expiry).slice(2, 4);
      const month = Number(mm);
      if (month < 1 || month > 12) throw new Error('Mês da validade inválido.');
      const token = await mpRef.current.createCardToken({
        cardNumber: digits,
        cardholderName: holder.trim(),
        cardExpirationMonth: mm,
        cardExpirationYear: `20${yy}`,
        securityCode: cvv,
        identificationType: docType,
        identificationNumber: cpf,
      });
      const id = token?.id || token?.token;
      if (!id) {
        const msg = token?.cause?.[0]?.description || token?.message;
        throw new Error(msg || 'Não foi possível validar o cartão. Confira os dados.');
      }
      return {
        token: String(id),
        paymentMethodId,
        installments: installment,
        issuerId: issuerId || undefined,
        email: email.trim(),
        identificationType: docType,
        identificationNumber: cpf,
      };
    },
  }));

  const onTilt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = sceneRef.current?.getBoundingClientRect();
    if (!box) return;
    const px = (e.clientX - box.left) / box.width - 0.5;
    const py = (e.clientY - box.top) / box.height - 0.5;
    setTilt({ x: py * -10, y: px * 14 });
  };

  const displayName = holder.trim() ? holder.trim().toUpperCase() : 'SEU NOME';
  const displayExp = expiry.length ? expiry : 'MM/AA';

  return (
    <div className="space-y-4">
      <div
        ref={sceneRef}
        className="pay-card-scene mx-auto w-full max-w-[340px]"
        onMouseMove={onTilt}
        onMouseLeave={() => setTilt({ x: 0, y: 0 })}
      >
        <div
          className="pay-card-tilt"
          style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}
        >
          <div className={`pay-card-flip ${flipped ? 'is-back' : ''}`}>
            <div
              className="pay-card-face rounded-2xl overflow-hidden px-5 py-4 min-h-[198px] flex flex-col justify-between"
              style={{
                background: face.bg,
                color: face.ink,
                boxShadow: '0 18px 40px -24px rgba(28,25,23,0.55)',
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="block w-10 h-7 rounded-md"
                    style={{ background: '#C4A574' }}
                    aria-hidden
                  />
                  <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: face.muted }}>
                    chip
                  </span>
                </div>
                <BrandMark brand={brand} color={face.ink} />
              </div>

              <p
                className={`font-mono text-[19px] tracking-[0.14em] leading-none tabular-nums ${
                  focus === 'number' ? 'opacity-100' : 'opacity-90'
                }`}
                style={{ color: face.ink }}
              >
                {groups.map((g, gi) => (
                  <span key={gi} className="mr-2 last:mr-0">
                    {g.split('').map((ch, i) =>
                      ch === '•' ? (
                        <span key={i} className="opacity-35">
                          •
                        </span>
                      ) : (
                        <span key={`${gi}-${i}-${ch}`} className="pay-card-digit">
                          {ch}
                        </span>
                      )
                    )}
                  </span>
                ))}
              </p>

              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] uppercase tracking-[0.16em]" style={{ color: face.muted }}>
                    Titular
                  </p>
                  <p
                    className={`text-[12px] font-bold truncate ${focus === 'name' ? '' : 'opacity-90'}`}
                    style={{ color: holder.trim() ? face.ink : face.muted }}
                  >
                    {displayName}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[9px] uppercase tracking-[0.16em]" style={{ color: face.muted }}>
                    Validade
                  </p>
                  <p
                    className="text-[12px] font-bold tabular-nums"
                    style={{ color: expiry ? face.ink : face.muted }}
                  >
                    {displayExp}
                  </p>
                </div>
              </div>
            </div>

            <div
              className="pay-card-face is-back rounded-2xl overflow-hidden min-h-[198px]"
              style={{ background: face.bg, color: face.ink }}
            >
              <div className="h-10 mt-5" style={{ background: '#1C1917' }} />
              <div className="px-5 mt-6">
                <p className="text-[9px] uppercase tracking-[0.16em] mb-1.5" style={{ color: face.muted }}>
                  Código de segurança
                </p>
                <div className="h-9 rounded-md flex items-center justify-end px-3" style={{ background: '#F5F0E8' }}>
                  <span className="font-mono text-sm font-bold tracking-[0.28em] text-[#1C1917] tabular-nums">
                    {cvv.padEnd(cvvLen, '•')}
                  </span>
                </div>
                <p className="text-[10px] mt-3 leading-snug" style={{ color: face.muted }}>
                  O código fica no verso. Ninguém da loja vê esses números.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2.5">
        {error && <p className="text-[11px] text-[#B91C1C] font-bold">{error}</p>}

        <div>
          <label className="block text-[10px] font-bold text-[#57534E] mb-1">Número do cartão</label>
          <input
            value={formatNumber(digits, brand)}
            onChange={(e) => setNumber(onlyDigits(e.target.value).slice(0, maxLen))}
            onFocus={() => setFocus('number')}
            onBlur={() => setFocus(null)}
            inputMode="numeric"
            autoComplete="cc-number"
            className={fieldClass}
            aria-label="Número do cartão"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-bold text-[#57534E] mb-1">Validade</label>
            <input
              value={expiry}
              onChange={(e) => setExpiry(formatExpiry(onlyDigits(e.target.value).slice(0, 4)))}
              onFocus={() => setFocus('expiry')}
              onBlur={() => setFocus(null)}
              inputMode="numeric"
              autoComplete="cc-exp"
              className={fieldClass}
              aria-label="Validade"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[#57534E] mb-1">CVV</label>
            <input
              value={cvv}
              onChange={(e) => setCvv(onlyDigits(e.target.value).slice(0, cvvLen))}
              onFocus={() => setFocus('cvv')}
              onBlur={() => setFocus(null)}
              inputMode="numeric"
              autoComplete="cc-csc"
              className={fieldClass}
              aria-label="CVV"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-[#57534E] mb-1">Nome impresso</label>
          <input
            value={holder}
            onChange={(e) => setHolder(e.target.value.slice(0, 26))}
            onFocus={() => setFocus('name')}
            onBlur={() => setFocus(null)}
            autoComplete="cc-name"
            className={fieldClass}
            aria-label="Nome impresso no cartão"
          />
        </div>

        <div className="grid grid-cols-[88px_1fr] gap-2">
          <div>
            <label className="block text-[10px] font-bold text-[#57534E] mb-1">Doc</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className={fieldClass}
            >
              {idTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[#57534E] mb-1">CPF do titular</label>
            <input
              value={docNumber}
              onChange={(e) => setDocNumber(onlyDigits(e.target.value).slice(0, 14))}
              inputMode="numeric"
              className={fieldClass}
              aria-label="CPF do titular"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-[#57534E] mb-1">E-mail do titular</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className={fieldClass}
            aria-label="E-mail do titular"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-[#57534E] mb-1">Parcelas</label>
          <select
            value={installment}
            onChange={(e) => setInstallment(Number(e.target.value))}
            className={fieldClass}
          >
            {installments.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {!ready && !error && <p className="text-[10px] text-[#57534E]">Preparando pagamento seguro…</p>}
      </div>
    </div>
  );
});

CardPaymentForm.displayName = 'CardPaymentForm';
