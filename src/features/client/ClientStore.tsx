import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import confetti from 'canvas-confetti';
import {
  Product,
  CartItem,
  Order,
  OrderStatus,
  DeliveryAddress,
  Coupon,
  ChatMessage,
  CategoryId,
  Category,
  PublicStoreSettings,
} from '../../types';
import { api } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { computeCartItemTotal, computeCartTotals, findCoupon } from '../../shared/pricing';
import { STATUS_MESSAGES } from '../../shared/constants';
import { DEFAULT_STORE_SETTINGS } from '../../shared/defaults';

interface ClientContextType {
  products: Product[];
  categories: Category[];
  selectedCategory: CategoryId | 'all';
  setSelectedCategory: (cat: CategoryId | 'all') => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  cart: CartItem[];
  addToCart: (item: Omit<CartItem, 'id' | 'itemTotalPrice'>) => void;
  removeFromCart: (cartItemId: string) => void;
  updateCartQuantity: (cartItemId: string, delta: number) => void;
  clearCart: () => void;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  isClosedModalOpen: boolean;
  setClosedModalOpen: (open: boolean) => void;

  addresses: DeliveryAddress[];
  selectedAddress: DeliveryAddress;
  setSelectedAddress: (addr: DeliveryAddress) => void;
  addAddress: (addr: Omit<DeliveryAddress, 'id'>) => void;
  removeAddress: (id: string) => void;
  isAddressModalOpen: boolean;
  isAddressFormOpen: boolean;
  setAddressModalOpen: (open: boolean) => void;
  setAddressFormOpen: (open: boolean) => void;
  openAddressForm: () => void;

  coupons: Coupon[];
  appliedCoupon: Coupon | null;
  applyCoupon: (code: string) => { success: boolean; message: string };
  removeCoupon: () => void;

  customerId: string;
  orders: Order[];
  trackingOrderId: string | null;
  setTrackingOrderId: (id: string | null) => void;
  placeOrder: (
    paymentMethod: 'pix' | 'card' | 'cash',
    changeFor?: number,
    customer?: { name: string; phone: string }
  ) => Promise<{ order: Order } | { error: string } | null>;
  rateOrder: (orderId: string, rating: number, comment?: string) => Promise<void>;
  cancelOrder: (orderId: string, reason?: string) => Promise<boolean>;

  loyaltyPoints: number;
  redeemLoyaltyReward: (productId: string) => Promise<{ success: boolean; message: string }>;

  storeLogo: string;
  storeName: string;
  city: string;
  settings: PublicStoreSettings;
  ready: boolean;

  sendChatMessage: (orderId: string, sender: 'client' | 'store' | 'driver', senderName: string, text: string) => Promise<void>;

  notificationToast: string | null;
  triggerToast: (msg: string) => void;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

const loadFromStorage = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
};

function getOrCreateCustomerId(): string {
  try {
    const existing = localStorage.getItem('ce_customer_id');
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : 'cust-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('ce_customer_id', id);
    return id;
  } catch {
    return 'anon';
  }
}

export const ClientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [cart, setCart] = useState<CartItem[]>(() => loadFromStorage('ce_cart', []));
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isClosedModalOpen, setClosedModalOpen] = useState(false);

  const [addresses, setAddresses] = useState<DeliveryAddress[]>(() =>
    loadFromStorage<DeliveryAddress[]>('ce_addresses', [])
  );
  const [selectedAddress, setSelectedAddress] = useState<DeliveryAddress>(() => {
    const list = loadFromStorage<DeliveryAddress[]>('ce_addresses', []);
    return list[0] || ({} as DeliveryAddress);
  });
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [isAddressFormOpen, setIsAddressFormOpen] = useState(false);

  const customerId = useMemo(getOrCreateCustomerId, []);

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [storeLogo, setStoreLogoState] = useState('');
  const [settings, setSettings] = useState<PublicStoreSettings>({
    ...DEFAULT_STORE_SETTINGS,
    kitchenPinSet: false,
    isOpen: true,
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

  const prevStatusRef = useRef<Record<string, OrderStatus>>({});
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerToast = useCallback((msg: string) => {
    setNotificationToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setNotificationToast(null), 4000);
  }, []);

  // Load inicial (ready = dados de identidade da loja carregados, usado pelo splash)
  useEffect(() => {
    Promise.all([
      api.get<Product[]>('/products').then(setProducts).catch(() => {}),
      api.get<Category[]>('/categories').then(setCategories).catch(() => {}),
      api
        .get<Order[]>(`/orders?customerId=${encodeURIComponent(customerId)}`)
        .then(setOrders)
        .catch(() => {}),
      api
        .get<{ points: number }>(`/loyalty?customerId=${encodeURIComponent(customerId)}`)
        .then((r) => setLoyaltyPoints(r.points))
        .catch(() => {}),
      api.get<{ logo: string }>('/store').then((r) => setStoreLogoState(r.logo)).catch(() => {}),
      api.get<Coupon[]>('/coupons').then(setCoupons).catch(() => {}),
      api
        .get<PublicStoreSettings>('/settings')
        .then(setSettings)
        .catch(() => {}),
    ]).finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useSocketEvent<Partial<PublicStoreSettings>>('settings:updated', (s) => {
    setSettings((prev) => ({ ...prev, ...s }));
  });

  useSocketEvent<{ logo: string }>('store:updated', ({ logo }) => setStoreLogoState(logo));

  // Persistência local (carrinho e endereços são do dispositivo do cliente)
  useEffect(() => {
    localStorage.setItem('ce_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem('ce_addresses', JSON.stringify(addresses));
  }, [addresses]);

  // --- Socket: tempo real ---
  useSocketEvent<Order>('order:updated', (order) => {
    if (order.customerId !== customerId) return;
    setOrders((prev) => {
      const exists = prev.some((o) => o.id === order.id);
      return exists ? prev.map((o) => (o.id === order.id ? order : o)) : [order, ...prev];
    });

    const prevStatus = prevStatusRef.current[order.id];
    prevStatusRef.current[order.id] = order.status;

    if (prevStatus && prevStatus !== order.status) {
      triggerToast(`${order.id}: ${STATUS_MESSAGES[order.status]}`);
      if (order.status === 'entregue') {
        confetti({ particleCount: 100, spread: 90, origin: { y: 0.5 } });
      }
    }
  });

  useSocketEvent<Order>('order:new', (order) => {
    if (order.customerId !== customerId) return;
    setOrders((prev) => (prev.some((o) => o.id === order.id) ? prev : [order, ...prev]));
  });

  useSocketEvent('products:updated', () => {
    api.get<Product[]>('/products').then(setProducts).catch(() => {});
  });

  useSocketEvent('categories:updated', () => {
    api.get<Category[]>('/categories').then(setCategories).catch(() => {});
  });

  useSocketEvent('coupons:updated', () => {
    api.get<Coupon[]>('/coupons').then(setCoupons).catch(() => {});
  });

  useSocketEvent<{ customerId: string; points: number }>('loyalty:updated', ({ customerId: cid, points }) => {
    if (cid === customerId) setLoyaltyPoints(points);
  });

  // --- Ações de catálogo ---
  const addToCart = (itemData: Omit<CartItem, 'id' | 'itemTotalPrice'>) => {
    // Loja fechada: bloqueia a adição e avisa com os horários
    if (!settings.isOpen) {
      triggerToast('Restaurante fechado no momento. Verifique os horários.');
      setClosedModalOpen(true);
      return;
    }
    const newItem: CartItem = {
      ...itemData,
      id: 'cart-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      itemTotalPrice: computeCartItemTotal(itemData, settings.sizeOptions),
    };
    setCart((prev) => [...prev, newItem]);
    setIsCartOpen(true);
    triggerToast('Item adicionado ao seu carrinho! 🍲');
  };

  const removeFromCart = (cartItemId: string) => {
    setCart((prev) => prev.filter((i) => i.id !== cartItemId));
  };

  const updateCartQuantity = (cartItemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.id !== cartItemId) return i;
          const newQty = i.quantity + delta;
          if (newQty <= 0) return null;
          return {
            ...i,
            quantity: newQty,
            itemTotalPrice: computeCartItemTotal({ ...i, quantity: newQty }, settings.sizeOptions),
          };
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const clearCart = () => {
    setCart([]);
    setAppliedCoupon(null);
  };

  // --- Cupom ---
  const applyCoupon = (code: string) => {
    const coupon = findCoupon(code, coupons);
    if (!coupon) return { success: false, message: 'Cupom inválido ou expirado.' };
    const subtotal = cart.reduce((sum, item) => sum + computeCartItemTotal(item, settings.sizeOptions), 0);
    if (subtotal < coupon.minOrderValue) {
      return {
        success: false,
        message: `Valor mínimo para este cupom é R$ ${coupon.minOrderValue.toFixed(2)}`,
      };
    }
    setAppliedCoupon(coupon);
    return { success: true, message: `Cupom ${coupon.code} aplicado com sucesso!` };
  };

  const removeCoupon = () => setAppliedCoupon(null);

  // --- Endereços ---
  const addAddress = (addrData: Omit<DeliveryAddress, 'id'>) => {
    const newAddr: DeliveryAddress = { ...addrData, id: 'addr-' + Date.now() };
    setAddresses((prev) => [...prev, newAddr]);
    setSelectedAddress(newAddr);
  };

  const removeAddress = (id: string) => {
    const next = addresses.filter((a) => a.id !== id);
    setAddresses(next);
    if (selectedAddress.id === id) {
      setSelectedAddress(next[0] || ({} as DeliveryAddress));
    }
    triggerToast('Endereço removido.');
  };

  const openAddressForm = useCallback(() => {
    setIsAddressFormOpen(true);
    setIsAddressModalOpen(true);
  }, []);

  // --- Pedidos ---
  const placeOrder = async (
    paymentMethod: 'pix' | 'card' | 'cash',
    changeFor?: number,
    customer?: { name: string; phone: string }
  ): Promise<{ order: Order } | { error: string } | null> => {
    try {
      const res = await api.post<{ order: Order; loyaltyPoints: number }>('/orders', {
        items: cart,
        couponCode: appliedCoupon?.code,
        address: selectedAddress,
        paymentMethod,
        changeForAmount: changeFor,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        customerId,
      });
      setOrders((prev) => [res.order, ...prev]);
      setTrackingOrderId(res.order.id);
      setLoyaltyPoints(res.loyaltyPoints);
      clearCart();
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
      triggerToast(`Pedido ${res.order.id} enviado com sucesso! 🍲🚀`);
      return { order: res.order };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao enviar pedido.';
      triggerToast(message);
      return { error: message };
    }
  };

  const rateOrder = async (orderId: string, rating: number, comment?: string) => {
    try {
      const updated = await api.post<Order>(`/orders/${orderId}/rating`, { rating, comment });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      triggerToast('Obrigado pela sua avaliação! ⭐');
    } catch {
      triggerToast('Não foi possível registrar a avaliação. Tente novamente.');
    }
  };

  const cancelOrder = async (orderId: string, reason?: string): Promise<boolean> => {
    try {
      const updated = await api.post<Order>(`/orders/${orderId}/cancel`, { reason });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      triggerToast(`Pedido ${orderId} cancelado.`);
      return true;
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Não foi possível cancelar.');
      return false;
    }
  };

  // --- Fidelidade ---
  const redeemLoyaltyReward = async (productId: string): Promise<{ success: boolean; message: string }> => {
    if (loyaltyPoints < 10) {
      return { success: false, message: 'Complete 10 pedidos entregues para ganhar seu caldinho grátis.' };
    }
    try {
      const res = await api.post<{ points: number; token: string }>('/loyalty/redeem', { customerId, productId });
      setLoyaltyPoints(res.points);
      const freeProduct = products.find((p) => p.id === productId);
      if (freeProduct) {
        addToCart({
          product: freeProduct,
          selectedExtras: [],
          observation: 'GRÁTIS - Resgate Fidelidade! 🎉',
          quantity: 1,
          isFree: true,
          freeToken: res.token,
        });
      }
      confetti({ particleCount: 120, spread: 100, origin: { y: 0.6 } });
      return {
        success: true,
        message: `Parabéns! 1x ${freeProduct?.name || 'produto'} grátis no carrinho! 🎉`,
      };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Não foi possível resgatar.' };
    }
  };

  // --- Chat ---
  const sendChatMessage = async (
    orderId: string,
    sender: 'client' | 'store' | 'driver',
    senderName: string,
    text: string
  ) => {
    try {
      await api.post<ChatMessage>(`/orders/${orderId}/chat`, {
        orderId,
        sender,
        senderName,
        text,
      });
    } catch {
      triggerToast('Não foi possível enviar a mensagem. Tente novamente.');
    }
  };

  return (
    <ClientContext.Provider
      value={{
        products,
        categories,
        selectedCategory,
        setSelectedCategory,
        searchQuery,
        setSearchQuery,
        cart,
        addToCart,
        removeFromCart,
        updateCartQuantity,
        clearCart,
        isCartOpen,
        setIsCartOpen,
        isClosedModalOpen,
        setClosedModalOpen,
        addresses,
        selectedAddress,
        setSelectedAddress,
        addAddress,
        removeAddress,
        isAddressModalOpen,
        isAddressFormOpen,
        setAddressModalOpen: setIsAddressModalOpen,
        setAddressFormOpen: setIsAddressFormOpen,
        openAddressForm,
        coupons,
        appliedCoupon,
        applyCoupon,
        removeCoupon,
        customerId,
        orders,
        trackingOrderId,
        setTrackingOrderId,
        placeOrder,
        rateOrder,
        cancelOrder,
        loyaltyPoints,
        redeemLoyaltyReward,
        storeLogo,
        storeName: settings.storeName,
        city: settings.city,
        settings,
        ready,
        sendChatMessage,
        notificationToast,
        triggerToast,
      }}
    >
      {children}
    </ClientContext.Provider>
  );
};

export const useClient = () => {
  const context = useContext(ClientContext);
  if (!context) throw new Error('useClient deve ser usado dentro de ClientProvider');
  return context;
};

export const useCartTotals = () => {
  const { cart, appliedCoupon, selectedAddress, settings } = useClient();
  return computeCartTotals(cart, appliedCoupon, selectedAddress, settings);
};
