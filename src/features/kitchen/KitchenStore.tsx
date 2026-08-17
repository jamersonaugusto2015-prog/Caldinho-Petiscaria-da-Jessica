import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  Product,
  Order,
  OrderStatus,
  Coupon,
  Driver,
  Category,
  PublicStoreSettings,
  SalesReport,
  RevenueTrends,
} from '../../types';
import { api } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { playNewOrderSound, announceNewOrder, playOrderMp3, unlockAudio } from '../../lib/sound';
import { DEFAULT_STORE_SETTINGS } from '../../shared/defaults';

interface KitchenContextType {
  orders: Order[];
  products: Product[];
  categories: Category[];
  coupons: Coupon[];
  drivers: Driver[];
  notificationToast: string | null;
  triggerToast: (msg: string) => void;
  updateOrderStatus: (orderId: string, newStatus: OrderStatus, driverName?: string) => Promise<void>;
  cancelOrder: (orderId: string, reason?: string) => Promise<void>;
  confirmPayment: (orderId: string) => Promise<void>;
  toggleProductAvailability: (id: string) => Promise<void>;
  updateProductPrice: (id: string, newPrice: number) => Promise<void>;
  updateProduct: (id: string, patch: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  addProduct: (p: Product) => Promise<void>;
  setCaldinhoDoDia: (id: string) => Promise<void>;
  uploadImage: (dataUrl: string, filename?: string) => Promise<string | null>;
  updateProductImage: (id: string, imageUrl: string) => Promise<void>;
  storeLogo: string;
  setStoreLogo: (logo: string) => Promise<void>;
  settings: PublicStoreSettings;
  saveSettings: (s: Partial<PublicStoreSettings> & { kitchenPin?: string }) => Promise<void>;
  createDriver: (d: Pick<Driver, 'name' | 'phone' | 'password' | 'bikeModel' | 'plate' | 'active'>) => Promise<void>;
  updateDriver: (id: string, patch: Partial<Driver>) => Promise<void>;
  deleteDriver: (id: string) => Promise<void>;
  saveCoupon: (c: Coupon) => Promise<void>;
  deleteCoupon: (code: string) => Promise<void>;
  report: SalesReport | null;
  loadReport: (from?: string, to?: string) => Promise<void>;
  trends: RevenueTrends | null;
  loadTrends: () => Promise<void>;
  soundEnabled: boolean;
  toggleSound: () => void;
  newOrderFlashId: string | null;
  saveCategory: (cat: Category) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  moveCategory: (id: string, dir: -1 | 1) => Promise<void>;
}

const KitchenContext = createContext<KitchenContextType | undefined>(undefined);

export const KitchenProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [storeLogo, setStoreLogoState] = useState('');
  const [settings, setSettings] = useState<PublicStoreSettings>({
    ...DEFAULT_STORE_SETTINGS,
    kitchenPinSet: false,
    isOpen: true,
  });
  const [report, setReport] = useState<SalesReport | null>(null);
  const [trends, setTrends] = useState<RevenueTrends | null>(null);
  const [notificationToast, setNotificationToast] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return localStorage.getItem('ce_kitchen_sound') !== 'off';
    } catch {
      return true;
    }
  });
  const [newOrderFlashId, setNewOrderFlashId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ce_kitchen_sound', next ? 'on' : 'off');
      } catch {
        /* ignora */
      }
      return next;
    });
  }, []);

  const toastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerToast = useCallback((msg: string) => {
    setNotificationToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setNotificationToast(null), 4000);
  }, []);

  useEffect(() => {
    unlockAudio();
    api.get<Order[]>('/orders').then(setOrders).catch(() => {});
    api.get<Product[]>('/products').then(setProducts).catch(() => {});
    api.get<Category[]>('/categories').then(setCategories).catch(() => {});
    api.get<Product[]>('/products').then(setProducts).catch(() => {});
    api.get<Coupon[]>('/coupons').then(setCoupons).catch(() => {});
    api.get<Driver[]>('/drivers').then(setDrivers).catch(() => {});
    api.get<{ logo: string }>('/store').then((r) => setStoreLogoState(r.logo)).catch(() => {});
    api
      .get<PublicStoreSettings>('/settings')
      .then(setSettings)
      .catch(() => {});
    loadReport();
    loadTrends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTrends = async () => {
    try {
      const t = await api.get<RevenueTrends>('/reports/trends');
      setTrends(t);
    } catch {
      /* silencioso */
    }
  };

  useSocketEvent<Partial<PublicStoreSettings>>('settings:updated', (s) => {
    setSettings((prev) => ({ ...prev, ...s }));
  });

  useSocketEvent<{ logo: string }>('store:updated', ({ logo }) => setStoreLogoState(logo));

  useSocketEvent('drivers:updated', () => {
    api.get<Driver[]>('/drivers').then(setDrivers).catch(() => {});
  });

  useSocketEvent('coupons:updated', () => {
    api.get<Coupon[]>('/coupons').then(setCoupons).catch(() => {});
  });

  // Pedido novo cai direto no kanban em tempo real
  useSocketEvent<Order>('order:new', (order) => {
    setOrders((prev) => (prev.some((o) => o.id === order.id) ? prev : [order, ...prev]));
    triggerToast(`🆕 Novo pedido ${order.id} chegou na cozinha! R$ ${order.total.toFixed(2)}`);
    if (soundEnabled) {
      if (settings.orderSoundUrl) {
        playOrderMp3(settings.orderSoundUrl); // áudio personalizado (MP3) 2x
      } else {
        playNewOrderSound();
        announceNewOrder(order.id); // voz feminina: "Novo pedido CX-XXXX chegou!" (2x)
      }
    }
    // Destaque do card (animação zoom) sincronizado com o alerta
    setNewOrderFlashId(order.id);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setNewOrderFlashId(null), 3000);
    loadTrends();
    loadReport();
  });

  useSocketEvent<Order>('order:updated', (order) => {
    setOrders((prev) => {
      const exists = prev.some((o) => o.id === order.id);
      return exists ? prev.map((o) => (o.id === order.id ? order : o)) : [order, ...prev];
    });
  });

  useSocketEvent('products:updated', () => {
    api.get<Product[]>('/products').then(setProducts).catch(() => {});
  });

  useSocketEvent('categories:updated', () => {
    api.get<Category[]>('/categories').then(setCategories).catch(() => {});
  });

  const loadReport = async (from?: string, to?: string) => {
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      const r = await api.get<SalesReport>(`/reports${qs ? `?${qs}` : ''}`);
      setReport(r);
    } catch {
      /* silencioso */
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: OrderStatus, driverName?: string) => {
    try {
      const updated = await api.patch<Order>(`/orders/${orderId}/status`, {
        status: newStatus,
        ...(driverName ? { driverName } : {}),
      });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar pedido.');
    }
  };

  const cancelOrder = async (orderId: string, reason?: string) => {
    try {
      const updated = await api.post<Order>(`/orders/${orderId}/cancel`, { reason });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      triggerToast(`Pedido ${orderId} cancelado.`);
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao cancelar pedido.');
    }
  };

  const confirmPayment = async (orderId: string) => {
    try {
      const updated = await api.patch<Order>(`/orders/${orderId}/payment`, {});
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      triggerToast('💰 Pagamento confirmado!');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao confirmar pagamento.');
    }
  };

  const toggleProductAvailability = async (id: string) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    try {
      const updated = await api.patch<Product>(`/products/${id}`, { available: !p.available });
      setProducts((prev) => prev.map((x) => (x.id === id ? updated : x)));
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar produto.');
    }
  };

  const updateProductPrice = async (id: string, newPrice: number) => {
    try {
      const updated = await api.patch<Product>(`/products/${id}`, { basePrice: newPrice });
      setProducts((prev) => prev.map((x) => (x.id === id ? updated : x)));
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar preço.');
    }
  };

  const updateProduct = async (id: string, patch: Partial<Product>) => {
    try {
      const updated = await api.patch<Product>(`/products/${id}`, patch);
      setProducts((prev) => prev.map((x) => (x.id === id ? updated : x)));
      triggerToast('✅ Produto atualizado!');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar produto.');
    }
  };

  const deleteProduct = async (id: string) => {
    try {
      await api.delete(`/products/${id}`);
      setProducts((prev) => prev.filter((x) => x.id !== id));
      triggerToast('🗑️ Produto removido.');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao remover produto.');
    }
  };

  const addProduct = async (p: Product) => {
    try {
      const created = await api.post<Product>('/products', p);
      setProducts((prev) => [created, ...prev]);
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao criar produto.');
    }
  };

  const setCaldinhoDoDia = async (id: string) => {
    try {
      await api.post(`/products/${id}/caldinho-do-dia`);
      const list = await api.get<Product[]>('/products');
      setProducts(list);
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao definir Caldinho do Dia.');
    }
  };

  const uploadImage = async (dataUrl: string, filename?: string): Promise<string | null> => {
    try {
      const res = await api.post<{ url: string }>('/upload', { dataUrl, filename });
      return res.url;
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao enviar imagem.');
      return null;
    }
  };

  const updateProductImage = async (id: string, imageUrl: string) => {
    try {
      const updated = await api.patch<Product>(`/products/${id}`, { image: imageUrl });
      setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
      triggerToast('🖼️ Imagem da promoção atualizada!');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar imagem.');
    }
  };

  const setStoreLogo = async (logo: string) => {
    try {
      const res = await api.post<{ logo: string }>('/store/logo', { logo });
      setStoreLogoState(res.logo);
      triggerToast('🏷️ Logo da loja atualizado!');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar o logo.');
    }
  };

  const saveSettings = async (s: Partial<PublicStoreSettings> & { kitchenPin?: string }) => {
    try {
      await api.post('/settings', s);
      setSettings((prev) => ({ ...prev, ...s }));
      triggerToast('⚙️ Configurações salvas!');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao salvar configurações.');
    }
  };

  const createDriver = async (data: Pick<Driver, 'name' | 'phone' | 'password' | 'bikeModel' | 'plate' | 'active'>) => {
    try {
      const created = await api.post<Driver>('/drivers', data);
      setDrivers((prev) => [...prev, created]);
      triggerToast(`🛵 Motoboy ${created.name} cadastrado!`);
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao criar motoboy.');
    }
  };

  const updateDriver = async (id: string, patch: Partial<Driver>) => {
    try {
      const updated = await api.patch<Driver>(`/drivers/${id}`, patch);
      setDrivers((prev) => prev.map((d) => (d.id === id ? updated : d)));
      triggerToast('✅ Motoboy atualizado!');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar motoboy.');
    }
  };

  const deleteDriver = async (id: string) => {
    try {
      await api.delete(`/drivers/${id}`);
      setDrivers((prev) => prev.filter((d) => d.id !== id));
      triggerToast('🗑️ Motoboy removido.');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao remover motoboy.');
    }
  };

  const saveCoupon = async (c: Coupon) => {
    try {
      await api.post<Coupon>('/coupons', c);
      const list = await api.get<Coupon[]>('/coupons');
      setCoupons(list);
      triggerToast(`🎟️ Cupom ${c.code} salvo!`);
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao salvar cupom.');
    }
  };

  const deleteCoupon = async (code: string) => {
    try {
      await api.delete(`/coupons/${encodeURIComponent(code)}`);
      setCoupons((prev) => prev.filter((c) => c.code !== code));
      triggerToast('🎟️ Cupom removido.');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao remover cupom.');
    }
  };

  // ---------- Categorias ----------
  const saveCategory = async (cat: Category) => {
    try {
      if (categories.some((c) => c.id === cat.id)) {
        await api.patch(`/categories/${encodeURIComponent(cat.id)}`, cat);
      } else {
        await api.post('/categories', cat);
      }
      const list = await api.get<Category[]>('/categories');
      setCategories(list);
      triggerToast('Categoria salva!');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao salvar categoria.');
    }
  };

  const deleteCategory = async (id: string) => {
    try {
      await api.delete(`/categories/${encodeURIComponent(id)}`);
      setCategories((prev) => prev.filter((c) => c.id !== id));
      triggerToast('Categoria removida.');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao remover categoria.');
    }
  };

  const moveCategory = async (id: string, dir: -1 | 1) => {
    const sorted = [...categories].sort((a, b) => a.sort - b.sort);
    const idx = sorted.findIndex((c) => c.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[target];
    const tmp = a.sort;
    a.sort = b.sort;
    b.sort = tmp;
    try {
      await Promise.all([
        api.patch(`/categories/${encodeURIComponent(a.id)}`, { sort: a.sort }),
        api.patch(`/categories/${encodeURIComponent(b.id)}`, { sort: b.sort }),
      ]);
      const list = await api.get<Category[]>('/categories');
      setCategories(list);
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao reordenar.');
    }
  };

  return (
    <KitchenContext.Provider
      value={{
        orders,
        products,
        categories,
        coupons,
        drivers,
        notificationToast,
        triggerToast,
        updateOrderStatus,
        cancelOrder,
        confirmPayment,
        toggleProductAvailability,
        updateProductPrice,
        updateProduct,
        deleteProduct,
        addProduct,
        setCaldinhoDoDia,
        uploadImage,
        updateProductImage,
        storeLogo,
        setStoreLogo,
        settings,
        saveSettings,
        createDriver,
        updateDriver,
        deleteDriver,
        saveCoupon,
        deleteCoupon,
        report,
        loadReport,
        trends,
        loadTrends,
        soundEnabled,
        toggleSound,
        newOrderFlashId,
        saveCategory,
        deleteCategory,
        moveCategory,
      }}
    >
      {children}
    </KitchenContext.Provider>
  );
};

export const useKitchen = () => {
  const context = useContext(KitchenContext);
  if (!context) throw new Error('useKitchen deve ser usado dentro de KitchenProvider');
  return context;
};
