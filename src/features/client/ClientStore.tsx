import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Category, CategoryId, Coupon, Product, Promotion } from '../../../contract/catalog/types';
import type { DeliveryAddress } from '../../../contract/order/types';
import type { PublicStoreSettings } from '../../../contract/shop/types';
import type { AlertUrgency } from '../../../contract/order/alerts';
import { api } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { useLiveSession } from '../../lib/liveSession';
import { AlertBannerProvider, useAlertBanner } from '../../ui/alertBanner';
import { computeCartTotals } from '../../../contract/pricing/pricing';
import { DEFAULT_STORE_SETTINGS } from '../../../contract/shop/defaults';
import { CartProvider, useCart } from './CartStore';
import { CheckoutProvider } from './CheckoutStore';
import { getOrCreateCustomerId } from './clientIdentity';
import { applyShopBranding } from '../../lib/appShell';
import { aplicarTokens } from '../../ui/tokens';

interface ClientShellValue {
  products: Product[];
  categories: Category[];
  selectedCategory: CategoryId | 'all';
  setSelectedCategory: (cat: CategoryId | 'all') => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  coupons: Coupon[];
  promotions: Promotion[];
  customerId: string;
  storeLogo: string;
  storeName: string;
  city: string;
  settings: PublicStoreSettings;
  ready: boolean;
  loadError: boolean;
  retryLoad: () => void;
  triggerToast: (msg: string, urgency?: AlertUrgency) => void;
}

// Representa "nenhum endereço selecionado" só na fronteira com funções que ainda exigem
// DeliveryAddress completo (computeCartTotals); o estado real do carrinho usa null.
const EMPTY_ADDRESS: DeliveryAddress = {
  id: '',
  label: '',
  street: '',
  number: '',
  neighborhood: '',
  city: '',
  distanceKm: 0,
};

const ClientShellContext = createContext<ClientShellValue | undefined>(undefined);

/** A faixa de aviso é o provedor mais externo: a casca do cliente já dispara
 *  avisos (carrinho, endereço) antes de qualquer pedido existir. */
export const ClientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AlertBannerProvider>
    <ClientShell>{children}</ClientShell>
  </AlertBannerProvider>
);

const ClientShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const triggerToast = useAlertBanner();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const customerId = useMemo(getOrCreateCustomerId, []);
  const [storeLogo, setStoreLogo] = useState('');
  const [settings, setSettings] = useState<PublicStoreSettings>({
    ...DEFAULT_STORE_SETTINGS,
    brandPrimaryColor: '',
    kitchenPinSet: false,
    isOpen: true,
    pixEnabled: false,
    mercadoPagoConnected: false,
    mercadoPagoOAuthReady: false,
    mercadoPagoTestMode: false,
    mercadoPagoPublicKey: '',
    mercadoPagoUserId: '',
    backupEnabled: false,
    backupFrequencyDays: 1,
    backupFolderId: '',
    backupKeySet: false,
    backupLastRun: '',
    backupLastStatus: '',
    backupLastFile: '',
  });
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadInitialData = useCallback(() => {
    setLoadError(false);
    return Promise.all([
      api.get<Product[]>('/products').then(setProducts),
      api.get<Category[]>('/categories').then(setCategories),
      api.get<Coupon[]>('/coupons').then(setCoupons),
      api.get<Promotion[]>('/promotions').then(setPromotions),
      api.get<{ logo: string }>('/store').then((result) => setStoreLogo(result.logo)),
      api.get<PublicStoreSettings>('/settings').then(setSettings),
    ])
      .then(() => setLoadError(false))
      .catch(() => setLoadError(true))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  const retryLoad = useCallback(() => {
    void loadInitialData();
  }, [loadInitialData]);

  // O estado do cliente (catálogo, cupom, configuração, loja aberta) vive de
  // eventos do socket. O que passou enquanto a conexão esteve fora se perde —
  // então, ao reconectar, recarrega tudo. Sem isto o cliente montava carrinho
  // de item esgotado numa loja que já fechou.
  useLiveSession({
    customerId,
    onSettingsUpdated: (next) => setSettings((previous) => ({ ...previous, ...next })),
    onReconnect: retryLoad,
  });

  // O nome da loja entra na aba assim que as configurações chegam. Vale mais do
  // que estética: o iOS ignora o `short_name` do manifesto e usa o `<title>`
  // como nome sob o ícone — então ele precisa estar certo ANTES de alguém
  // escolher "Adicionar à Tela de Início".
  useEffect(() => {
    applyShopBranding(settings.storeName ?? '', settings.brandPrimaryColor);
    // A marca da loja vira variável CSS no `<html>`. Hoje quase nenhuma tela lê
    // `var(--marca)` ainda — as 510 cores continuam escritas à mão — mas cada
    // uma que for convertida passa a seguir a loja sem precisar de mais nada.
    aplicarTokens(settings.brandPrimaryColor);
  }, [settings.storeName, settings.brandPrimaryColor]);

  useSocketEvent<{ logo: string }>('store:updated', ({ logo }) => setStoreLogo(logo));
  useSocketEvent('products:updated', () => void api.get<Product[]>('/products').then(setProducts).catch(() => {}));
  useSocketEvent('categories:updated', () => void api.get<Category[]>('/categories').then(setCategories).catch(() => {}));
  useSocketEvent('coupons:updated', () => void api.get<Coupon[]>('/coupons').then(setCoupons).catch(() => {}));
  useSocketEvent('promotions:updated', () => void api.get<Promotion[]>('/promotions').then(setPromotions).catch(() => {}));

  const shell: ClientShellValue = {
    products,
    categories,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    coupons,
    promotions,
    customerId,
    storeLogo,
    storeName: settings.storeName,
    city: settings.city,
    settings,
    ready,
    loadError,
    retryLoad,
    triggerToast,
  };

  return (
    <ClientShellContext.Provider value={shell}>
      <CartProvider settings={settings} coupons={coupons} triggerToast={triggerToast}>
        <CheckoutProvider customerId={customerId} products={products} settings={settings} triggerToast={triggerToast}>
          {children}
        </CheckoutProvider>
      </CartProvider>
    </ClientShellContext.Provider>
  );
};

export const useClientShell = (): ClientShellValue => {
  const context = useContext(ClientShellContext);
  if (!context) throw new Error('useClientShell deve ser usado dentro de ClientProvider');
  return context;
};

export const useCartTotals = () => {
  const { settings, promotions, products } = useClientShell();
  const { cart, appliedCoupon, selectedAddress, fulfillment } = useCart();
  // Recalcula a cada render: uma promoção de happy hour precisa cair sozinha
  // quando o relógio passa das 22h, sem o cliente recarregar a página.
  return computeCartTotals(cart, appliedCoupon, selectedAddress ?? EMPTY_ADDRESS, settings, fulfillment, {
    promotions,
    products,
  });
};

export { useCart } from './CartStore';
export { useCheckout } from './CheckoutStore';
