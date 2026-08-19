import React, { useEffect, useState } from 'react';
import { Check, CloudUpload, MapPin, Settings, Upload } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { PublicStoreSettings } from '../../types';
import { kitchenApi as api } from '../../lib/api';
import { ACCEPTED_IMAGE_TYPES, validateImageFile } from '../../lib/image';
import { useImageFramer } from '../../components/common/ImageFramer';
import { generateRandomPixKey, normalizePixKey, validatePixKey } from '../../shared/pix';
import { LiveMap } from '../../components/common/LiveMap';
import { useKitchenSettings } from './KitchenSettingsStore';
import { useKitchenToast } from './KitchenNotificationsStore';
import { useKitchenUpload } from './useKitchenUpload';
import type { KitchenTab } from './kitchenTabs';

type SettingsDraft = Pick<PublicStoreSettings, 'storeName' | 'city' | 'storeAddress' | 'storeLat' | 'storeLng' | 'pickupEnabled' | 'pickupReadyMinutes' | 'deliveryPricePerKm' | 'deliveryBaseFee' | 'deliveryMinFee' | 'freeDeliveryAbove' | 'maxDeliveryKm' | 'minOrderValue' | 'routeFactor' | 'driverFeePerDelivery' | 'pixKey' | 'pixMerchantName' | 'pixMerchantCity' | 'cardOnDeliveryEnabled' | 'storeWhatsApp' | 'orderSoundUrl' | 'openingHours' | 'orderEnabled' | 'forceOpen' | 'backupEnabled' | 'backupFrequencyDays' | 'backupFolderId'> & { kitchenPin: string; backupServiceAccount: string };

const makeDraft = (settings: PublicStoreSettings): SettingsDraft => ({
  storeName: settings.storeName,
  city: settings.city,
  storeAddress: settings.storeAddress,
  storeLat: settings.storeLat,
  storeLng: settings.storeLng,
  pickupEnabled: settings.pickupEnabled,
  pickupReadyMinutes: settings.pickupReadyMinutes,
  deliveryPricePerKm: settings.deliveryPricePerKm,
  deliveryBaseFee: settings.deliveryBaseFee,
  deliveryMinFee: settings.deliveryMinFee,
  freeDeliveryAbove: settings.freeDeliveryAbove,
  maxDeliveryKm: settings.maxDeliveryKm,
  minOrderValue: settings.minOrderValue,
  routeFactor: settings.routeFactor,
  driverFeePerDelivery: settings.driverFeePerDelivery,
  pixKey: settings.pixKey,
  pixMerchantName: settings.pixMerchantName,
  pixMerchantCity: settings.pixMerchantCity,
  cardOnDeliveryEnabled: settings.cardOnDeliveryEnabled !== false,
  storeWhatsApp: settings.storeWhatsApp,
  orderSoundUrl: settings.orderSoundUrl,
  openingHours: settings.openingHours.map((hour) => (hour ? { ...hour } : null)),
  orderEnabled: settings.orderEnabled,
  forceOpen: settings.forceOpen,
  backupEnabled: settings.backupEnabled,
  backupFrequencyDays: settings.backupFrequencyDays,
  backupFolderId: settings.backupFolderId,
  kitchenPin: '',
  backupServiceAccount: '',
});

export const KitchenStoreSettings: React.FC<{ activeTab: KitchenTab; setActiveTab: (tab: KitchenTab) => void }> = ({ activeTab, setActiveTab }) => {
  const { settings, saveSettings, storeLogo, setStoreLogo } = useKitchenSettings();
  const uploadImage = useKitchenUpload();
  const triggerToast = useKitchenToast();
  const [draft, setDraft] = useState<SettingsDraft>(() => makeDraft(settings));
  const [searchParams, setSearchParams] = useSearchParams();
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

  useEffect(() => setDraft((previous) => ({ ...makeDraft(settings), kitchenPin: previous.kitchenPin, backupServiceAccount: previous.backupServiceAccount })), [settings]);
  useEffect(() => {
    const result = searchParams.get('mp');
    if (!result) return;
    setActiveTab('config');
    triggerToast(result === 'ok' ? 'Mercado Pago conectado!' : searchParams.get('reason') || 'Falha ao conectar o Mercado Pago.');
    setSearchParams({}, { replace: true });
  }, [searchParams, setActiveTab, setSearchParams, triggerToast]);

  const setField = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => setDraft((previous) => ({ ...previous, [key]: value }));
  const save = async () => {
    const normalizedPix = normalizePixKey(draft.pixKey);
    // validatePixKey devolve a mensagem do erro (ou null quando está tudo certo):
    // negar o retorno invertia a checagem e travava o save com a chave válida.
    const pixProblem = normalizedPix ? validatePixKey(normalizedPix) : null;
    setPixError(pixProblem || '');
    if (pixProblem) {
      // Sem o toast o motivo fica só no painel do PIX, fora da tela: dá a
      // impressão de que o botão Salvar não faz nada.
      triggerToast(pixProblem);
      return;
    }
    const newPin = draft.kitchenPin.trim();
    if (newPin && newPin.length < 4) {
      setPinError('O PIN precisa ter pelo menos 4 caracteres.');
      triggerToast('O PIN da cozinha precisa ter pelo menos 4 caracteres.');
      return;
    }
    setPinError('');
    const { kitchenPin: _pin, backupServiceAccount: _key, ...settingsDraft } = draft;
    const ok = await saveSettings({
      ...settingsDraft,
      pixKey: normalizedPix,
      ...(newPin ? { kitchenPin: newPin } : {}),
      ...(draft.backupServiceAccount.trim() ? { backupServiceAccount: draft.backupServiceAccount.trim() } : {}),
    });
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
      await api.post('/mercadopago/token', { ...(mpToken.trim() ? { accessToken: mpToken.trim() } : {}), ...(mpPublicKey.trim() ? { publicKey: mpPublicKey.trim() } : {}) });
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
      setField('storeLat', result.lat);
      setField('storeLng', result.lng);
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

  if (activeTab !== 'config') return null;
  return <div className="space-y-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl bg-[#B91C1C] text-white flex items-center justify-center"><Settings className="w-5 h-5" /></div><div><h2 className="text-lg font-extrabold">Configurações</h2><p className="text-xs text-[#57534E]">Frete, pagamentos, horário e segurança.</p></div></div><button className="btn-primary" onClick={() => void save()}><Check className="w-4 h-4" />Salvar alterações</button></div><div className="grid grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))] gap-3 items-start"><Panel title="Loja"><LogoEditor logo={storeLogo} uploadImage={uploadImage} onSave={setStoreLogo} /><Field label="Nome da loja" value={draft.storeName} onChange={(value) => setField('storeName', value)} /><Field label="Cidade" value={draft.city} onChange={(value) => setField('city', value)} /><div className="grid grid-cols-2 gap-2"><Field label="Latitude" value={String(draft.storeLat)} onChange={(value) => setField('storeLat', Number(value))} type="number" /><Field label="Longitude" value={String(draft.storeLng)} onChange={(value) => setField('storeLng', Number(value))} type="number" /></div><div className="grid grid-cols-[1fr_auto] gap-2"><Field label="CEP" value={cep} onChange={setCep} /><button className="btn-secondary self-end" onClick={() => void lookupCep()} disabled={locating}>{locating ? '...' : 'Buscar'}</button></div><div className="grid grid-cols-[1fr_auto] gap-2"><Field label="Endereço da loja (aparece na retirada)" value={draft.storeAddress} onChange={(value) => setField('storeAddress', value)} /><button className="btn-secondary self-end" onClick={() => void locate(draft.storeAddress)} disabled={locating}><MapPin className="w-3.5 h-3.5" />Localizar</button></div>{locationLabel && <p className="text-[10px] text-emerald-700">{locationLabel}</p>}{locationError && <p className="text-[10px] text-red-700">{locationError}</p>}<LiveMap store={{ lat: draft.storeLat, lng: draft.storeLng, name: draft.storeName }} pickPosition={{ lat: draft.storeLat, lng: draft.storeLng }} onPick={(lat, lng) => { setField('storeLat', lat); setField('storeLng', lng); }} heightClass="h-48" /></Panel><Panel title="Frete e pedidos"><NumberGrid fields={[['Preço por km', 'deliveryPricePerKm'], ['Taxa base', 'deliveryBaseFee'], ['Taxa mínima', 'deliveryMinFee'], ['Frete grátis acima', 'freeDeliveryAbove'], ['Raio máximo (km)', 'maxDeliveryKm'], ['Pedido mínimo', 'minOrderValue'], ['Fator de rota', 'routeFactor'], ['Taxa do motoboy', 'driverFeePerDelivery']]} draft={draft} setField={setField} /><Toggle label="Aceitar pedidos" checked={draft.orderEnabled} onChange={(value) => setField('orderEnabled', value)} /><Toggle label="Aceitar retirada na loja" checked={draft.pickupEnabled} onChange={(value) => setField('pickupEnabled', value)} /><Field label="Minutos até ficar pronto para retirar" value={String(draft.pickupReadyMinutes)} onChange={(value) => setField('pickupReadyMinutes', Math.max(5, Number(value) || 0))} type="number" /><Toggle label="Forçar loja aberta" checked={draft.forceOpen} onChange={(value) => setField('forceOpen', value)} /></Panel><Panel title="PIX manual"><Field label="Chave PIX" value={draft.pixKey} onChange={(value) => setField('pixKey', value)} /><div className="grid grid-cols-2 gap-2"><Field label="Nome do recebedor" value={draft.pixMerchantName} onChange={(value) => setField('pixMerchantName', value)} /><Field label="Cidade" value={draft.pixMerchantCity} onChange={(value) => setField('pixMerchantCity', value)} /></div>{pixError && <p className="text-xs text-red-700">{pixError}</p>}<button className="btn-secondary mt-2" onClick={() => setField('pixKey', generateRandomPixKey())}>Gerar chave de teste</button></Panel><Panel title="Pagamento na entrega"><Toggle label="Levar maquininha de cartão" checked={draft.cardOnDeliveryEnabled} onChange={(value) => setField('cardOnDeliveryEnabled', value)} /><p className="text-[11px] text-[#57534E]">Ligado, o cliente pode escolher pagar no cartão na entrega ou na retirada. Desligado, só sobra cartão online, PIX e dinheiro.</p></Panel><Panel title="Horários"><div className="space-y-2">{draft.openingHours.map((hour, index) => <div key={index} className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center text-xs"><span>{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][index]}</span><input className="input" type="time" value={hour?.open || ''} onChange={(event) => setField('openingHours', draft.openingHours.map((item, itemIndex) => itemIndex === index ? { open: event.target.value, close: item?.close || '' } : item))} /><input className="input" type="time" value={hour?.close || ''} onChange={(event) => setField('openingHours', draft.openingHours.map((item, itemIndex) => itemIndex === index ? { open: item?.open || '', close: event.target.value } : item))} /></div>)}</div></Panel><Panel title="Mercado Pago"><p className="text-xs text-[#57534E] mb-3">{settings.mercadoPagoConnected ? 'Conectado — novos PIX passam pelo Mercado Pago.' : 'Desconectado — use PIX manual ou conecte sua conta.'}</p>{settings.mercadoPagoConnected ? <button className="btn-danger" onClick={() => void disconnectMp()} disabled={mpBusy}>Desconectar</button> : <button className="btn-primary" onClick={() => void connectMp()} disabled={mpBusy}>{mpBusy ? 'Abrindo...' : 'Conectar OAuth'}</button>}<div className="border-t border-[#F5F5F4] mt-3 pt-3 space-y-2"><Field label="Access Token (modo teste)" value={mpToken} onChange={setMpToken} type="password" /><Field label="Chave pública" value={mpPublicKey} onChange={setMpPublicKey} /><button className="btn-secondary" onClick={() => void saveMp()} disabled={mpBusy}>Salvar credenciais</button></div></Panel><Panel title="Backup e segurança"><Toggle label="Backup automático" checked={draft.backupEnabled} onChange={(value) => setField('backupEnabled', value)} /><Field label="Frequência (dias)" value={String(draft.backupFrequencyDays)} onChange={(value) => setField('backupFrequencyDays', Number(value) || 1)} type="number" /><Field label="Pasta do Google Drive" value={draft.backupFolderId} onChange={(value) => setField('backupFolderId', value)} /><Field label="Service account JSON" value={draft.backupServiceAccount} onChange={(value) => setField('backupServiceAccount', value)} type="password" /><Field label="Novo PIN da cozinha" value={draft.kitchenPin} onChange={(value) => setField('kitchenPin', value)} type="password" />{pinError && <p className="text-xs text-red-700">{pinError}</p>}<button className="btn-secondary" onClick={() => void runBackup()} disabled={backupRunning}><CloudUpload className="w-4 h-4" />{backupRunning ? 'Executando...' : 'Executar backup agora'}</button></Panel><Panel title="Contato e som"><Field label="WhatsApp da loja" value={draft.storeWhatsApp} onChange={(value) => setField('storeWhatsApp', value)} /><Field label="URL do áudio de novo pedido" value={draft.orderSoundUrl} onChange={(value) => setField('orderSoundUrl', value)} /><AudioUpload onUpload={async (dataUrl) => { const url = await uploadImage(dataUrl, 'som-pedido'); if (url) setField('orderSoundUrl', url); }} /></Panel></div></div>;
};

const Field: React.FC<{ label: string; value: string; onChange: (value: string) => void; type?: string }> = ({ label, value, onChange, type = 'text' }) => <label className="block text-xs font-bold"><span className="block text-[10px] text-[#57534E] mb-1">{label}</span><input className="input w-full" type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
const NumberGrid: React.FC<{ fields: [string, keyof SettingsDraft][]; draft: SettingsDraft; setField: <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => void }> = ({ fields, draft, setField }) => <div className="grid grid-cols-2 gap-2">{fields.map(([label, key]) => <Field key={key} label={label} type="number" value={String(draft[key])} onChange={(value) => setField(key, Number(value) || 0)} />)}</div>;
const Toggle: React.FC<{ label: string; checked: boolean; onChange: (value: boolean) => void }> = ({ label, checked, onChange }) => <label className="flex items-center gap-2 text-xs font-bold mt-2"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => <section className="bg-white rounded-2xl p-4 border border-[#E7E5E4] shadow-xs space-y-3"><h3 className="font-extrabold text-sm">{title}</h3>{children}</section>;
const LogoEditor: React.FC<{ logo: string; uploadImage: (dataUrl: string, filename?: string) => Promise<string | null>; onSave: (logo: string) => Promise<void> }> = ({ logo, uploadImage, onSave }) => { const { frameImage, framerNode } = useImageFramer(); return <div className="flex items-center gap-3"><div className="w-14 h-14 rounded-xl bg-[#F5F5F4] border border-[#E7E5E4] overflow-hidden flex items-center justify-center">{logo ? <img src={logo} alt="Logo" className="w-full h-full object-contain" /> : <span>🏪</span>}</div><label className="btn-secondary cursor-pointer"><Upload className="w-3.5 h-3.5" />Trocar logo<input type="file" accept={ACCEPTED_IMAGE_TYPES} className="hidden" onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file || validateImageFile(file)) return; const dataUrl = await frameImage(file, { aspect: 1, title: 'Enquadrar logo da loja' }); if (!dataUrl) return; const url = await uploadImage(dataUrl, 'logo'); if (url) await onSave(url); }} /></label>{framerNode}</div>; };
const AudioUpload: React.FC<{ onUpload: (dataUrl: string) => Promise<void> }> = ({ onUpload }) => <label className="btn-secondary cursor-pointer w-fit"><Upload className="w-3.5 h-3.5" />Enviar áudio<input type="file" accept="audio/*" className="hidden" onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; const reader = new FileReader(); reader.onload = () => { if (typeof reader.result === 'string') void onUpload(reader.result); }; reader.readAsDataURL(file); }} /></label>;
