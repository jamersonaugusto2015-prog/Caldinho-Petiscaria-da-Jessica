import React, { Suspense, lazy } from 'react';
import {
  Copy,
  CloudUpload,
  KeyRound,
  MapPin,
  Play,
  Search,
  Upload,
} from 'lucide-react';
import type { OpeningHour, PixProvider, PublicStoreSettings } from '../../types';
import { ACCEPTED_IMAGE_TYPES, validateImageFile } from '../../lib/image';
import { useImageFramer } from '../../components/common/ImageFramer';
import { useKitchenSoundAlert } from './KitchenSoundStore';
import { generateRandomPixKey, normalizePixKey, pixKeyKind } from '../../shared/pix';
import type { SetSettingsField, SettingsDraft } from './kitchenSettingsDraft';
import {
  Advanced,
  Field,
  FieldGrid,
  FieldNote,
  INPUT_CLASS,
  NumberField,
  SettingsCard,
  StatusPill,
  SwitchDot,
  SwitchGroup,
  SwitchRow,
} from './KitchenSettingsUI';

type UploadImage = (dataUrl: string, filename?: string) => Promise<string | null>;

/**
 * O mapa entra por `lazy`. Ele só é usado para arrastar o pino até a porta da
 * loja — algo que se faz uma vez na vida — e estático arrastava o Leaflet e o
 * CSS dele (~170 kB) para o primeiro carregamento do painel inteiro, inclusive
 * na madrugada em que a cozinha só quer ver a fila de pedidos.
 */
const LiveMap = lazy(() =>
  import('../../components/common/LiveMap').then((module) => ({ default: module.LiveMap }))
);

/** Da altura exata do mapa, para o formulário não pular quando ele chega. */
const MapPlaceholder: React.FC = () => (
  <div className="h-56 bg-[#F5F5F4] sm:h-72" aria-hidden />
);

/**
 * O teste de som passa pelo canal de alerta, nunca direto no `sound.ts`.
 *
 * Com duas portas para o áudio, a de fora do canal ignorava as regras dele — o
 * botão tocava o bipe padrão enquanto o pedido real tocava o MP3 da loja, e o
 * teste deixava de provar qualquer coisa. `draft.orderSoundUrl` é o áudio ainda
 * não salvo: é justamente ele que a loja quer ouvir antes de gravar.
 */
const SoundTestButton: React.FC<{ url: string }> = ({ url }) => {
  const { channel } = useKitchenSoundAlert();
  return (
    <button type="button" className="btn-secondary" disabled={!url} onClick={() => channel.preview(url)}>
      <Play className="h-3.5 w-3.5" />
      Testar som
    </button>
  );
};

interface BaseProps {
  draft: SettingsDraft;
  setField: SetSettingsField;
}

/* ------------------------------------------------------------------ Loja -- */

export const StoreSection: React.FC<
  BaseProps & {
    storeLogo: string;
    setStoreLogo: (logo: string) => Promise<void>;
    uploadImage: UploadImage;
    cep: string;
    setCep: (value: string) => void;
    lookupCep: () => void;
    locate: (query: string) => void;
    locating: boolean;
    locationLabel: string;
    locationError: string;
  }
> = ({ draft, setField, storeLogo, setStoreLogo, uploadImage, cep, setCep, lookupCep, locate, locating, locationLabel, locationError }) => (
  <>
    <SettingsCard title="Identidade" description="É isso que o cliente vê no topo do cardápio.">
      <LogoEditor logo={storeLogo} uploadImage={uploadImage} onSave={setStoreLogo} />
      <FieldGrid>
        <Field label="Nome da loja" value={draft.storeName} onChange={(value) => setField('storeName', value)} placeholder="Caldinho Express" />
        <Field label="Cidade" value={draft.city} onChange={(value) => setField('city', value)} placeholder="Recife - PE" />
      </FieldGrid>
      <Field
        label="WhatsApp da loja"
        value={draft.storeWhatsApp}
        onChange={(value) => setField('storeWhatsApp', value)}
        placeholder="5581999990000"
        inputMode="tel"
        hint="Recebe os comprovantes de pagamento. Use código do país + DDD, só números."
      />
    </SettingsCard>

    <SettingsCard title="Endereço e mapa" description="O endereço aparece para quem retira na loja. O pino calcula a distância da entrega.">
      <FieldGrid>
        <Field
          label="CEP"
          value={cep}
          onChange={setCep}
          placeholder="50000-000"
          inputMode="numeric"
          action={
            <button type="button" className="btn-secondary shrink-0" onClick={lookupCep} disabled={locating}>
              <Search className="h-3.5 w-3.5" />
              {locating ? '...' : 'Buscar'}
            </button>
          }
        />
        <Field
          label="Endereço da loja"
          value={draft.storeAddress}
          onChange={(value) => setField('storeAddress', value)}
          placeholder="Rua, número, bairro"
          action={
            <button type="button" className="btn-secondary shrink-0" onClick={() => locate(draft.storeAddress)} disabled={locating}>
              <MapPin className="h-3.5 w-3.5" />
              Localizar
            </button>
          }
        />
      </FieldGrid>
      {locationLabel && <FieldNote tone="ok">📍 {locationLabel}</FieldNote>}
      {locationError && <FieldNote tone="danger">{locationError}</FieldNote>}
      <div className="overflow-hidden rounded-xl border border-[#E7E5E4]">
        <Suspense fallback={<MapPlaceholder />}>
          <LiveMap
            store={{ lat: draft.storeLat, lng: draft.storeLng, name: draft.storeName }}
            pickPosition={{ lat: draft.storeLat, lng: draft.storeLng }}
            onPick={(lat, lng) => {
              setField('storeLat', lat);
              setField('storeLng', lng);
            }}
            heightClass="h-56 sm:h-72"
          />
        </Suspense>
      </div>
      <FieldNote>Toque no mapa para arrastar o pino até a porta da loja.</FieldNote>
      <Advanced summary="Coordenadas exatas">
        <FieldGrid>
          <NumberField label="Latitude" value={draft.storeLat} onChange={(value) => setField('storeLat', value)} min={-90} />
          <NumberField label="Longitude" value={draft.storeLng} onChange={(value) => setField('storeLng', value)} min={-180} />
        </FieldGrid>
      </Advanced>
    </SettingsCard>
  </>
);

const LogoEditor: React.FC<{ logo: string; uploadImage: UploadImage; onSave: (logo: string) => Promise<void> }> = ({ logo, uploadImage, onSave }) => {
  const { frameImage, framerNode } = useImageFramer();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E7E5E4] bg-[#FAFAF9] p-3">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#E7E5E4] bg-white text-2xl">
        {logo ? <img src={logo} alt="Logo da loja" className="h-full w-full object-contain" /> : <span>🏪</span>}
      </div>
      <div className="min-w-[140px] flex-1">
        <p className="text-sm font-bold text-[#1C1917]">Logo da loja</p>
        <p className="mt-0.5 text-xs text-[#78716C]">Imagem quadrada, PNG ou JPG.</p>
      </div>
      <label className="btn-secondary shrink-0 cursor-pointer">
        <Upload className="h-3.5 w-3.5" />
        Trocar
        <input
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file || validateImageFile(file)) return;
            const dataUrl = await frameImage(file, { aspect: 1, title: 'Enquadrar logo da loja' });
            if (!dataUrl) return;
            const url = await uploadImage(dataUrl, 'logo');
            if (url) await onSave(url);
          }}
        />
      </label>
      {framerNode}
    </div>
  );
};

/* -------------------------------------------------------- Pedidos e frete -- */

export const DeliverySection: React.FC<BaseProps> = ({ draft, setField }) => (
  <>
    <SettingsCard
      title="Como a loja recebe pedidos"
      description="Desligar “Aceitar pedidos” fecha a loja na hora, mesmo dentro do horário."
      aside={<StatusPill tone={draft.orderEnabled ? 'ok' : 'danger'}>{draft.orderEnabled ? 'Recebendo pedidos' : 'Loja fechada'}</StatusPill>}
    >
      <SwitchGroup>
        <SwitchRow
          label="Aceitar pedidos"
          description="Chave geral. Desligada, o cardápio fica só para consulta."
          checked={draft.orderEnabled}
          onChange={(value) => setField('orderEnabled', value)}
        />
        <SwitchRow
          label="Forçar loja aberta"
          description="Ignora o horário de funcionamento e mantém a loja aberta."
          checked={draft.forceOpen}
          onChange={(value) => setField('forceOpen', value)}
        />
        <SwitchRow
          label="Aceitar retirada na loja"
          description="O cliente busca o pedido no balcão e não paga frete."
          checked={draft.pickupEnabled}
          onChange={(value) => setField('pickupEnabled', value)}
        />
      </SwitchGroup>
      {draft.pickupEnabled && (
        <NumberField
          label="Tempo até ficar pronto para retirar"
          value={draft.pickupReadyMinutes}
          onChange={(value) => setField('pickupReadyMinutes', Math.max(5, value))}
          suffix="min"
          min={5}
          hint="Mínimo de 5 minutos. É o prazo que aparece para o cliente."
        />
      )}
    </SettingsCard>

    <SettingsCard title="Cálculo do frete" description="O valor final é a taxa base + (km × preço por km), respeitando a taxa mínima.">
      <FieldGrid>
        <NumberField label="Taxa base" value={draft.deliveryBaseFee} onChange={(value) => setField('deliveryBaseFee', value)} prefix="R$" hint="Cobrada em toda entrega." />
        <NumberField label="Preço por km" value={draft.deliveryPricePerKm} onChange={(value) => setField('deliveryPricePerKm', value)} prefix="R$" hint="Somado por quilômetro rodado." />
        <NumberField label="Taxa mínima" value={draft.deliveryMinFee} onChange={(value) => setField('deliveryMinFee', value)} prefix="R$" hint="O frete nunca fica abaixo disso." />
        <NumberField label="Frete grátis acima de" value={draft.freeDeliveryAbove} onChange={(value) => setField('freeDeliveryAbove', value)} prefix="R$" hint="0 desliga o frete grátis." />
      </FieldGrid>
    </SettingsCard>

    <SettingsCard title="Limites e repasse" description="Até onde a loja entrega e quanto o motoboy recebe.">
      <FieldGrid>
        <NumberField label="Raio máximo de entrega" value={draft.maxDeliveryKm} onChange={(value) => setField('maxDeliveryKm', value)} suffix="km" hint="0 = sem limite de distância." />
        <NumberField label="Pedido mínimo" value={draft.minOrderValue} onChange={(value) => setField('minOrderValue', value)} prefix="R$" hint="0 desliga o valor mínimo." />
        <NumberField label="Fator de rota" value={draft.routeFactor} onChange={(value) => setField('routeFactor', value)} suffix="×" hint="Converte linha reta em rua real. Use 1,35." />
        <NumberField label="Taxa do motoboy" value={draft.driverFeePerDelivery} onChange={(value) => setField('driverFeePerDelivery', value)} prefix="R$" hint="Valor fixo por entrega. 0 = repassa o frete do pedido." />
      </FieldGrid>
    </SettingsCard>
  </>
);

/* ---------------------------------------------------------- Pagamentos --- */

/* ------------------------------------------------------------ Pagamentos -- */

const PIX_KEY_KIND_LABEL: Record<string, string> = {
  email: 'e-mail',
  evp: 'chave aleatória',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  phone: 'celular',
};

/**
 * Celular e CPF têm os mesmos 11 dígitos. O sistema decide pelo dígito
 * verificador do CPF, mas quem sabe qual é a chave é o dono: esta linha mostra
 * a leitura para ele conferir antes que um cliente receba o QR Code errado.
 */
const PixKeyReading: React.FC<{ value: string }> = ({ value }) => {
  const raw = value.trim();
  if (!raw) return null;
  const kind = pixKeyKind(raw);
  if (kind === 'desconhecido') return null;
  return (
    <FieldNote tone="ok">
      Entendemos como <strong>{PIX_KEY_KIND_LABEL[kind]}</strong>: <code>{normalizePixKey(raw)}</code>. É essa
      chave que vai dentro do QR Code — se estiver errada, o banco recusa o pagamento.
    </FieldNote>
  );
};



/**
 * Quem cobra o PIX. Duas opções que se excluem, então é uma lista de rádio e
 * não dois interruptores: com dois interruptores a loja consegue desligar os
 * dois e ficar sem PIX nenhum sem perceber.
 */
const PIX_PROVIDER_OPTIONS: { value: PixProvider; label: string; description: string }[] = [
  {
    value: 'mercadopago',
    label: 'Mercado Pago',
    description: 'O dinheiro cai na conta do Mercado Pago e o sistema confirma o pagamento sozinho. Tem taxa por cobrança.',
  },
  {
    value: 'local',
    label: 'Minha chave PIX',
    description: 'O QR Code sai da chave abaixo e o dinheiro cai direto no seu banco, sem taxa. Você confere o comprovante e confirma o pagamento na mão.',
  },
];

const PixProviderChoice: React.FC<{ value: PixProvider; onChange: (next: PixProvider) => void }> = ({
  value,
  onChange,
}) => (
  <div role="radiogroup" aria-label="Quem gera a cobrança PIX" className="grid gap-2.5">
    {PIX_PROVIDER_OPTIONS.map((option) => {
      const active = value === option.value;
      return (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(option.value)}
          className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B91C1C]/40 ${
            active ? 'border-[#B91C1C] bg-[#FEF2F2]' : 'border-[#E7E5E4] bg-white hover:bg-[#FAFAF9]'
          }`}
        >
          <span
            className={`mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2 ${
              active ? 'border-[#B91C1C]' : 'border-[#D6D3D1]'
            }`}
          >
            {active && <span className="h-2 w-2 rounded-full bg-[#B91C1C]" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-[#1C1917]">{option.label}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-[#78716C]">{option.description}</span>
          </span>
        </button>
      );
    })}
  </div>
);

export const PaymentsSection: React.FC<
  BaseProps & {
    settings: PublicStoreSettings;
    pixError: string;
    mpBusy: boolean;
    mpToken: string;
    setMpToken: (value: string) => void;
    mpPublicKey: string;
    setMpPublicKey: (value: string) => void;
    connectMp: () => void;
    saveMp: () => void;
    disconnectMp: () => void;
  }
> = ({ draft, setField, settings, pixError, mpBusy, mpToken, setMpToken, mpPublicKey, setMpPublicKey, connectMp, saveMp, disconnectMp }) => (
  <>
    <SettingsCard
      title="Como cobrar o PIX"
      description="Escolha quem gera o QR Code que o cliente paga."
      aside={
        <StatusPill tone={draft.pixProvider === 'local' ? 'ok' : 'muted'}>
          {draft.pixProvider === 'local' ? 'Chave da loja' : 'Mercado Pago'}
        </StatusPill>
      }
    >
      <PixProviderChoice value={draft.pixProvider} onChange={(next) => setField('pixProvider', next)} />
      {draft.pixProvider === 'local' && !draft.pixKey.trim() && (
        <FieldNote tone="danger">
          Cadastre a chave PIX abaixo. Sem ela o cliente não consegue escolher PIX.
        </FieldNote>
      )}
      {draft.pixProvider === 'local' && (
        <FieldNote>
          Ninguém avisa o sistema quando o PIX cai nesta modalidade: confirme cada pagamento no pedido, na tela da cozinha.
        </FieldNote>
      )}
      {draft.pixProvider === 'mercadopago' && !settings.mercadoPagoConnected && draft.pixKey.trim() && (
        <FieldNote tone="danger">
          O Mercado Pago está desconectado. Enquanto isso, o PIX sai da sua chave abaixo.
        </FieldNote>
      )}
    </SettingsCard>

    <SettingsCard
      title="Mercado Pago"
      description={
        settings.mercadoPagoConnected
          ? 'Os PIX novos são gerados e confirmados automaticamente pelo Mercado Pago.'
          : 'Conecte sua conta para confirmar o pagamento sozinho, sem conferir comprovante.'
      }
      aside={
        <>
          <StatusPill tone={settings.mercadoPagoConnected ? 'ok' : 'muted'}>
            {settings.mercadoPagoConnected ? 'Conectado' : 'Desconectado'}
          </StatusPill>
          {settings.mercadoPagoTestMode && <StatusPill tone="warn">Modo teste</StatusPill>}
        </>
      }
    >
      {settings.mercadoPagoConnected ? (
        <button type="button" className="btn-danger" onClick={disconnectMp} disabled={mpBusy}>
          Desconectar conta
        </button>
      ) : (
        <button type="button" className="btn-primary" onClick={connectMp} disabled={mpBusy}>
          {mpBusy ? 'Abrindo...' : 'Conectar com o Mercado Pago'}
        </button>
      )}
      <Advanced summary="Credenciais manuais (para testes)">
        <Field label="Access Token" value={mpToken} onChange={setMpToken} type="password" placeholder="TEST-..." />
        <Field label="Chave pública" value={mpPublicKey} onChange={setMpPublicKey} placeholder="TEST-..." />
        <button type="button" className="btn-secondary" onClick={saveMp} disabled={mpBusy}>
          Salvar credenciais
        </button>
      </Advanced>
    </SettingsCard>

    <SettingsCard
      title="Chave PIX da loja"
      description="Usada quando a cobrança sai da sua chave, e como reserva se o Mercado Pago falhar."
      aside={<StatusPill tone={draft.pixKey.trim() ? 'ok' : 'muted'}>{draft.pixKey.trim() ? 'Chave cadastrada' : 'Sem chave'}</StatusPill>}
    >
      <Field
        label="Chave PIX"
        value={draft.pixKey}
        onChange={(value) => setField('pixKey', value)}
        error={pixError}
        placeholder="CPF, CNPJ, e-mail, celular ou chave aleatória"
      />
      <PixKeyReading value={draft.pixKey} />
      <FieldGrid>
        <Field label="Nome do recebedor" value={draft.pixMerchantName} onChange={(value) => setField('pixMerchantName', value)} />
        <Field label="Cidade do recebedor" value={draft.pixMerchantCity} onChange={(value) => setField('pixMerchantCity', value)} />
      </FieldGrid>
      <button type="button" className="btn-secondary" onClick={() => setField('pixKey', generateRandomPixKey())}>
        <KeyRound className="h-3.5 w-3.5" />
        Gerar chave de teste
      </button>
      <FieldNote>
        A chave de teste só tem o formato certo: ela não existe em banco nenhum e não recebe dinheiro. Para receber de
        verdade, use a chave que aparece no app do seu banco.
      </FieldNote>
    </SettingsCard>

    <SettingsCard title="Pagamento na entrega" description="Formas que o cliente escolhe para pagar quando o pedido chega.">
      <SwitchGroup>
        <SwitchRow
          label="Levar maquininha de cartão"
          description="Ligado, o cliente pode pagar no cartão na entrega ou na retirada. Desligado, sobram cartão online, PIX e dinheiro."
          checked={draft.cardOnDeliveryEnabled}
          onChange={(value) => setField('cardOnDeliveryEnabled', value)}
        />
      </SwitchGroup>
    </SettingsCard>
  </>
);

/* ------------------------------------------------------------- Horários -- */

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DEFAULT_HOUR: OpeningHour = { open: '18:00', close: '23:00' };

export const HoursSection: React.FC<BaseProps> = ({ draft, setField }) => {
  const setDay = (index: number, hour: OpeningHour | null) =>
    setField('openingHours', draft.openingHours.map((item, itemIndex) => (itemIndex === index ? hour : item)));
  const copyToAll = (index: number) => {
    const source = draft.openingHours[index];
    if (!source) return;
    setField('openingHours', draft.openingHours.map(() => ({ ...source })));
  };
  const openDays = draft.openingHours.filter(Boolean).length;

  return (
    <SettingsCard
      title="Horário de funcionamento"
      description="A loja abre e fecha sozinha nesses horários."
      aside={<StatusPill tone={openDays ? 'ok' : 'danger'}>{openDays ? `${openDays} dia(s) aberto(s)` : 'Nenhum dia aberto'}</StatusPill>}
    >
      {draft.forceOpen && (
        <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5 text-xs font-bold text-[#B45309]">
          “Forçar loja aberta” está ligado em <span className="underline">Pedidos e entrega</span> — este horário está sendo ignorado.
        </div>
      )}
      <div className="divide-y divide-[#F5F5F4] overflow-hidden rounded-xl border border-[#E7E5E4]">
        {draft.openingHours.map((hour, index) => (
          <div key={index} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(hour)}
              aria-label={`${DAY_NAMES[index]}: ${hour ? 'aberto' : 'fechado'}`}
              onClick={() => setDay(index, hour ? null : { ...DEFAULT_HOUR })}
              className="flex w-[150px] shrink-0 items-center gap-2.5 rounded-lg py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B91C1C]/40"
            >
              <SwitchDot checked={Boolean(hour)} />
              <span className={`text-sm font-bold ${hour ? 'text-[#1C1917]' : 'text-[#A8A29E]'}`}>{DAY_NAMES[index]}</span>
            </button>
            {hour ? (
              /* Dois `input[type=time]` do iOS + o botão de copiar não cabiam nos 296px
                 úteis de um celular de 360px: `min-w-0` no grupo deixa a linha
                 encolher em vez de empurrar a página inteira para o lado. */
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:min-w-[210px]">
                <input
                  className={`${INPUT_CLASS} flex-1 sm:max-w-[150px]`}
                  type="time"
                  aria-label={`Abre ${DAY_NAMES[index]}`}
                  value={hour.open}
                  onChange={(event) => setDay(index, { open: event.target.value, close: hour.close })}
                />
                <span className="text-xs font-bold text-[#A8A29E]">até</span>
                <input
                  className={`${INPUT_CLASS} flex-1 sm:max-w-[150px]`}
                  type="time"
                  aria-label={`Fecha ${DAY_NAMES[index]}`}
                  value={hour.close}
                  onChange={(event) => setDay(index, { open: hour.open, close: event.target.value })}
                />
                <button
                  type="button"
                  title="Aplicar este horário a todos os dias"
                  aria-label={`Aplicar o horário de ${DAY_NAMES[index]} a todos os dias`}
                  onClick={() => copyToAll(index)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E7E5E4] bg-white text-[#78716C] transition-colors hover:bg-[#F5F5F4] hover:text-[#1C1917] pointer-coarse:h-11 pointer-coarse:w-11"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <span className="flex-1 text-xs font-bold text-[#A8A29E]">Fechado</span>
            )}
          </div>
        ))}
      </div>
      <FieldNote>Para virada de madrugada, use 00:00 como horário de fechar.</FieldNote>
    </SettingsCard>
  );
};

/* -------------------------------------------------------------- Sistema -- */

const formatMoment = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

export const SystemSection: React.FC<
  BaseProps & {
    settings: PublicStoreSettings;
    pinError: string;
    runBackup: () => void;
    backupRunning: boolean;
    uploadImage: UploadImage;
  }
> = ({ draft, setField, settings, pinError, runBackup, backupRunning, uploadImage }) => (
  <>
    <SettingsCard
      title="Acesso da cozinha"
      description="O PIN é pedido para entrar neste painel. Deixe em branco para manter o atual."
      aside={<StatusPill tone={settings.kitchenPinSet ? 'ok' : 'warn'}>{settings.kitchenPinSet ? 'PIN definido' : 'Sem PIN'}</StatusPill>}
    >
      <Field
        label="Novo PIN"
        value={draft.kitchenPin}
        onChange={(value) => setField('kitchenPin', value)}
        type="password"
        error={pinError}
        hint="No mínimo 4 caracteres. Ele só é gravado quando você salva."
      />
    </SettingsCard>

    <SettingsCard
      title="Backup automático"
      description="Copia os pedidos e o cardápio para uma pasta do Google Drive."
      aside={
        <>
          <StatusPill tone={draft.backupEnabled ? 'ok' : 'muted'}>{draft.backupEnabled ? 'Ligado' : 'Desligado'}</StatusPill>
          {settings.backupKeySet && <StatusPill tone="ok">Credencial salva</StatusPill>}
        </>
      }
    >
      <SwitchGroup>
        <SwitchRow
          label="Fazer backup sozinho"
          description="Roda no intervalo escolhido, sem você precisar lembrar."
          checked={draft.backupEnabled}
          onChange={(value) => setField('backupEnabled', value)}
        />
      </SwitchGroup>
      <FieldGrid>
        <NumberField
          label="Frequência"
          value={draft.backupFrequencyDays}
          onChange={(value) => setField('backupFrequencyDays', Math.max(1, value))}
          suffix="dias"
          min={1}
          disabled={!draft.backupEnabled}
        />
        <Field
          label="Pasta do Google Drive"
          value={draft.backupFolderId}
          onChange={(value) => setField('backupFolderId', value)}
          placeholder="ID da pasta"
          hint="O trecho depois de /folders/ no endereço da pasta."
        />
      </FieldGrid>
      <Field
        label="Service account JSON"
        value={draft.backupServiceAccount}
        onChange={(value) => setField('backupServiceAccount', value)}
        type="password"
        placeholder={settings.backupKeySet ? 'Já salvo — cole aqui só para trocar' : 'Cole o JSON da conta de serviço'}
      />
      {settings.backupLastRun && (
        <div className="rounded-xl border border-[#E7E5E4] bg-[#FAFAF9] px-3 py-2.5 text-xs text-[#57534E]">
          <p className="font-bold text-[#1C1917]">Último backup</p>
          <p className="mt-1">
            {formatMoment(settings.backupLastRun)}
            {settings.backupLastStatus && ` — ${settings.backupLastStatus}`}
          </p>
          {settings.backupLastFile && <p className="mt-0.5 truncate">Arquivo: {settings.backupLastFile}</p>}
        </div>
      )}
      <button type="button" className="btn-secondary" onClick={runBackup} disabled={backupRunning}>
        <CloudUpload className="h-4 w-4" />
        {backupRunning ? 'Executando...' : 'Executar backup agora'}
      </button>
    </SettingsCard>

    <SettingsCard title="Som de novo pedido" description="O que toca no painel quando um pedido entra. Sem áudio, o sistema anuncia por voz.">
      <Field
        label="Endereço do áudio"
        value={draft.orderSoundUrl}
        onChange={(value) => setField('orderSoundUrl', value)}
        placeholder="Deixe vazio para usar a voz do sistema"
      />
      <div className="flex flex-wrap gap-2">
        <label className="btn-secondary cursor-pointer">
          <Upload className="h-3.5 w-3.5" />
          Enviar áudio
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const reader = new FileReader();
              reader.onload = async () => {
                if (typeof reader.result !== 'string') return;
                const url = await uploadImage(reader.result, 'som-pedido');
                if (url) setField('orderSoundUrl', url);
              };
              reader.readAsDataURL(file);
            }}
          />
        </label>
        <SoundTestButton url={draft.orderSoundUrl} />
      </div>
    </SettingsCard>
  </>
);
