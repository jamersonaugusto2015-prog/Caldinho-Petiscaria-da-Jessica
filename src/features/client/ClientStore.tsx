import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Category, CategoryId, Coupon, DeliveryAddress, Product, Promotion, PublicStoreSettings } from '../../types';
import { api } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { useLiveSession } from '../../lib/liveSession';
import { computeCartTotals } from '../../shared/pricing';
import { DEFAULT_STORE_SETTINGS } from '../../shared/defaults';
import { CartProvider, useCart } from './CartStore';
import { CheckoutProvider } from './CheckoutStore';
import { getOrCreateCustomerId } from './clientIdentity';

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
  notificationToast: string | null;
  triggerToast: (msg: string) => void;
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

export const ClientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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
  const [notificationToast, setNotificationToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerToast = useCallback((message: string) => {
    setNotificationToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setNotificationToast(null), 4000);
  }, []);

  useLiveSession({
    customerId,
    onSettingsUpdated: (next) => setSettings((previous) => ({ ...previous, ...next })),
  });

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

  // O título da aba acompanha o nome da loja (index.html só tem o valor padrão).
  useEffect(() => {
    const name = settings.storeName?.trim();
    if (name) document.title = `${name} - Sabor Regional & Rapidez`;
  }, [settings.storeName]);

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
    notificationToast,
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
