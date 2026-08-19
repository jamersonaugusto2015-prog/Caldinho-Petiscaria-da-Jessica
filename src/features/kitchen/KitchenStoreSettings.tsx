import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bike, Check, Clock, RotateCcw, ShieldCheck, Store, Wallet, type LucideIcon } from 'lucide-react';
import { kitchenApi as api } from '../../lib/api';
import { normalizePixKey, validatePixKey } from '../../shared/pix';
import { useKitchenSettings } from './KitchenSettingsStore';
import { useKitchenToast } from './KitchenNotificationsStore';
import { useKitchenUpload } from './useKitchenUpload';
import { draftChanged, makeDraft, type SettingsDraft } from './kitchenSettingsDraft';
import { DeliverySection, HoursSection, PaymentsSection, StoreSection, SystemSection } from './KitchenSettingsSections';

type SectionId = 'loja' | 'entrega' | 'pagamentos' | 'horarios' | 'sistema';

/**
 * Oito painéis soltos em uma grade viravam uma parede de campos: para achar o
 * PIN era preciso varrer a tela inteira. Agora são cinco assuntos, um de cada
 * vez, e a barra de salvar só aparece quando existe algo para salvar.
 */
const SECTIONS: { id: SectionId; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'loja', label: 'Loja', hint: 'Nome, logo e endereço', icon: Store },
  { id: 'entrega', label: 'Pedidos e entrega', hint: 'Frete, retirada e limites', icon: Bike },
  { id: 'pagamentos', label: 'Pagamentos', hint: 'PIX, Mercado Pago e cartão', icon: Wallet },
  { id: 'horarios', label: 'Horários', hint: 'Abertura e fechamento', icon: Clock },
  { id: 'sistema', label: 'Sistema', hint: 'PIN, backup e som', icon: ShieldCheck },
];

export const KitchenStoreSettings: React.FC = () => {
  const { settings, saveSettings, storeLogo, setStoreLogo } = useKitchenSettings();
  const uploadImage = useKitchenUpload();
  const triggerToast = useKitchenToast();
  const [draft, setDraft] = useState<SettingsDraft>(() => makeDraft(settings));
  const [section, setSection] = useState<SectionId>('loja');
  const [saving, setSaving] = useState(false);
  const [mpBusy, setMpBusy] = useState(false);
  const [mpToken, setMpToken] = useState('');
  const [mpPublicKey, setMpPublicKey] = useState('');
  const [backupRunning, setBackupRunning] = useState(false);
  const [cep, setCep] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationLabel, setLocationLabel] = useState('');
  const [locationError, setLocationError] = useState('');
  const [pixError, setPixError] = useState('');
  const [pinError, setPinError] = useState('');

  const dirty = useMemo(() => draftChanged(draft, settings), [draft, settings]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // O servidor (ou o botão abrir/fechar do cabeçalho) pode mudar as configurações
  // enquanto a tela está aberta. Recarregar o rascunho só quando não há edição
  // pendente mantém tudo em dia sem apagar o que a pessoa acabou de digitar.
  useEffect(() => {
    if (!dirtyRef.current) setDraft(makeDraft(settings));
  }, [settings]);

  const setField = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const discard = () => {
    setDraft(makeDraft(settings));
    setPixError('');
    setPinError('');
  };

  const save = async () => {
    const normalizedPix = normalizePixKey(draft.pixKey);
    // validatePixKey devolve a mensagem do erro (ou null quando está tudo certo):
    // negar o retorno invertia a checagem e travava o save com a chave válida.
    const pixProblem = normalizedPix ? validatePixKey(normalizedPix) : null;
    setPixError(pixProblem || '');
    if (pixProblem) {
      // Erro em uma seção fechada é erro invisível: leva a tela até ele.
      setSection('pagamentos');
      triggerToast(pixProblem);
      return;
    }
    const newPin = draft.kitchenPin.trim();
    if (newPin && newPin.length < 4) {
      setPinError('O PIN precisa ter pelo menos 4 caracteres.');
      setSection('sistema');
      triggerToast('O PIN da cozinha precisa ter pelo menos 4 caracteres.');
      return;
    }
    setPinError('');
    const { kitchenPin: _pin, backupServiceAccount: _key, ...settingsDraft } = draft;
    setSaving(true);
    const ok = await saveSettings({
      ...settingsDraft,
      pixKey: normalizedPix,
      ...(newPin ? { kitchenPin: newPin } : {}),
      ...(draft.backupServiceAccount.trim() ? { backupServiceAccount: draft.backupServiceAccount.trim() } : {}),
    });
    setSaving(false);
    // Limpa os campos de segredo só quando o servidor confirma que gravou.
    if (ok) setDraft((previous) => ({ ...previous, kitchenPin: '', backupServiceAccount: '' }));
  };

  const runBackup = async () => {
    setBackupRunning(true);
    try {
      await api.post('/backup/run');
      triggerToast('Backup concluído com sucesso!');
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Erro ao executar backup.');
    } finally {
      setBackupRunning(false);
    }
  };

  const connectMp = async () => {
    setMpBusy(true);
    try {
      const result = await api.get<{ url: string }>('/mercadopago/connect');
      window.location.href = result.url;
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Não foi possível conectar o Mercado Pago.');
      setMpBusy(false);
    }
  };

  const saveMp = async () => {
    setMpBusy(true);
    try {
      await api.post('/mercadopago/token', {
        ...(mpToken.trim() ? { accessToken: mpToken.trim() } : {}),
        ...(mpPublicKey.trim() ? { publicKey: mpPublicKey.trim() } : {}),
      });
      triggerToast('Credenciais do Mercado Pago salvas.');
      setMpToken('');
      setMpPublicKey('');
      window.location.reload();
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Não foi possível salvar as credenciais.');
      setMpBusy(false);
    }
  };

  const disconnectMp = async () => {
    if (!window.confirm('Desconectar o Mercado Pago?')) return;
    setMpBusy(true);
    try {
      await api.post('/mercadopago/disconnect');
      triggerToast('Mercado Pago desconectado.');
      window.location.reload();
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'Erro ao desconectar.');
      setMpBusy(false);
    }
  };

  const locate = async (query: string) => {
    if (!query.trim()) {
      setLocationError('Informe um endereço.');
      return;
    }
    setLocating(true);
    setLocationError('');
    try {
      const result = await api.post<{ lat: number; lng: number; label: string }>('/geocode', { query });
      setDraft((previous) => ({ ...previous, storeLat: result.lat, storeLng: result.lng }));
      setLocationLabel(result.label);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'Endereço não encontrado.');
    } finally {
      setLocating(false);
    }
  };

  const lookupCep = async () => {
    const clean = cep.replace(/\D/g, '');
    if (clean.length !== 8) {
      setLocationError('Informe um CEP válido com 8 dígitos.');
      return;
    }
    try {
      const result = await api.get<{ street: string; neighborhood: string; city: string }>(`/cep/${clean}`);
      const line = [result.street, result.neighborhood, result.city].filter(Boolean).join(', ');
      setField('storeAddress', line);
      await locate(line);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'CEP não encontrado.');
    }
  };

  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="grid items-start gap-5 lg:grid-cols-[236px_minmax(0,1fr)]">
        {/* Celular: trilha de pílulas grudada abaixo do cabeçalho. */}
        <nav
          aria-label="Seções das configurações"
          className="no-scrollbar sticky top-[68px] z-10 -mx-4 flex gap-2 overflow-x-auto bg-[#F5F5F4]/95 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:hidden"
        >
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              aria-current={section === item.id ? 'page' : undefined}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-bold transition-colors ${
                section === item.id
                  ? 'border-[#B91C1C] bg-[#B91C1C] text-white'
                  : 'border-[#E7E5E4] bg-white text-[#57534E] hover:bg-[#F5F5F4]'
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>

        {/* Desktop: lista fixa, com a explicação de cada assunto à vista. */}
        <aside className="sticky top-[84px] hidden lg:block">
          <div className="space-y-1 rounded-2xl border border-[#E7E5E4] bg-white p-2 shadow-xs">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                aria-current={section === item.id ? 'page' : undefined}
                className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  section === item.id ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'text-[#57534E] hover:bg-[#FAFAF9]'
                }`}
              >
                <item.icon className={`mt-0.5 h-4 w-4 shrink-0 ${section === item.id ? 'text-[#B91C1C]' : 'text-[#A8A29E]'}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{item.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-[#A8A29E]">{item.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="min-w-0">
          <div className="mb-4 hidden lg:block">
            <h2 className="text-lg font-extrabold tracking-tight text-[#1C1917]">{current.label}</h2>
            <p className="text-xs text-[#78716C]">{current.hint}</p>
          </div>

          <div className="space-y-4">
            {section === 'loja' && (
              <StoreSection
                draft={draft}
                setField={setField}
                storeLogo={storeLogo}
                setStoreLogo={setStoreLogo}
                uploadImage={uploadImage}
                cep={cep}
                setCep={setCep}
                lookupCep={() => void lookupCep()}
                locate={(query) => void locate(query)}
                locating={locating}
                locationLabel={locationLabel}
                locationError={locationError}
              />
            )}
            {section === 'entrega' && <DeliverySection draft={draft} setField={setField} />}
            {section === 'pagamentos' && (
              <PaymentsSection
                draft={draft}
                setField={setField}
                settings={settings}
                pixError={pixError}
                mpBusy={mpBusy}
                mpToken={mpToken}
                setMpToken={setMpToken}
                mpPublicKey={mpPublicKey}
                setMpPublicKey={setMpPublicKey}
                connectMp={() => void connectMp()}
                saveMp={() => void saveMp()}
                disconnectMp={() => void disconnectMp()}
              />
            )}
            {section === 'horarios' && <HoursSection draft={draft} setField={setField} />}
            {section === 'sistema' && (
              <SystemSection
                draft={draft}
                setField={setField}
                settings={settings}
                pinError={pinError}
                runBackup={() => void runBackup()}
                backupRunning={backupRunning}
                uploadImage={uploadImage}
              />
            )}
          </div>

          {/* Barra de salvar: acompanha a rolagem, então nunca some da tela. */}
          <div className="sticky bottom-3 z-10 mt-4">
            <div
              className={`flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2.5 backdrop-blur-md sm:gap-3 sm:px-4 ${
                dirty ? 'border-[#FCA5A5] bg-white/95 shadow-lg' : 'border-[#E7E5E4] bg-white/90 shadow-xs'
              }`}
            >
              <p className={`w-full text-xs font-bold sm:w-auto sm:flex-1 ${dirty ? 'text-[#B91C1C]' : 'text-[#78716C]'}`}>
                {dirty ? 'Você tem alterações não salvas.' : 'Tudo salvo.'}
              </p>
              <button type="button" className="btn-secondary flex-1 sm:flex-none" onClick={discard} disabled={!dirty || saving}>
                <RotateCcw className="h-3.5 w-3.5" />
                Descartar
              </button>
              <button type="button" className="btn-primary flex-1 sm:flex-none" onClick={() => void save()} disabled={!dirty || saving}>
                <Check className="h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
