import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { CartItem, Coupon, DeliveryAddress, Fulfillment, PublicStoreSettings } from '../../types';
import { computeCartItemTotal, findCoupon } from '../../shared/pricing';
import { isUsableAddress } from '../../shared/address';
import { normalizeFulfillment } from '../../shared/fulfillment';

export interface CartContextValue {
  cart: CartItem[];
  /** Retorna false (sem adicionar) quando a loja está fechada. */
  addToCart: (item: Omit<CartItem, 'id' | 'itemTotalPrice'>) => boolean;
  removeFromCart: (cartItemId: string) => void;
  updateCartQuantity: (cartItemId: string, delta: number) => void;
  clearCart: () => void;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  isClosedModalOpen: boolean;
  setClosedModalOpen: (open: boolean) => void;
  /** 'pickup' = o cliente busca no balcão; não usa endereço nem frete. */
  fulfillment: Fulfillment;
  setFulfillment: (value: Fulfillment) => void;
  addresses: DeliveryAddress[];
  selectedAddress: DeliveryAddress | null;
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
}

type CartProviderProps = {
  settings: PublicStoreSettings;
  coupons: Coupon[];
  triggerToast: (message: string) => void;
  children: React.ReactNode;
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

const loadFromStorage = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const CartProvider: React.FC<CartProviderProps> = ({ settings, coupons, triggerToast, children }) => {
  const [cart, setCart] = useState<CartItem[]>(() => loadFromStorage('ce_cart', []));
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isClosedModalOpen, setClosedModalOpen] = useState(false);
  const [addresses, setAddresses] = useState<DeliveryAddress[]>(() =>
    loadFromStorage<DeliveryAddress[]>('ce_addresses', []).filter(isUsableAddress)
  );
  const [selectedAddress, setSelectedAddress] = useState<DeliveryAddress | null>(() => {
    const stored = loadFromStorage<DeliveryAddress[]>('ce_addresses', []).filter(isUsableAddress);
    return stored[0] || null;
  });
  // O carrinho sobrevive à recarga; a escolha de retirada também precisa, senão
  // o cliente volta para "entrega" e a tela pede o endereço de novo.
  const [fulfillment, setFulfillment] = useState<Fulfillment>(() =>
    normalizeFulfillment(loadFromStorage<Fulfillment>('ce_fulfillment', 'delivery'))
  );
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [isAddressFormOpen, setIsAddressFormOpen] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);

  // A loja pode desligar a retirada com o carrinho já montado: volta para entrega sozinho.
  useEffect(() => {
    if (!settings.pickupEnabled) setFulfillment('delivery');
  }, [settings.pickupEnabled]);

  useEffect(() => localStorage.setItem('ce_fulfillment', JSON.stringify(fulfillment)), [fulfillment]);
  useEffect(() => localStorage.setItem('ce_cart', JSON.stringify(cart)), [cart]);
  useEffect(() => localStorage.setItem('ce_addresses', JSON.stringify(addresses)), [addresses]);

  const addToCart = (itemData: Omit<CartItem, 'id' | 'itemTotalPrice'>): boolean => {
    if (!settings.isOpen) {
      triggerToast('Restaurante fechado no momento. Verifique os horários.');
      setClosedModalOpen(true);
      return false;
    }
    const newItem: CartItem = {
      ...itemData,
      id: 'cart-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      itemTotalPrice: computeCartItemTotal(itemData, settings.sizeOptions),
    };
    setCart((previous) => [...previous, newItem]);
    setIsCartOpen(true);
    triggerToast('Item adicionado ao seu carrinho! 🍲');
    return true;
  };

  const removeFromCart = (cartItemId: string) => setCart((previous) => previous.filter((item) => item.id !== cartItemId));

  const updateCartQuantity = (cartItemId: string, delta: number) => {
    setCart((previous) =>
      previous
        .map((item) => {
          if (item.id !== cartItemId) return item;
          const quantity = item.quantity + delta;
          if (quantity <= 0) return null;
          return {
            ...item,
            quantity,
            itemTotalPrice: computeCartItemTotal({ ...item, quantity }, settings.sizeOptions),
          };
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const clearCart = () => {
    setCart([]);
    setAppliedCoupon(null);
  };

  const applyCoupon = (code: string) => {
    const coupon = findCoupon(code, coupons);
    if (!coupon) return { success: false, message: 'Cupom inválido ou expirado.' };
    const subtotal = cart.reduce((sum, item) => sum + computeCartItemTotal(item, settings.sizeOptions), 0);
    if (subtotal < coupon.minOrderValue) {
      return { success: false, message: `Valor mínimo para este cupom é R$ ${coupon.minOrderValue.toFixed(2)}` };
    }
    setAppliedCoupon(coupon);
    return { success: true, message: `Cupom ${coupon.code} aplicado com sucesso!` };
  };

  const addAddress = (address: Omit<DeliveryAddress, 'id'>) => {
    const created = { ...address, id: 'addr-' + Date.now() };
    setAddresses((previous) => [...previous, created]);
    setSelectedAddress(created);
  };

  const removeAddress = (id: string) => {
    const next = addresses.filter((address) => address.id !== id);
    setAddresses(next);
    if (selectedAddress?.id === id) setSelectedAddress(next[0] || null);
    triggerToast('Endereço removido.');
  };

  const openAddressForm = useCallback(() => {
    setIsAddressFormOpen(true);
    setIsAddressModalOpen(true);
  }, []);

  const value: CartContextValue = {
    cart,
    addToCart,
    removeFromCart,
    updateCartQuantity,
    clearCart,
    isCartOpen,
    setIsCartOpen,
    isClosedModalOpen,
    setClosedModalOpen,
    fulfillment,
    setFulfillment,
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
    removeCoupon: () => setAppliedCoupon(null),
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = (): CartContextValue => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart deve ser usado dentro de CartProvider');
  return context;
};
