import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Product, Coupon, Category } from '../../types';
import { kitchenApi as api } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { useKitchenToast } from './KitchenNotificationsStore';

interface KitchenCatalogContextType {
  products: Product[];
  categories: Category[];
  coupons: Coupon[];
  toggleProductAvailability: (id: string, currentlyAvailable: boolean) => Promise<void>;
  updateProductPrice: (id: string, newPrice: number) => Promise<void>;
  updateProduct: (id: string, patch: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  addProduct: (p: Product) => Promise<void>;
  toggleCaldinhoDoDia: (product: Product) => Promise<void>;
  updateProductImage: (id: string, imageUrl: string) => Promise<void>;
  saveCategory: (cat: Category) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  moveCategory: (id: string, dir: -1 | 1) => Promise<void>;
  saveCoupon: (c: Coupon) => Promise<void>;
  deleteCoupon: (code: string) => Promise<void>;
}

interface KitchenCatalogSyncContextType {
  refetch: () => void;
}

const KitchenCatalogContext = createContext<KitchenCatalogContextType | undefined>(undefined);
const KitchenCatalogSyncContext = createContext<KitchenCatalogSyncContextType | undefined>(undefined);

export const KitchenCatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const triggerToast = useKitchenToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);

  // Category ordering needs the current list without capturing it in a closure.
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  const fetchProducts = useCallback(() => {
    api.get<Product[]>('/products').then(setProducts).catch(() => {});
  }, []);

  const fetchCategories = useCallback(() => {
    api.get<Category[]>('/categories').then(setCategories).catch(() => {});
  }, []);

  const fetchCoupons = useCallback(() => {
    api.get<Coupon[]>('/coupons').then(setCoupons).catch(() => {});
  }, []);

  const refetch = useCallback(() => {
    fetchProducts();
    fetchCategories();
    fetchCoupons();
  }, [fetchProducts, fetchCategories, fetchCoupons]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useSocketEvent('products:updated', fetchProducts);
  useSocketEvent('categories:updated', fetchCategories);
  useSocketEvent('coupons:updated', fetchCoupons);

  const toggleProductAvailability = useCallback(
    async (id: string, currentlyAvailable: boolean) => {
      try {
        const updated = await api.patch<Product>(`/products/${id}`, { available: !currentlyAvailable });
        setProducts((prev) => prev.map((x) => (x.id === id ? updated : x)));
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar produto.');
      }
    },
    [triggerToast]
  );

  const updateProductPrice = useCallback(
    async (id: string, newPrice: number) => {
      try {
        const updated = await api.patch<Product>(`/products/${id}`, { basePrice: newPrice });
        setProducts((prev) => prev.map((x) => (x.id === id ? updated : x)));
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar preço.');
      }
    },
    [triggerToast]
  );

  const updateProduct = useCallback(
    async (id: string, patch: Partial<Product>) => {
      try {
        const updated = await api.patch<Product>(`/products/${id}`, patch);
        setProducts((prev) => prev.map((x) => (x.id === id ? updated : x)));
        triggerToast('✅ Produto atualizado!');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar produto.');
      }
    },
    [triggerToast]
  );

  const deleteProduct = useCallback(
    async (id: string) => {
      try {
        await api.delete(`/products/${id}`);
        setProducts((prev) => prev.filter((x) => x.id !== id));
        triggerToast('🗑️ Produto removido.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao remover produto.');
      }
    },
    [triggerToast]
  );

  const addProduct = useCallback(
    async (p: Product) => {
      try {
        const created = await api.post<Product>('/products', p);
        setProducts((prev) => [created, ...prev]);
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao criar produto.');
      }
    },
    [triggerToast]
  );

  // Qualquer produto pode ser a promoção do dia; clicar no que já está marcado desmarca.
  const toggleCaldinhoDoDia = useCallback(
    async (product: Product) => {
      const isCurrent = Boolean(product.isCaldinhoDoDia);
      try {
        if (isCurrent) await api.delete(`/products/${product.id}/caldinho-do-dia`);
        else await api.post(`/products/${product.id}/caldinho-do-dia`);
        const list = await api.get<Product[]>('/products');
        setProducts(list);
        triggerToast(
          isCurrent
            ? '🔕 Promoção do dia removida.'
            : `🔥 ${product.name || 'Produto'} agora é a Promoção do Dia.`
        );
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao definir a Promoção do Dia.');
      }
    },
    [triggerToast]
  );

  const updateProductImage = useCallback(
    async (id: string, imageUrl: string) => {
      try {
        const updated = await api.patch<Product>(`/products/${id}`, { image: imageUrl });
        setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
        triggerToast('🖼️ Imagem da promoção atualizada!');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao atualizar imagem.');
      }
    },
    [triggerToast]
  );

  // ---------- Categorias ----------
  const saveCategory = useCallback(
    async (cat: Category) => {
      try {
        if (categoriesRef.current.some((c) => c.id === cat.id)) {
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
    },
    [triggerToast]
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      try {
        await api.delete(`/categories/${encodeURIComponent(id)}`);
        setCategories((prev) => prev.filter((c) => c.id !== id));
        triggerToast('Categoria removida.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao remover categoria.');
      }
    },
    [triggerToast]
  );

  const moveCategory = useCallback(
    async (id: string, dir: -1 | 1) => {
      const sorted = [...categoriesRef.current].sort((a, b) => a.sort - b.sort);
      const idx = sorted.findIndex((c) => c.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= sorted.length) return;
      const a = { ...sorted[idx], sort: sorted[target].sort };
      const b = { ...sorted[target], sort: sorted[idx].sort };
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
    },
    [triggerToast]
  );

  // ---------- Cupons ----------
  const saveCoupon = useCallback(
    async (c: Coupon) => {
      try {
        await api.post<Coupon>('/coupons', c);
        const list = await api.get<Coupon[]>('/coupons');
        setCoupons(list);
        triggerToast(`🎟️ Cupom ${c.code} salvo!`);
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao salvar cupom.');
      }
    },
    [triggerToast]
  );

  const deleteCoupon = useCallback(
    async (code: string) => {
      try {
        await api.delete(`/coupons/${encodeURIComponent(code)}`);
        setCoupons((prev) => prev.filter((c) => c.code !== code));
        triggerToast('🎟️ Cupom removido.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Erro ao remover cupom.');
      }
    },
    [triggerToast]
  );

  const value = useMemo<KitchenCatalogContextType>(
    () => ({
      products,
      categories,
      coupons,
      toggleProductAvailability,
      updateProductPrice,
      updateProduct,
      deleteProduct,
      addProduct,
      toggleCaldinhoDoDia,
      updateProductImage,
      saveCategory,
      deleteCategory,
      moveCategory,
      saveCoupon,
      deleteCoupon,
    }),
    [
      products,
      categories,
      coupons,
      toggleProductAvailability,
      updateProductPrice,
      updateProduct,
      deleteProduct,
      addProduct,
      toggleCaldinhoDoDia,
      updateProductImage,
      saveCategory,
      deleteCategory,
      moveCategory,
      saveCoupon,
      deleteCoupon,
    ]
  );

  const sync = useMemo<KitchenCatalogSyncContextType>(() => ({ refetch }), [refetch]);

  return (
    <KitchenCatalogSyncContext.Provider value={sync}>
      <KitchenCatalogContext.Provider value={value}>{children}</KitchenCatalogContext.Provider>
    </KitchenCatalogSyncContext.Provider>
  );
};

export const useKitchenCatalog = () => {
  const context = useContext(KitchenCatalogContext);
  if (!context) throw new Error('useKitchenCatalog deve ser usado dentro de KitchenProvider');
  return context;
};

export const useKitchenCatalogSync = () => {
  const context = useContext(KitchenCatalogSyncContext);
  if (!context) throw new Error('useKitchenCatalogSync deve ser usado dentro de KitchenProvider');
  return context;
};
