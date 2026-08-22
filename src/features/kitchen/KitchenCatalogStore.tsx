import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Category, Coupon, Product, Promotion } from '../../../contract/catalog/types';
import { kitchenApi as api } from '../../lib/api';
import { useSocketEvent } from '../../lib/socket';
import { useKitchenToast } from './KitchenNotificationsStore';

interface KitchenCatalogContextType {
  products: Product[];
  categories: Category[];
  coupons: Coupon[];
  promotions: Promotion[];
  /** true só durante a primeira carga; uma recarga em segundo plano não acende de novo. */
  loading: boolean;
  /** erro da carga inicial — some assim que o cardápio chega uma vez. */
  error: string | null;
  reload: () => void;
  toggleProductAvailability: (id: string, currentlyAvailable: boolean) => Promise<void>;
  updateProductPrice: (id: string, newPrice: number) => Promise<void>;
  updateProduct: (id: string, patch: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  addProduct: (p: Product) => Promise<void>;
  toggleFeatured: (product: Product) => Promise<void>;
  updateProductImage: (id: string, imageUrl: string) => Promise<void>;
  saveCategory: (cat: Category) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  moveCategory: (id: string, dir: -1 | 1) => Promise<void>;
  reorderCategories: (orderedIds: string[]) => Promise<void>;
  saveCoupon: (c: Coupon) => Promise<void>;
  deleteCoupon: (code: string) => Promise<void>;
  savePromotion: (promo: Promotion) => Promise<boolean>;
  deletePromotion: (id: string) => Promise<void>;
  togglePromotion: (promo: Promotion) => Promise<void>;
  resetPromotionUses: (id: string) => Promise<void>;
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
  const [promotions, setPromotions] = useState<Promotion[]>([]);

  // Category ordering needs the current list without capturing it in a closure.
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  // Salvar uma promoção precisa saber se ela já existe (PATCH) ou não (POST)
  // sem prender a lista atual dentro do callback.
  const promotionsRef = useRef(promotions);
  promotionsRef.current = promotions;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cada fetch devolve a própria promise sem engolir o erro: quem chama decide
  // se é a carga inicial (tela de erro) ou uma recarga de fundo (aviso e mantém a lista).
  const fetchProducts = useCallback(() => api.get<Product[]>('/products').then(setProducts), []);
  const fetchCategories = useCallback(() => api.get<Category[]>('/categories').then(setCategories), []);
  const fetchCoupons = useCallback(() => api.get<Coupon[]>('/coupons').then(setCoupons), []);
  const fetchPromotions = useCallback(() => api.get<Promotion[]>('/promotions').then(setPromotions), []);

  const refetch = useCallback(() => {
    // Recarga de fundo (reconexão): a lista que já está na tela não some por causa
    // de uma falha — só um aviso único, mesmo se mais de um recurso falhar junto.
    void Promise.allSettled([fetchProducts(), fetchCategories(), fetchCoupons(), fetchPromotions()]).then(
      (results) => {
        if (results.some((r) => r.status === 'rejected')) {
          triggerToast('Não deu para atualizar o cardápio. Mostrando os últimos dados carregados.');
        }
      }
    );
  }, [fetchProducts, fetchCategories, fetchCoupons, fetchPromotions, triggerToast]);

  const loadInitial = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchProducts(), fetchCategories(), fetchCoupons(), fetchPromotions()])
      .then(() => setError(null))
      .catch(() => setError('Não deu para carregar o cardápio. Confira a conexão e tente de novo.'))
      .finally(() => setLoading(false));
  }, [fetchProducts, fetchCategories, fetchCoupons, fetchPromotions]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useSocketEvent('products:updated', () =>
    void fetchProducts().catch(() => triggerToast('Não deu para atualizar os produtos. Mostrando os últimos carregados.'))
  );
  useSocketEvent('categories:updated', () =>
    void fetchCategories().catch(() => triggerToast('Não deu para atualizar as categorias. Mostrando as últimas carregadas.'))
  );
  useSocketEvent('coupons:updated', () =>
    void fetchCoupons().catch(() => triggerToast('Não deu para atualizar os cupons. Mostrando os últimos carregados.'))
  );
  useSocketEvent('promotions:updated', () =>
    void fetchPromotions().catch(() => triggerToast('Não deu para atualizar as promoções. Mostrando as últimas carregadas.'))
  );

  const toggleProductAvailability = useCallback(
    async (id: string, currentlyAvailable: boolean) => {
      try {
        const updated = await api.patch<Product>(`/products/${id}`, { available: !currentlyAvailable });
        setProducts((prev) => prev.map((x) => (x.id === id ? updated : x)));
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Não deu para atualizar o produto. Confira a conexão e tente de novo.');
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
        triggerToast(err instanceof Error ? err.message : 'Não deu para atualizar o preço. Tente de novo.');
      }
    },
    [triggerToast]
  );

  const updateProduct = useCallback(
    async (id: string, patch: Partial<Product>) => {
      try {
        const updated = await api.patch<Product>(`/products/${id}`, patch);
        setProducts((prev) => prev.map((x) => (x.id === id ? updated : x)));
        triggerToast('Produto atualizado.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Não deu para atualizar o produto. Confira a conexão e tente de novo.');
      }
    },
    [triggerToast]
  );

  const deleteProduct = useCallback(
    async (id: string) => {
      try {
        await api.delete(`/products/${id}`);
        setProducts((prev) => prev.filter((x) => x.id !== id));
        triggerToast('Produto removido.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Não deu para remover o produto. Confira a conexão e tente de novo.');
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
        triggerToast(err instanceof Error ? err.message : 'Não deu para criar o produto. Tente de novo.');
      }
    },
    [triggerToast]
  );

  // Qualquer produto pode ser a promoção do dia; clicar no que já está marcado desmarca.
  const toggleFeatured = useCallback(
    async (product: Product) => {
      const isCurrent = Boolean(product.isFeatured);
      try {
        if (isCurrent) await api.delete(`/products/${product.id}/destaque`);
        else await api.post(`/products/${product.id}/destaque`);
        const list = await api.get<Product[]>('/products');
        setProducts(list);
        triggerToast(
          isCurrent
            ? 'Promoção do dia removida.'
            : `${product.name || 'Produto'} agora é a promoção do dia.`
        );
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Não deu para mudar a promoção do dia. Tente de novo.');
      }
    },
    [triggerToast]
  );

  const updateProductImage = useCallback(
    async (id: string, imageUrl: string) => {
      try {
        const updated = await api.patch<Product>(`/products/${id}`, { image: imageUrl });
        setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
        triggerToast('Imagem da promoção atualizada.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Não deu para salvar a imagem. Confira a conexão e tente de novo.');
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
        triggerToast('Categoria salva.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Não deu para salvar a categoria. Tente de novo.');
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
        triggerToast(err instanceof Error ? err.message : 'Não deu para remover a categoria. Tente de novo.');
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
        triggerToast(err instanceof Error ? err.message : 'Não deu para salvar a nova ordem. Tente de novo.');
      }
    },
    [triggerToast]
  );

  /** Reordena pela lista inteira — é o que o arrastar-e-soltar da tela de categorias envia. */
  const reorderCategories = useCallback(
    async (orderedIds: string[]) => {
      const current = categoriesRef.current;
      const byId = new Map<string, Category>(current.map((c) => [c.id, c] as const));
      const next = orderedIds
        .map((id, index) => {
          const found = byId.get(id);
          return found ? { ...found, sort: index } : null;
        })
        .filter((c): c is Category => c !== null);
      if (next.length !== current.length) return;
      const changed = next.filter((c) => byId.get(c.id)?.sort !== c.sort);
      if (!changed.length) return;
      setCategories(next); // otimista: o card não pode voltar para o lugar antigo enquanto salva
      try {
        await Promise.all(
          changed.map((c) => api.patch(`/categories/${encodeURIComponent(c.id)}`, { sort: c.sort }))
        );
        const list = await api.get<Category[]>('/categories');
        setCategories(list);
      } catch (err) {
        setCategories(current);
        triggerToast(err instanceof Error ? err.message : 'Não deu para salvar a nova ordem. Tente de novo.');
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
        triggerToast(`Cupom ${c.code} salvo.`);
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Não deu para salvar o cupom. Tente de novo.');
      }
    },
    [triggerToast]
  );

  const deleteCoupon = useCallback(
    async (code: string) => {
      try {
        await api.delete(`/coupons/${encodeURIComponent(code)}`);
        setCoupons((prev) => prev.filter((c) => c.code !== code));
        triggerToast('Cupom removido.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Não deu para remover o cupom. Tente de novo.');
      }
    },
    [triggerToast]
  );

  // ---------- Promoções ----------
  // O servidor é quem valida a regra (ex.: leve 3 pague 4 não existe). O painel
  // devolve `false` para o editor saber que deve continuar aberto com o erro.
  const savePromotion = useCallback(
    async (promo: Promotion) => {
      try {
        const exists = promotionsRef.current.some((p) => p.id === promo.id);
        if (exists) await api.patch<Promotion>(`/promotions/${encodeURIComponent(promo.id)}`, promo);
        else await api.post<Promotion>('/promotions', promo);
        setPromotions(await api.get<Promotion[]>('/promotions'));
        triggerToast('Promoção salva.');
        return true;
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Não deu para salvar a promoção. Confira a conexão e tente de novo.');
        return false;
      }
    },
    [triggerToast]
  );

  const deletePromotion = useCallback(
    async (id: string) => {
      try {
        await api.delete(`/promotions/${encodeURIComponent(id)}`);
        setPromotions((prev) => prev.filter((p) => p.id !== id));
        triggerToast('Promoção removida.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Não deu para remover a promoção. Tente de novo.');
      }
    },
    [triggerToast]
  );

  const togglePromotion = useCallback(
    async (promo: Promotion) => {
      try {
        const updated = await api.patch<Promotion>(`/promotions/${encodeURIComponent(promo.id)}`, {
          enabled: !promo.enabled,
        });
        setPromotions((prev) => prev.map((p) => (p.id === promo.id ? updated : p)));
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Não deu para pausar ou ativar a promoção. Tente de novo.');
      }
    },
    [triggerToast]
  );

  const resetPromotionUses = useCallback(
    async (id: string) => {
      try {
        const updated = await api.post<Promotion>(`/promotions/${encodeURIComponent(id)}/reset-uses`, {});
        setPromotions((prev) => prev.map((p) => (p.id === id ? updated : p)));
        triggerToast('Contador de usos zerado.');
      } catch (err) {
        triggerToast(err instanceof Error ? err.message : 'Não deu para zerar o contador. Tente de novo.');
      }
    },
    [triggerToast]
  );

  const value = useMemo<KitchenCatalogContextType>(
    () => ({
      products,
      categories,
      coupons,
      promotions,
      loading,
      error,
      reload: loadInitial,
      toggleProductAvailability,
      updateProductPrice,
      updateProduct,
      deleteProduct,
      addProduct,
      toggleFeatured,
      updateProductImage,
      saveCategory,
      deleteCategory,
      moveCategory,
      reorderCategories,
      saveCoupon,
      deleteCoupon,
      savePromotion,
      deletePromotion,
      togglePromotion,
      resetPromotionUses,
    }),
    [
      products,
      categories,
      coupons,
      promotions,
      loading,
      error,
      loadInitial,
      toggleProductAvailability,
      updateProductPrice,
      updateProduct,
      deleteProduct,
      addProduct,
      toggleFeatured,
      updateProductImage,
      saveCategory,
      deleteCategory,
      moveCategory,
      reorderCategories,
      saveCoupon,
      deleteCoupon,
      savePromotion,
      deletePromotion,
      togglePromotion,
      resetPromotionUses,
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
