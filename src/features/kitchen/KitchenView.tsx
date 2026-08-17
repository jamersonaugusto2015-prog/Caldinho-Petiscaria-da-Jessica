import React, { useEffect, useState } from 'react';
import { useKitchen } from './KitchenStore';
import {
  PlusCircle,
  Power,
  Flame,
  BarChart3,
  Wallet,
  X,
  Users,
  Tags,
  Ticket,
  Megaphone,
  Settings,
  ShoppingBag,
  Star,
  ChevronRight,
  Zap,
  Bike,
  Phone,
  KeyRound,
  Pencil,
  Trash2,
  Power as PowerToggle,
  Upload,
  ImagePlus,
  Check,
  MapPin,
  Lock,
  Loader2,
  Clock,
  Camera,
  ChevronDown,
  Printer,
  LocateFixed,
  Sparkles,
  Music,
  ChevronUp,
  MessageCircle,
  CloudUpload,
} from 'lucide-react';
import { OrderStatus, CategoryId, Product, Coupon, Driver, OpeningHour, Order, ComboSlot, ExtraOption, Category } from '../../types';
import { LiveMap } from '../../components/common/LiveMap';
import { OrderReceiptModal } from '../../components/print/OrderReceiptModal';
import { RevenueChart } from './RevenueChart';
import { api } from '../../lib/api';
import { generatePixCopyPaste, generateRandomPixKey, validatePixKey, normalizePixKey } from '../../shared/pix';
import { resizeImage, ACCEPTED_IMAGE_TYPES, validateImageFile } from '../../lib/image';
import { CATEGORY_EMOJIS } from '../../shared/categories';
import { whatsAppLink } from '../../lib/whatsapp';

const WEEKDAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export type KitchenTab =
  | 'dashboard'
  | 'orders'
  | 'cardapio'
  | 'categorias'
  | 'clientes'
  | 'motoboys'
  | 'promocoes'
  | 'cupons'
  | 'financeiro'
  | 'relatorios'
  | 'config';

const FALLBACK_CATEGORIES: Category[] = [
  { id: 'caldinhos', label: 'Caldinhos', emoji: '🍲', color: '#C2410C', sort: 0 },
  { id: 'petiscos', label: 'Petiscos', emoji: '🍤', color: '#7C3AED', sort: 1 },
  { id: 'bebidas', label: 'Bebidas', emoji: '🥤', color: '#2563EB', sort: 2 },
  { id: 'combos', label: 'Combos', emoji: '🍱', color: '#059669', sort: 3 },
];

export const KitchenView: React.FC<{
  activeTab: KitchenTab;
  setActiveTab: (tab: KitchenTab) => void;
}> = ({ activeTab }) => {
  const {
    orders,
    products,
    coupons,
    drivers,
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
    categories,
    saveCategory,
    deleteCategory,
    moveCategory,
    notificationToast,
    triggerToast,
    newOrderFlashId,
  } = useKitchen();

  const catList: Category[] =
    categories.length > 0 ? [...categories].sort((a, b) => a.sort - b.sort) : FALLBACK_CATEGORIES;

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [confirmDeleteProduct, setConfirmDeleteProduct] = useState<Product | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState<CategoryId>('caldinhos');
  const [newPrice, setNewPrice] = useState('');
  const [newPrepTime, setNewPrepTime] = useState('');
  const [newImage, setNewImage] = useState('');
  const [newImagePreview, setNewImagePreview] = useState('');
  const [newImageUploading, setNewImageUploading] = useState(false);
  const [newComboSlots, setNewComboSlots] = useState<ComboSlot[]>([]);
  const [newExtras, setNewExtras] = useState<ExtraOption[]>([]);
  const newImageRef = React.useRef<HTMLInputElement>(null);

  const [driverModalOpen, setDriverModalOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [driverForm, setDriverForm] = useState({ name: '', phone: '', password: '', bikeModel: '', plate: '' });
  const [confirmDeleteDriver, setConfirmDeleteDriver] = useState<Driver | null>(null);

  // Rascunho das configurações
  const [configDraft, setConfigDraft] = useState({
    storeName: settings.storeName,
    city: settings.city,
    storeLat: settings.storeLat,
    storeLng: settings.storeLng,
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
    storeWhatsApp: settings.storeWhatsApp,
    orderSoundUrl: settings.orderSoundUrl,
    openingHours: settings.openingHours.map((h) => (h ? { ...h } : null)),
    orderEnabled: settings.orderEnabled,
    forceOpen: settings.forceOpen,
    kitchenPin: '',
    backupEnabled: settings.backupEnabled,
    backupFrequencyDays: settings.backupFrequencyDays,
    backupFolderId: settings.backupFolderId,
    backupServiceAccount: '',
  });

  const setCfg = <K extends keyof typeof configDraft>(key: K, value: (typeof configDraft)[K]) =>
    setConfigDraft((prev) => ({ ...prev, [key]: value }));

  // Sincroniza rascunhos quando as settings mudam (socket/outra aba)
  useEffect(() => {
    setConfigDraft((prev) => ({
      ...prev,
      storeName: settings.storeName,
      city: settings.city,
      storeLat: settings.storeLat,
      storeLng: settings.storeLng,
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
      storeWhatsApp: settings.storeWhatsApp,
      orderSoundUrl: settings.orderSoundUrl,
      openingHours: settings.openingHours.map((h) => (h ? { ...h } : null)),
      orderEnabled: settings.orderEnabled,
      forceOpen: settings.forceOpen,
      backupEnabled: settings.backupEnabled,
      backupFrequencyDays: settings.backupFrequencyDays,
      backupFolderId: settings.backupFolderId,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const [reportFrom, setReportFrom] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [reportTo, setReportTo] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [financePeriod, setFinancePeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [backupRunning, setBackupRunning] = useState(false);

  const handleRunBackup = async () => {
    setBackupRunning(true);
    try {
      await api.post('/backup/run');
      triggerToast('Backup concluído com sucesso! ☁️');
      await saveSettings({});
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao fazer backup.');
    } finally {
      setBackupRunning(false);
    }
  };

  const [storeCep, setStoreCep] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [storeLocating, setStoreLocating] = useState(false);
  const [storeLocateError, setStoreLocateError] = useState('');
  const [storeLocateLabel, setStoreLocateLabel] = useState('');

  const toggleOrder = (id: string) =>
    setExpandedOrders((prev) => ({ ...prev, [id]: !prev[id] }));

  const openCreateDriver = () => {
    setEditingDriver(null);
    setDriverForm({ name: '', phone: '', password: '', bikeModel: '', plate: '' });
    setDriverModalOpen(true);
  };

  const openEditDriver = (d: Driver) => {
    setEditingDriver(d);
    setDriverForm({
      name: d.name,
      phone: d.phone || '',
      password: '',
      bikeModel: d.bikeModel || '',
      plate: d.plate || '',
    });
    setDriverModalOpen(true);
  };

  const handleDriverSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!driverForm.name.trim()) return;
    if (editingDriver) {
      updateDriver(editingDriver.id, {
        name: driverForm.name,
        phone: driverForm.phone,
        ...(driverForm.password.trim()
          ? { password: driverForm.password }
          : {}),
        bikeModel: driverForm.bikeModel,
        plate: driverForm.plate,
      });
    } else {
      if (!driverForm.password.trim()) {
        triggerToast('Defina uma senha de acesso para o motoboy.');
        return;
      }
      createDriver({
        name: driverForm.name,
        phone: driverForm.phone,
        password: driverForm.password,
        bikeModel: driverForm.bikeModel,
        plate: driverForm.plate,
        active: true,
      });
    }
    setDriverModalOpen(false);
    setEditingDriver(null);
  };

  const totalRevenue = orders.reduce((sum, o) => sum + (o.status !== 'cancelado' ? o.total : 0), 0);
  const totalCompletedOrders = orders.filter((o) => o.status !== 'cancelado').length;
  const avgTicket = totalCompletedOrders > 0 ? totalRevenue / totalCompletedOrders : 0;
  const activeOrders = orders.filter((o) => o.status === 'recebido' || o.status === 'em_preparo' || o.status === 'pronto' || o.status === 'saiu_entrega');
  const unavailProducts = products.filter((p) => !p.available).length;

  const todayRevenue = report?.totalRevenue ?? 0;
  const todayOrders = report?.totalOrders ?? 0;
  const todayAvgTicket = report?.avgTicket ?? 0;

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newPrice) return;

    const newProd: Product = {
      id: 'prod-' + Date.now(),
      name: newName,
      description: newDesc || 'Iguaria irresistível da casa.',
      category: newCategory,
      basePrice: Number(newPrice),
      image:
        newImage ||
        'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&q=80&w=800',
      available: true,
      rating: 0,
      reviewsCount: 0,
      prepTimeMinutes: Number(newPrepTime) || 15,
      ...(newCategory === 'combos'
        ? {
            comboSlots: newComboSlots
              .filter((s) => s.label.trim())
              .map((s) => ({
                ...s,
                label: s.label.trim(),
                options: s.options.filter((o) => o.label.trim()).map((o) => ({ ...o, label: o.label.trim() })),
              })),
          }
        : {}),
      allowedExtras: newExtras
        .filter((e) => e.name.trim())
        .map((e) => ({ ...e, name: e.name.trim() })),
    };

    addProduct(newProd);
    setShowAddModal(false);
    setNewName('');
    setNewDesc('');
    setNewPrice('');
    setNewPrepTime('');
    setNewImage('');
    setNewImagePreview('');
    setNewComboSlots([]);
    setNewExtras([]);
  };

  // ---------- Local da loja: busca por CEP ou endereço ----------
  const handleStoreCepLookup = async () => {
    const cep = storeCep.replace(/\D/g, '');
    if (cep.length !== 8) {
      setStoreLocateError('Informe um CEP válido com 8 dígitos.');
      return;
    }
    setStoreLocateError('');
    setStoreLocating(true);
    try {
      const r = await api.get<{ street: string; neighborhood: string; city: string }>(`/cep/${cep}`);
      const query = [r.street, r.neighborhood, r.city].filter(Boolean).join(', ');
      const geo = await api.post<{ lat: number; lng: number; label: string }>('/geocode', { query });
      setCfg('storeLat', geo.lat);
      setCfg('storeLng', geo.lng);
      setStoreLocateLabel(geo.label || `${r.street}, ${r.neighborhood} - ${r.city}`);
      setStoreAddress(`${r.street}, ${r.neighborhood} - ${r.city}`);
    } catch (err) {
      setStoreLocateError(err instanceof Error ? err.message : 'CEP não encontrado.');
    } finally {
      setStoreLocating(false);
    }
  };

  const handleStoreAddressLookup = async () => {
    const query = storeAddress.trim();
    if (!query) {
      setStoreLocateError('Digite o endereço da loja.');
      return;
    }
    setStoreLocateError('');
    setStoreLocating(true);
    try {
      const geo = await api.post<{ lat: number; lng: number; label: string }>('/geocode', { query });
      setCfg('storeLat', geo.lat);
      setCfg('storeLng', geo.lng);
      setStoreLocateLabel(geo.label);
    } catch (err) {
      setStoreLocateError(
        err instanceof Error ? err.message : 'Endereço não encontrado. Use o pino no mapa.'
      );
    } finally {
      setStoreLocating(false);
    }
  };

  const handleNewProductImage = async (file: File) => {
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      triggerToast(invalid);
      return;
    }
    setNewImageUploading(true);
    try {
      const dataUrl = await resizeImage(file);
      setNewImagePreview(dataUrl);
      const url = await uploadImage(dataUrl, 'novo-produto');
      if (url) {
        setNewImage(url);
        setNewImagePreview(url);
      } else {
        setNewImage(dataUrl);
      }
    } catch (err) {
      triggerToast(err instanceof Error ? err.message : 'Erro ao enviar imagem.');
    } finally {
      setNewImageUploading(false);
    }
  };

  const statusColumns: { id: OrderStatus; title: string; badgeBg: string; badgeText: string; borderColor: string }[] = [
    { id: 'recebido', title: 'Aguardando Aceite', badgeBg: 'bg-[#2563EB]/10', badgeText: 'text-[#2563EB]', borderColor: 'border-[#2563EB]' },
    { id: 'em_preparo', title: 'Em Preparo', badgeBg: 'bg-[#D97706]/10', badgeText: 'text-[#D97706]', borderColor: 'border-[#D97706]' },
    { id: 'pronto', title: 'Pronto p/ Entrega', badgeBg: 'bg-[#7C3AED]/10', badgeText: 'text-[#7C3AED]', borderColor: 'border-[#7C3AED]' },
    { id: 'saiu_entrega', title: 'Saiu para Entrega', badgeBg: 'bg-[#9333EA]/10', badgeText: 'text-[#9333EA]', borderColor: 'border-[#9333EA]' },
    { id: 'entregue', title: 'Entregue', badgeBg: 'bg-[#059669]/10', badgeText: 'text-[#059669]', borderColor: 'border-[#059669]' },
    { id: 'cancelado', title: 'Cancelados', badgeBg: 'bg-[#DC2626]/10', badgeText: 'text-[#DC2626]', borderColor: 'border-[#DC2626]' },
  ];

  const paymentBreakdown = (method: 'cash' | 'card' | 'pix') =>
    orders
      .filter((o) => o.status !== 'cancelado' && o.payment.method === method)
      .reduce((s, o) => s + o.total, 0);

  interface CustomerSummary {
  name: string;
  phone?: string;
  orderCount: number;
  total: number;
  lastAt: string;
}

const customers: CustomerSummary[] = (() => {
  const map = new Map<string, CustomerSummary>();
  for (const o of orders) {
    const key = o.customerPhone || o.customerName;
    const cur = map.get(key) || {
      name: o.customerName,
      phone: o.customerPhone,
      orderCount: 0,
      total: 0,
      lastAt: o.createdAt,
    };
    cur.orderCount += 1;
    if (o.status !== 'cancelado') cur.total += o.total;
    if (o.createdAt > cur.lastAt) cur.lastAt = o.createdAt;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
})();

  const summaryCards = [
    { label: 'Vendas Hoje', value: `R$ ${todayRevenue.toFixed(2)}`, accent: 'text-[#1C1917]' },
    { label: 'Pedidos Hoje', value: String(todayOrders), accent: 'text-[#1C1917]' },
    { label: 'Ticket Médio Hoje', value: `R$ ${todayAvgTicket.toFixed(2)}`, accent: 'text-[#B91C1C]' },
  ];

  return (
    <div className="space-y-6 pb-16">
      {notificationToast && (
        <div className="bg-[#B91C1C] text-white px-4 py-2.5 text-center text-xs font-bold flex items-center justify-center gap-2 rounded-2xl shadow-md">
          <Flame className="w-4 h-4 text-[#FDE68A]" />
          <span>{notificationToast}</span>
        </div>
      )}

      {/* ---------- DASHBOARD ---------- */}
      {activeTab === 'dashboard' && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#B91C1C] flex items-center justify-center text-white shadow-md">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-[#1C1917]">Dashboard</h2>
              <p className="text-xs text-[#57534E]">Visão geral da loja em tempo real.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {summaryCards.map((c) => (
              <div key={c.label} className="bg-white rounded-2xl p-4 border border-[#E7E5E4] shadow-xs">
                <span className="text-[10px] text-[#57534E] uppercase font-bold">{c.label}</span>
                <div className={`font-extrabold text-xl mt-1 ${c.accent}`}>{c.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Pedidos Ativos', value: String(activeOrders.length), emoji: '🔔' },
              { label: 'Itens no Cardápio', value: String(products.length), emoji: '🍲' },
              { label: 'Fora de Estoque', value: String(unavailProducts), emoji: '⏸️' },
              { label: 'Cupons Ativos', value: String(coupons.length), emoji: '🎟️' },
            ].map((c) => (
              <div key={c.label} className="bg-[#F5F5F4] rounded-2xl p-3.5 border border-[#E7E5E4]">
                <div className="text-lg">{c.emoji}</div>
                <div className="font-extrabold text-lg text-[#1C1917]">{c.value}</div>
                <div className="text-[10px] text-[#57534E] font-bold uppercase tracking-wide">{c.label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl p-5 border border-[#E7E5E4] shadow-xs">
              <h3 className="text-sm font-extrabold text-[#1C1917] mb-3">Pedidos Recentes</h3>
              {orders.length === 0 ? (
                <p className="text-xs text-[#A8A29E] italic">Nenhum pedido ainda.</p>
              ) : (
                <div className="space-y-2">
                  {orders.slice(0, 5).map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-2 py-2 border-b border-[#F5F5F4] last:border-0 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <ShoppingBag className="w-3.5 h-3.5 text-[#B91C1C] shrink-0" />
                        <span className="font-extrabold text-[#1C1917]">{o.id}</span>
                        <span className="truncate text-[#57534E]">{o.customerName}</span>
                      </div>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#F5F5F4] text-[#57534E] shrink-0">
                        {o.status.replace('_', ' ')}
                      </span>
                      <span className="font-extrabold text-[#1C1917] shrink-0">R$ {o.total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl p-5 border border-[#E7E5E4] shadow-xs flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-extrabold text-[#1C1917]">Status do Cardápio</h3>
                <span className="text-[10px] text-[#57534E] font-bold bg-[#F5F5F4] border border-[#E7E5E4] px-2 py-0.5 rounded-full">
                  {unavailProducts} pausado(s)
                </span>
              </div>
              <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1 flex-1">
                {products.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 py-1.5 px-2 rounded-xl text-xs border transition ${
                      p.available ? 'border-transparent hover:bg-[#F5F5F4]' : 'bg-[#FEF2F2] border-[#FCA5A5]/50'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${p.available ? 'bg-[#059669]' : 'bg-[#B91C1C]'}`} />
                    <span
                      className={`flex-1 truncate font-semibold ${
                        p.available ? 'text-[#1C1917]' : 'text-[#B91C1C] line-through'
                      }`}
                      title={p.name}
                    >
                      {p.name}
                    </span>
                    <button
                      onClick={() => toggleProductAvailability(p.id)}
                      className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold transition active:scale-95 ${
                        p.available
                          ? 'bg-[#059669] text-white hover:bg-[#047857]'
                          : 'bg-[#B91C1C] text-white hover:bg-[#991B1B]'
                      }`}
                      title={p.available ? 'Pausar (acabou)' : 'Reativar (volta ao cardápio)'}
                    >
                      <Power className="w-3 h-3" />
                      {p.available ? 'Pausar' : 'Reativar'}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[#A8A29E] mt-2.5">
                Pause aqui quando o item acabar — o cliente para de ver na hora.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ---------- PEDIDOS (kanban) ---------- */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-[#1C1917]">Gestão de Pedidos</h3>
            <span className="bg-[#FEF2F2] text-[#B91C1C] border border-[#FCA5A5] text-[11px] font-bold px-3 py-1 rounded-full">
              {activeOrders.length} ativos
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {statusColumns.map((col) => {
              const colOrders = orders.filter((o) => o.status === col.id);
              return (
                <div
                  key={col.id}
                  className={`bg-white rounded-2xl p-4 border flex flex-col min-h-[380px] shadow-sm ${
                    col.id === 'cancelado' ? 'border-[#E7E5E4] opacity-95' : 'border-[#E7E5E4]'
                  }`}
                >
                  <div className={`flex items-center justify-between pb-2 border-b-2 ${col.borderColor}`}>
                    <h3 className="font-extrabold text-sm text-[#1C1917]">{col.title}</h3>
                    <span className={`text-xs font-black px-2.5 py-0.5 rounded-full ${col.badgeBg} ${col.badgeText}`}>
                      {colOrders.length}
                    </span>
                  </div>

                  <div className="space-y-3 mt-3 flex-1 overflow-y-auto pr-0.5">
                    {colOrders.length === 0 ? (
                      <p className="text-[11px] text-[#A8A29E] italic text-center py-8">
                        Nenhum pedido nesta coluna.
                      </p>
                    ) : (
                      colOrders.map((ord) => {
                        const isExpanded = !!expandedOrders[ord.id];
                        return (
                        <div
                          key={ord.id}
                          className={`bg-white border border-[#E7E5E4] rounded-2xl p-3 shadow-xs transition flex flex-col gap-2 ${
                            isExpanded ? 'hover:border-[#B91C1C]/40 hover:shadow-md' : 'hover:border-[#B91C1C]/40'
                          } ${ord.id === newOrderFlashId ? 'order-pop' : ''}`}
                        >
                          {/* Cabeçalho clicável (minimizado por padrão) */}
                          <div className="flex items-start gap-1">
                          <button
                            onClick={() => toggleOrder(ord.id)}
                            className="flex-1 min-w-0 text-left select-none"
                            title={isExpanded ? 'Minimizar pedido' : 'Expandir pedido'}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-extrabold text-xs text-[#1C1917]">{ord.id}</span>
                                  <span
                                    className={`text-[9px] font-black px-2 py-0.5 rounded-full shrink-0 ${
                                      ord.payment.isPaid
                                        ? 'bg-[#ECFDF5] text-[#059669]'
                                        : 'bg-[#FEF3C7] text-[#B45309]'
                                    }`}
                                  >
                                    {ord.payment.isPaid ? 'PAGO' : `${ord.payment.method.toUpperCase()} PENDENTE`}
                                  </span>
                                </div>
                                <div className="text-[10px] text-[#57534E] font-semibold truncate mt-0.5">
                                  {ord.customerName} • {ord.address.neighborhood || 'Endereço'}
                                  {ord.distanceKm > 0 && ` • ${ord.distanceKm.toFixed(1)} km`}
                                  {' • '}
                                  {new Date(ord.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                                {!isExpanded && (
                                  <div className="text-[10px] text-[#A8A29E] truncate mt-0.5">
                                    {ord.items.length} item(ns) • {ord.items.map((it) => it.product.name).join(', ')}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <div className="text-right">
                                  <div className="font-extrabold text-xs text-[#B91C1C]">
                                    R$ {ord.total.toFixed(2)}
                                  </div>
                                  <div className="text-[9px] text-[#57534E] uppercase font-bold">
                                    {ord.payment.method.toUpperCase()}
                                  </div>
                                </div>
                                <ChevronDown
                                  className={`w-4 h-4 text-[#A8A29E] transition-transform shrink-0 ${
                                    isExpanded ? 'rotate-180' : ''
                                  }`}
                                />
                              </div>
                            </div>
                          </button>
                          <button
                            onClick={() => setPrintOrder(ord)}
                            className="p-1.5 rounded-lg text-[#78716C] hover:text-[#1C1917] hover:bg-[#F5F5F4] transition shrink-0"
                            title="Imprimir pedido (térmica 80mm)"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          </div>

                          {isExpanded && (
                            <>
                          {/* Cliente + endereço */}
                          <div className="bg-[#F5F5F4] rounded-xl p-2.5 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-extrabold text-[#1C1917] leading-snug">
                                {ord.customerName}
                              </span>
                              {ord.distanceKm > 0 && (
                                <span className="text-[9px] bg-white border border-[#E7E5E4] text-[#57534E] px-1.5 py-0.5 rounded-full font-bold shrink-0">
                                  {ord.distanceKm.toFixed(1)} km
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-[#57534E] leading-snug break-words">
                              <span className="font-bold text-[#1C1917]">{ord.address.street}, {ord.address.number}</span>
                              {ord.address.neighborhood && <> • {ord.address.neighborhood}</>}
                              {ord.address.complement && (
                                <span className="block italic text-[#A8A29E]">{ord.address.complement}</span>
                              )}
                            </div>
                            {ord.customerPhone && (
                              <a
                                href={whatsAppLink(
                                  ord.customerPhone,
                                  `Olá ${ord.customerName}! Aqui é da ${settings.storeName}. Sobre seu pedido ${ord.id}:`
                                )}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-[#059669] font-bold flex items-center gap-1 hover:underline"
                                title="Falar com o cliente no WhatsApp"
                              >
                                <MessageCircle className="w-3 h-3" />
                                {ord.customerPhone}
                              </a>
                            )}
                            {ord.status === 'saiu_entrega' && ord.driverName && (
                              <div className="text-[10px] text-[#7C3AED] font-extrabold flex items-center gap-1">
                                <Bike className="w-3 h-3" />
                                {ord.driverName} em rota
                              </div>
                            )}
                            {ord.status === 'cancelado' && (
                              <div className="text-[10px] text-[#B91C1C] font-bold bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg p-1.5 break-words">
                                {ord.cancellationReason || 'Cancelado'}
                              </div>
                            )}
                          </div>

                          {/* Itens */}
                          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                            {ord.items.map((it) => (
                              <div key={it.id} className="flex justify-between gap-2 text-[11px] leading-snug">
                                <div className="min-w-0">
                                  <span className="font-extrabold text-[#1C1917]">{it.quantity}x</span>{' '}
                                  <span className="text-[#1C1917] font-semibold break-words">{it.product.name}</span>
                                  {it.size && (
                                    <span className="text-[10px] text-[#57534E]"> ({it.size})</span>
                                  )}
                                  {it.isFree && (
                                    <span className="text-[9px] text-[#059669] font-black ml-1">GRÁTIS</span>
                                  )}
                                  {it.comboChoices && it.comboChoices.length > 0 && (
                                    <span className="block text-[9px] text-[#D97706]">
                                      {it.comboChoices.map((c) => `${c.slotLabel}: ${c.optionLabel}`).join(' • ')}
                                    </span>
                                  )}
                                  {it.selectedExtras.length > 0 && (
                                    <span className="block text-[9px] text-[#A8A29E]">
                                      + {it.selectedExtras.map((e) => e.name).join(', ')}
                                    </span>
                                  )}
                                </div>
                                <span className="font-bold text-[#1C1917] shrink-0">
                                  R$ {it.itemTotalPrice.toFixed(2)}
                                </span>
                              </div>
                            ))}
                          </div>

                          {ord.items.some((it) => it.observation) && (
                            <div className="text-[10px] text-[#92400E] bg-[#FEF3C7] border border-[#FCD34D] rounded-lg p-1.5 break-words">
                              📝 {ord.items.map((it) => it.observation).filter(Boolean).join(' | ')}
                            </div>
                          )}

                          {/* Ações */}
                          <div className="space-y-1.5 pt-1 mt-auto">
                            {ord.status === 'recebido' && (
                              <button
                                onClick={() => updateOrderStatus(ord.id, 'em_preparo')}
                                className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-bold py-2 rounded-full text-xs shadow-xs transition"
                              >
                                Aceitar Pedido ✓
                              </button>
                            )}

                            {ord.status === 'em_preparo' && (
                              <button
                                onClick={() => updateOrderStatus(ord.id, 'pronto')}
                                className="w-full bg-[#D97706] hover:bg-[#B45309] text-white font-bold py-2 rounded-full text-xs shadow-xs transition"
                              >
                                Finalizar & Marcar Pronto 🍲
                              </button>
                            )}

                            {ord.status === 'pronto' && (
                              <span className="text-[11px] text-[#7C3AED] font-extrabold block text-center w-full py-1 flex items-center justify-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-[#7C3AED] animate-ping" />
                                Aguardando motoboy aceitar
                              </span>
                            )}

                            {ord.status === 'saiu_entrega' && (
                              <span className="text-[11px] text-[#9333EA] font-extrabold block text-center w-full py-1">
                                🛵 Em entrega (acompanhe no mapa do cliente)
                              </span>
                            )}

                            {ord.status === 'entregue' && (
                              <span className="text-[11px] text-[#059669] font-extrabold block text-center w-full py-1">
                                ✓ Pedido Entregue
                              </span>
                            )}

                            {ord.status === 'cancelado' && (
                              <span className="text-[11px] text-[#78716C] font-extrabold block text-center w-full py-1">
                                — Pedido cancelado
                              </span>
                            )}

                            {!ord.payment.isPaid && ord.status !== 'cancelado' && ord.status !== 'entregue' && (
                              <button
                                onClick={() => confirmPayment(ord.id)}
                                className="w-full bg-[#059669] hover:bg-[#047857] text-white font-bold py-1.5 rounded-full text-[10px] shadow-xs transition flex items-center justify-center gap-1"
                              >
                                <Check className="w-3 h-3" />
                                Confirmar pagamento ({ord.payment.method.toUpperCase()})
                              </button>
                            )}

                            {['recebido', 'em_preparo', 'pronto', 'saiu_entrega'].includes(ord.status) && (
                              <button
                                onClick={() => {
                                  const reason = window.prompt(
                                    `Motivo do cancelamento do pedido ${ord.id}:`,
                                    'Cancelado pela loja'
                                  );
                                  if (reason !== null) cancelOrder(ord.id, reason.trim() || 'Cancelado pela loja');
                                }}
                                className="w-full py-1.5 rounded-full border border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] text-[10px] font-bold transition hover:bg-[#FEE2E2]"
                              >
                                Cancelar pedido
                              </button>
                            )}
                          </div>
                            </>
                          )}
                        </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------- CARDÁPIO ---------- */}
      {activeTab === 'cardapio' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-[#1C1917]">Controle de Cardápio & Estoque</h3>
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold px-4 py-2.5 rounded-full text-xs flex items-center gap-1.5 shadow-sm transition"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Novo Produto</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((p) => (
              <div
                key={p.id}
                className={`bg-white rounded-2xl p-4 border transition flex flex-col justify-between shadow-xs ${
                  p.available ? 'border-[#E7E5E4]' : 'border-[#FCA5A5] opacity-60'
                }`}
              >
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <img
                      src={p.image}
                      alt={p.name}
                      className="w-14 h-14 rounded-2xl object-cover shrink-0 bg-[#F5F5F4]"
                    />
                    <div>
                      <h4 className="font-extrabold text-sm text-[#1C1917] line-clamp-1">{p.name}</h4>
                      <span className="text-[10px] text-[#57534E] uppercase font-bold">{p.category}</span>
                      {p.isCaldinhoDoDia && (
                        <span className="text-[10px] text-[#B91C1C] font-extrabold block">
                          🔥 Caldinho do Dia
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs bg-[#F5F5F4] p-2.5 rounded-2xl border border-[#E7E5E4] mb-3">
                    <span className="text-[#57534E] font-bold">Preço Base:</span>
                    <PriceInput product={p} />
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t border-[#F5F5F4]">
                  <button
                    onClick={() => toggleProductAvailability(p.id)}
                    className={`flex-1 py-2 rounded-full text-xs font-bold flex items-center justify-center gap-1 transition ${
                      p.available
                        ? 'bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0] hover:bg-[#D1FAE5]'
                        : 'bg-[#FEF2F2] text-[#B91C1C] border border-[#FCA5A5] hover:bg-[#FEE2E2]'
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>{p.available ? 'Em Estoque' : 'Pausado'}</span>
                  </button>

                  {p.category === 'caldinhos' && (
                    <button
                      onClick={() => setCaldinhoDoDia(p.id)}
                      className={`p-2 rounded-full border transition ${
                        p.isCaldinhoDoDia
                          ? 'bg-[#B91C1C] text-white border-[#B91C1C]'
                          : 'bg-[#F5F5F4] text-[#D97706] border-[#E7E5E4] hover:bg-[#E7E5E4]'
                      }`}
                      title="Definir como Caldinho do Dia"
                    >
                      <Flame className="w-4 h-4" />
                    </button>
                  )}

                  <label
                    className="p-2 rounded-full border border-[#E7E5E4] bg-[#F5F5F4] text-[#1C1917] hover:bg-[#E7E5E4] transition cursor-pointer"
                    title="Enviar imagem do produto"
                  >
                    <Camera className="w-4 h-4" />
                    <input
                      type="file"
                      accept={ACCEPTED_IMAGE_TYPES}
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        const invalid = validateImageFile(f);
                        if (invalid) {
                          triggerToast(invalid);
                          return;
                        }
                        try {
                          const dataUrl = await resizeImage(f);
                          const url = await uploadImage(dataUrl, 'produto-' + p.id);
                          if (url) updateProductImage(p.id, url);
                        } catch (err) {
                          triggerToast(err instanceof Error ? err.message : 'Erro ao enviar imagem.');
                        }
                      }}
                    />
                  </label>
                  <button
                    onClick={() => setEditingProduct(p)}
                    className="p-2 rounded-full border border-[#E7E5E4] bg-[#F5F5F4] text-[#1C1917] hover:bg-[#E7E5E4] transition"
                    title="Editar produto"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmDeleteProduct(p)}
                    className="p-2 rounded-full border border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] hover:bg-[#FEE2E2] transition"
                    title="Excluir produto"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- CATEGORIAS (editáveis) ---------- */}
      {activeTab === 'categorias' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-[#1C1917]">Categorias do Cardápio</h3>
            <button
              onClick={() =>
                saveCategory({
                  id: 'cat-' + Date.now(),
                  label: 'Nova Categoria',
                  emoji: '🍽️',
                  color: '#B91C1C',
                  sort: catList.length,
                })
              }
              className="bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold px-4 py-2.5 rounded-full text-xs flex items-center gap-1.5 shadow-sm transition"
            >
              <PlusCircle className="w-4 h-4" />
              Nova Categoria
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {catList.map((cat, i) => (
              <CategoryEditorRow
                key={cat.id}
                cat={cat}
                productCount={products.filter((p) => p.category === cat.id).length}
                isFirst={i === 0}
                isLast={i === catList.length - 1}
                onSave={saveCategory}
                onDelete={deleteCategory}
                onMove={moveCategory}
              />
            ))}
          </div>

          <p className="text-xs text-[#57534E]">
            Renomeie, troque o emoji e a cor, reordene e crie novas categorias. As mudanças aparecem na
            hora no cardápio do cliente.
          </p>
        </div>
      )}

      {/* ---------- CLIENTES ---------- */}
      {activeTab === 'clientes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-[#1C1917] flex items-center gap-2">
              <Users className="w-5 h-5 text-[#B91C1C]" />
              <span>Clientes</span>
            </h3>
            <span className="text-xs text-[#57534E] font-bold">{customers.length} cadastrados</span>
          </div>

          {customers.length === 0 ? (
            <p className="text-xs text-[#A8A29E] italic">Nenhum cliente ainda. Os clientes aparecem aqui após o primeiro pedido.</p>
          ) : (
            <div className="bg-white rounded-2xl border border-[#E7E5E4] shadow-xs overflow-hidden">
              <div className="divide-y divide-[#F5F5F4]">
                {customers.map((c) => (
                  <div key={c.phone || c.name} className="flex items-center gap-3 p-4">
                    <div className="w-10 h-10 rounded-full bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center font-extrabold text-sm shrink-0">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-extrabold text-sm text-[#1C1917]">{c.name}</div>
                      <div className="text-[11px] text-[#57534E]">{c.phone || '—'}</div>
                    </div>
                    <div className="text-center shrink-0">
                      <div className="font-extrabold text-sm text-[#1C1917]">{c.orderCount}</div>
                      <div className="text-[9px] text-[#57534E] uppercase font-bold">Pedidos</div>
                    </div>
                    <div className="text-center shrink-0 w-20">
                      <div className="font-extrabold text-sm text-[#B91C1C]">R$ {c.total.toFixed(2)}</div>
                      <div className="text-[9px] text-[#57534E] uppercase font-bold">Gasto</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- MOTOBOYS ---------- */}
      {activeTab === 'motoboys' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-[#1C1917] flex items-center gap-2">
              <Bike className="w-5 h-5 text-[#B91C1C]" />
              <span>Motoboys</span>
            </h3>
            <button
              onClick={openCreateDriver}
              className="bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold px-4 py-2.5 rounded-full text-xs flex items-center gap-1.5 shadow-sm transition"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Novo Motoboy</span>
            </button>
          </div>

          {drivers.length === 0 ? (
            <p className="text-xs text-[#A8A29E] italic">
              Nenhum motoboy cadastrado. Cadastre o primeiro para receber novas corridas.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {drivers.map((d) => (
                <div
                  key={d.id}
                  className={`bg-white rounded-2xl p-4 border shadow-xs transition ${
                    d.active ? 'border-[#E7E5E4]' : 'border-[#FCA5A5] opacity-70'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 rounded-full bg-[#1C1917] text-white flex items-center justify-center shrink-0">
                      <Bike className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-extrabold text-sm text-[#1C1917] truncate">{d.name}</h4>
                        <span
                          className={`text-[9px] font-black px-2 py-0.5 rounded-full shrink-0 ${
                            d.online
                              ? 'bg-[#ECFDF5] text-[#059669]'
                              : d.active
                              ? 'bg-[#FEF3C7] text-[#B45309]'
                              : 'bg-[#FEF2F2] text-[#B91C1C]'
                          }`}
                        >
                          {d.online ? 'ONLINE' : d.active ? 'ATIVO' : 'INATIVO'}
                        </span>
                      </div>
                      <span className="text-[10px] text-[#57534E]">{d.phone || '—'}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-[11px] text-[#57534E] bg-[#F5F5F4] rounded-2xl border border-[#E7E5E4] p-3 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base">🏍️</span>
                      <span className="font-bold text-[#1C1917]">{d.bikeModel || 'Modelo não informado'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-base">🔖</span>
                      <span className="font-bold text-[#1C1917] font-mono tracking-wider">{d.plate || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-base">🔑</span>
                      <span>
                        Senha de acesso: <strong className="font-mono text-[#1C1917]">••••</strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditDriver(d)}
                      className="flex-1 py-2 rounded-full text-xs font-bold flex items-center justify-center gap-1 transition bg-[#F5F5F4] text-[#1C1917] border border-[#E7E5E4] hover:bg-[#E7E5E4]"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Editar</span>
                    </button>
                    <button
                      onClick={() => updateDriver(d.id, { active: !d.active })}
                      className={`p-2 rounded-full border transition ${
                        d.active
                          ? 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0] hover:bg-[#D1FAE5]'
                          : 'bg-[#FEF2F2] text-[#B91C1C] border-[#FCA5A5] hover:bg-[#FEE2E2]'
                      }`}
                      title={d.active ? 'Desativar motoboy' : 'Ativar motoboy'}
                    >
                      <PowerToggle className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteDriver(d)}
                      className="p-2 rounded-full border border-[#FCA5A5] text-[#B91C1C] bg-[#FEF2F2] hover:bg-[#FEE2E2] transition"
                      title="Excluir motoboy"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- PROMOÇÕES ---------- */}
      {activeTab === 'promocoes' && (
        <div className="space-y-4">
          <h3 className="text-lg font-extrabold text-[#1C1917] flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-[#B91C1C]" />
            <span>Promoções</span>
          </h3>

          <PromoDoDiaCard
            products={products}
            setCaldinhoDoDia={setCaldinhoDoDia}
            uploadImage={uploadImage}
            updateProductImage={updateProductImage}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {products.filter((p) => p.isPopular || p.isFlashPromo || p.isCaldinhoDoDia).length === 0 ? (
              <p className="text-xs text-[#A8A29E] italic sm:col-span-2">
                Nenhuma promoção ativa. Marque o Caldinho do Dia no cardápio para destacar um item.
              </p>
            ) : (
              products
                .filter((p) => p.isPopular || p.isFlashPromo || p.isCaldinhoDoDia)
                .map((p) => (
                  <div key={p.id} className="bg-white rounded-2xl p-4 border border-[#E7E5E4] shadow-xs flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <img src={p.image} alt={p.name} className="w-16 h-16 rounded-2xl object-cover shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-extrabold text-sm text-[#1C1917] line-clamp-1">{p.name}</h4>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {p.isCaldinhoDoDia && (
                            <span className="text-[9px] font-bold text-[#B91C1C] bg-[#FEF2F2] px-2 py-0.5 rounded-full">🔥 Destaque</span>
                          )}
                          {p.isFlashPromo && (
                            <span className="text-[9px] font-bold text-[#D97706] bg-[#FFFBEB] px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Zap className="w-2.5 h-2.5" /> Flash
                            </span>
                          )}
                          {p.isPopular && (
                            <span className="text-[9px] font-bold text-[#7C3AED] bg-[#F5F3FF] px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Star className="w-2.5 h-2.5" /> Popular
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-extrabold text-sm text-[#B91C1C]">R$ {p.basePrice.toFixed(2)}</div>
                        {p.originalPrice && (
                          <div className="text-[10px] text-[#A8A29E] line-through">R$ {p.originalPrice.toFixed(2)}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2 border-t border-[#F5F5F4]">
                      <button
                        onClick={() => setEditingProduct(p)}
                        className="flex-1 py-2 rounded-full border border-[#E7E5E4] bg-[#F5F5F4] text-[#1C1917] text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-[#E7E5E4] transition"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Editar
                      </button>
                      <button
                        onClick={() => {
                          if (!window.confirm(`Remover a promoção de "${p.name}"?`)) return;
                          updateProduct(p.id, {
                            isPopular: false,
                            isFlashPromo: false,
                            originalPrice: null,
                            isCaldinhoDoDia: false,
                          });
                        }}
                        className="flex-1 py-2 rounded-full border border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-[#FEE2E2] transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Excluir promoção
                      </button>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {/* ---------- CUPONS ---------- */}
      {activeTab === 'cupons' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-[#1C1917] flex items-center gap-2">
              <Ticket className="w-5 h-5 text-[#B91C1C]" />
              <span>Cupons de Desconto</span>
            </h3>
            <span className="text-xs text-[#57534E] font-bold">{coupons.length} ativos</span>
          </div>

          <CouponForm saveCoupon={saveCoupon} />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {coupons.map((c: Coupon) => (
              <div key={c.code} className="relative bg-white rounded-2xl border border-dashed border-[#B91C1C]/40 p-4 shadow-xs overflow-hidden">
                <button
                  onClick={() => {
                    if (window.confirm(`Excluir o cupom ${c.code}?`)) deleteCoupon(c.code);
                  }}
                  className="absolute top-2 right-2 p-1.5 rounded-full text-[#A8A29E] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition"
                  title="Excluir cupom"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <div className="flex items-start justify-between gap-2">
                  <div className="rounded-lg bg-[#B91C1C] text-white font-black text-xs px-3 py-1.5 tracking-wide">
                    {c.code}
                  </div>
                  <div className="text-xs font-extrabold text-[#B91C1C]">
                    {c.discountPercent
                      ? `${c.discountPercent}% OFF`
                      : c.discountFixed
                        ? `-R$ ${c.discountFixed.toFixed(2)}`
                        : '—'}
                  </div>
                </div>
                <p className="text-[11px] text-[#57534E] mt-2">{c.description}</p>
                <p className="text-[10px] text-[#A8A29E] mt-1">
                  Pedido mínimo: R$ {c.minOrderValue.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- FINANCEIRO ---------- */}
      {activeTab === 'financeiro' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-extrabold text-[#1C1917] flex items-center gap-2">
              <Wallet className="w-5 h-5 text-[#B91C1C]" />
              <span>Financeiro</span>
            </h3>

            {/* Seletor de período do gráfico */}
            <div className="flex items-center gap-1 bg-[#F5F5F4] border border-[#E7E5E4] rounded-full p-1">
              {(
                [
                  { id: 'daily', label: 'Diário' },
                  { id: 'weekly', label: 'Semanal' },
                  { id: 'monthly', label: 'Mensal' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setFinancePeriod(opt.id)}
                  className={`px-4 py-1.5 rounded-full text-[11px] font-extrabold transition ${
                    financePeriod === opt.id
                      ? 'bg-[#1C1917] text-white shadow-sm'
                      : 'text-[#57534E] hover:text-[#1C1917]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Card de faturamento com gráfico */}
          <div className="bg-white rounded-2xl p-5 border border-[#E7E5E4] shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-extrabold text-[#1C1917]">Faturamento</h4>
              <span className="text-[10px] text-[#57534E] font-bold bg-[#F5F5F4] border border-[#E7E5E4] px-2.5 py-1 rounded-full">
                {financePeriod === 'daily'
                  ? 'últimos 30 dias'
                  : financePeriod === 'weekly'
                  ? 'últimas 12 semanas'
                  : 'últimos 12 meses'}
              </span>
            </div>

            {!trends ? (
              <div className="h-48 bg-[#F5F5F4] rounded-2xl border border-[#E7E5E4] flex items-center justify-center text-xs text-[#A8A29E]">
                Carregando dados...
              </div>
            ) : (
              <RevenueChart
                points={
                  financePeriod === 'daily'
                    ? trends.daily
                    : financePeriod === 'weekly'
                    ? trends.weekly
                    : trends.monthly
                }
                periodLabel={
                  financePeriod === 'daily'
                    ? 'diário'
                    : financePeriod === 'weekly'
                    ? 'semanal'
                    : 'mensal'
                }
              />
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Vendas por forma de pagamento */}
            <div className="bg-white rounded-2xl p-5 border border-[#E7E5E4] shadow-xs">
              <h4 className="text-sm font-extrabold text-[#1C1917] mb-3">Vendas por Forma de Pagamento</h4>
              <div className="space-y-3">
                {([
                  { key: 'pix' as const, label: 'PIX', value: paymentBreakdown('pix'), color: 'bg-[#059669]' },
                  { key: 'card' as const, label: 'Cartão', value: paymentBreakdown('card'), color: 'bg-[#2563EB]' },
                  { key: 'cash' as const, label: 'Dinheiro', value: paymentBreakdown('cash'), color: 'bg-[#D97706]' },
                ] as const).map((m) => (
                  <div key={m.key}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-bold text-[#1C1917]">{m.label}</span>
                      <span className="font-extrabold text-[#1C1917]">R$ {m.value.toFixed(2)}</span>
                    </div>
                    <div className="h-2.5 bg-[#F5F5F4] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${m.color} transition-all`}
                        style={{ width: `${totalRevenue > 0 ? (m.value / totalRevenue) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Resumo geral */}
            <div className="bg-white rounded-2xl p-5 border border-[#E7E5E4] shadow-xs">
              <h4 className="text-sm font-extrabold text-[#1C1917] mb-3">Resumo Geral</h4>
              <div className="space-y-3">
                {[
                  { label: 'Faturamento total', value: `R$ ${totalRevenue.toFixed(2)}` },
                  { label: 'Pedidos (não cancelados)', value: String(totalCompletedOrders) },
                  { label: 'Ticket médio', value: `R$ ${avgTicket.toFixed(2)}` },
                  { label: 'Vendas hoje', value: `R$ ${todayRevenue.toFixed(2)}` },
                  { label: 'Pedidos hoje', value: String(todayOrders) },
                  {
                    label: 'Pagamentos pendentes',
                    value: String(
                      orders.filter(
                        (o) => !o.payment.isPaid && o.status !== 'cancelado' && o.status !== 'entregue'
                      ).length
                    ),
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between bg-[#F5F5F4]/70 rounded-xl px-3 py-2.5 border border-[#E7E5E4]"
                  >
                    <span className="text-xs font-bold text-[#57534E]">{row.label}</span>
                    <span className="text-xs font-extrabold text-[#1C1917]">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- RELATÓRIOS ---------- */}
      {activeTab === 'relatorios' && (
        <div className="bg-white rounded-2xl p-6 border border-[#E7E5E4] space-y-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-extrabold text-[#1C1917] flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#B91C1C]" />
              <span>Relatório de Desempenho & Vendas</span>
            </h3>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const today = new Date();
                  setReportFrom(new Date(today.getTime() - 6 * 86400000).toLocaleDateString('en-CA'));
                  setReportTo(today.toLocaleDateString('en-CA'));
                  loadReport(
                    new Date(today.getTime() - 6 * 86400000).toLocaleDateString('en-CA'),
                    today.toLocaleDateString('en-CA')
                  );
                }}
                className="px-3 py-1.5 rounded-full bg-[#F5F5F4] border border-[#E7E5E4] text-[10px] font-bold text-[#1C1917] hover:bg-[#E7E5E4] transition"
              >
                7 dias
              </button>
              <button
                onClick={() => {
                  const today = new Date();
                  setReportFrom(today.toLocaleDateString('en-CA'));
                  setReportTo(today.toLocaleDateString('en-CA'));
                  loadReport(today.toLocaleDateString('en-CA'), today.toLocaleDateString('en-CA'));
                }}
                className="px-3 py-1.5 rounded-full bg-[#F5F5F4] border border-[#E7E5E4] text-[10px] font-bold text-[#1C1917] hover:bg-[#E7E5E4] transition"
              >
                Hoje
              </button>
              <input
                type="date"
                value={reportFrom}
                onChange={(e) => setReportFrom(e.target.value)}
                className="bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl px-2.5 py-1.5 text-[11px] text-[#1C1917]"
              />
              <span className="text-[10px] text-[#57534E] font-bold">até</span>
              <input
                type="date"
                value={reportTo}
                onChange={(e) => setReportTo(e.target.value)}
                className="bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl px-2.5 py-1.5 text-[11px] text-[#1C1917]"
              />
              <button
                onClick={() => loadReport(reportFrom, reportTo)}
                className="px-4 py-1.5 rounded-full bg-[#B91C1C] text-white text-[11px] font-extrabold hover:bg-[#991B1B] transition flex items-center gap-1.5"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                Gerar
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#F5F5F4] p-4 rounded-2xl border border-[#E7E5E4] text-center">
              <span className="text-xs text-[#57534E] uppercase font-bold">Total Faturado</span>
              <div className="font-extrabold text-2xl text-[#1C1917] mt-1">
                R$ {(report?.totalRevenue ?? 0).toFixed(2)}
              </div>
            </div>

            <div className="bg-[#F5F5F4] p-4 rounded-2xl border border-[#E7E5E4] text-center">
              <span className="text-xs text-[#57534E] uppercase font-bold">Total de Pedidos</span>
              <div className="font-extrabold text-2xl text-[#1C1917] mt-1">
                {report?.totalOrders ?? 0}
              </div>
            </div>

            <div className="bg-[#F5F5F4] p-4 rounded-2xl border border-[#E7E5E4] text-center">
              <span className="text-xs text-[#57534E] uppercase font-bold">Ticket Médio</span>
              <div className="font-extrabold text-2xl text-[#B91C1C] mt-1">
                R$ {(report?.avgTicket ?? 0).toFixed(2)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs font-bold text-[#1C1917] uppercase tracking-wider mb-3">
                Distribuição de Pedidos por Horário
              </h4>
              {!report || report.hourlyDistribution.length === 0 ? (
                <div className="h-44 bg-[#F5F5F4] rounded-2xl border border-[#E7E5E4] flex items-center justify-center text-xs text-[#A8A29E]">
                  Sem pedidos no período selecionado.
                </div>
              ) : (
                <div className="h-44 bg-[#F5F5F4] p-4 rounded-2xl border border-[#E7E5E4] flex items-end justify-between gap-2 overflow-x-auto">
                  {report.hourlyDistribution.map((bar) => {
                    const max = Math.max(...report.hourlyDistribution.map((b) => b.orders), 1);
                    return (
                      <div key={bar.hour} className="flex-1 min-w-[28px] flex flex-col items-center gap-1 group">
                        <span className="text-[9px] text-[#1C1917] font-bold group-hover:text-[#B91C1C]">
                          {bar.orders}
                        </span>
                        <div
                          className="w-full bg-[#B91C1C] rounded-t-lg transition-all group-hover:bg-[#991B1B]"
                          style={{ height: `${(bar.orders / max) * 100}%`, minHeight: 4 }}
                        />
                        <span className="text-[9px] text-[#57534E] font-mono">{bar.hour}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-xs font-bold text-[#1C1917] uppercase tracking-wider mb-3">
                Produtos Mais Vendidos
              </h4>
              {!report || report.topSellingProducts.length === 0 ? (
                <div className="h-44 bg-[#F5F5F4] rounded-2xl border border-[#E7E5E4] flex items-center justify-center text-xs text-[#A8A29E]">
                  Sem vendas no período selecionado.
                </div>
              ) : (
                <div className="h-44 overflow-y-auto bg-[#F5F5F4] rounded-2xl border border-[#E7E5E4] divide-y divide-[#E7E5E4]">
                  {report.topSellingProducts.map((p, i) => (
                    <div key={p.name} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-[11px] font-black text-[#B91C1C] w-5">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-bold text-[#1C1917] truncate">{p.name}</div>
                        <div className="text-[10px] text-[#57534E]">{p.count} un • R$ {p.total.toFixed(2)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------- CONFIGURAÇÕES ---------- */}
      {activeTab === 'config' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-[#1C1917] flex items-center gap-2">
              <Settings className="w-5 h-5 text-[#B91C1C]" />
              <span>Configurações</span>
            </h3>
            <button
              onClick={() =>
                saveSettings({
                  storeName: configDraft.storeName,
                  city: configDraft.city,
                  storeLat: configDraft.storeLat,
                  storeLng: configDraft.storeLng,
                  deliveryPricePerKm: configDraft.deliveryPricePerKm,
                  deliveryBaseFee: configDraft.deliveryBaseFee,
                  deliveryMinFee: configDraft.deliveryMinFee,
                  freeDeliveryAbove: configDraft.freeDeliveryAbove,
                  maxDeliveryKm: configDraft.maxDeliveryKm,
                  minOrderValue: configDraft.minOrderValue,
                  routeFactor: configDraft.routeFactor,
                  driverFeePerDelivery: configDraft.driverFeePerDelivery,
                  pixKey: configDraft.pixKey,
                  pixMerchantName: configDraft.pixMerchantName,
                  pixMerchantCity: configDraft.pixMerchantCity,
                  storeWhatsApp: configDraft.storeWhatsApp,
                  orderSoundUrl: configDraft.orderSoundUrl,
                  openingHours: configDraft.openingHours,
                  orderEnabled: configDraft.orderEnabled,
                  forceOpen: configDraft.forceOpen,
                  backupEnabled: configDraft.backupEnabled,
                  backupFrequencyDays: configDraft.backupFrequencyDays,
                  backupFolderId: configDraft.backupFolderId,
                  ...(configDraft.backupServiceAccount.trim()
                    ? { backupServiceAccount: configDraft.backupServiceAccount.trim() }
                    : {}),
                  ...(configDraft.kitchenPin ? { kitchenPin: configDraft.kitchenPin } : {}),
                })
              }
              className="bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold px-5 py-2.5 rounded-full text-xs flex items-center gap-1.5 shadow-sm transition active:scale-95"
            >
              <Check className="w-4 h-4" />
              <span>Salvar Alterações</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 items-start">
            <div className="bg-white rounded-2xl p-3 border border-[#E7E5E4] shadow-xs space-y-2">
              <h4 className="text-sm font-extrabold text-[#1C1917]">Loja</h4>

              <StoreLogoUpload
                logo={storeLogo}
                uploadImage={uploadImage}
                setStoreLogo={setStoreLogo}
              />

              <div>
                <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">Nome da Loja</label>
                <input
                  type="text"
                  value={configDraft.storeName}
                  onChange={(e) => setCfg('storeName', e.target.value)}
                  placeholder="Caldinho Express"
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">Cidade de Entrega</label>
                <input
                  type="text"
                  value={configDraft.city}
                  onChange={(e) => setCfg('city', e.target.value)}
                  placeholder="Recife - PE"
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#57534E] mb-0.5 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-[#B91C1C]" />
                  Local da Loja (CEP, endereço ou pino no mapa)
                </label>

                <div className="space-y-1.5 mb-1.5">
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={storeCep}
                      onChange={(e) => setStoreCep(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder="CEP da loja (ex: 51011040)"
                      className="flex-1 bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                    />
                    <button
                      type="button"
                      onClick={handleStoreCepLookup}
                      disabled={storeLocating}
                      className="px-3.5 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] text-white text-[11px] font-extrabold flex items-center gap-1.5 transition disabled:opacity-50 shrink-0"
                    >
                      {storeLocating ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <LocateFixed className="w-3.5 h-3.5" />
                      )}
                      Buscar CEP
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={storeAddress}
                      onChange={(e) => setStoreAddress(e.target.value)}
                      placeholder="Ou digite o endereço: Av. Conselheiro Aguiar, 500 - Pina"
                      className="flex-1 bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                    />
                    <button
                      type="button"
                      onClick={handleStoreAddressLookup}
                      disabled={storeLocating}
                      className="px-3.5 rounded-xl bg-[#1C1917] hover:bg-[#292524] text-white text-[11px] font-extrabold flex items-center gap-1.5 transition disabled:opacity-50 shrink-0"
                    >
                      <LocateFixed className="w-3.5 h-3.5" />
                      Localizar
                    </button>
                  </div>
                  {storeLocateLabel && (
                    <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl p-2 text-[10px] font-bold text-[#065F46] break-words">
                      📍 {storeLocateLabel}
                    </div>
                  )}
                  {storeLocateError && (
                    <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl p-2 text-[10px] font-bold text-[#B91C1C] break-words">
                      {storeLocateError}
                    </div>
                  )}
                </div>

                <LiveMap
                  pickPosition={{ lat: configDraft.storeLat, lng: configDraft.storeLng }}
                  onPick={(lat, lng) => {
                    setCfg('storeLat', lat);
                    setCfg('storeLng', lng);
                    setStoreLocateLabel('');
                  }}
                  heightClass="h-28"
                />
                <div className="flex gap-2 mt-2">
                  <input
                    type="number"
                    step="any"
                    value={configDraft.storeLat}
                    onChange={(e) => setCfg('storeLat', Number(e.target.value))}
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2 text-xs text-[#1C1917] font-mono"
                    placeholder="Latitude"
                  />
                  <input
                    type="number"
                    step="any"
                    value={configDraft.storeLng}
                    onChange={(e) => setCfg('storeLng', Number(e.target.value))}
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2 text-xs text-[#1C1917] font-mono"
                    placeholder="Longitude"
                  />
                </div>
                <p className="text-[10px] text-[#A8A29E] mt-1">
                  O mapa e a distância das entregas são calculados a partir deste ponto.
                </p>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-3 border border-[#E7E5E4] shadow-xs space-y-2">
              <h4 className="text-sm font-extrabold text-[#1C1917] flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#B91C1C]" />
                Horário de Funcionamento
              </h4>

              <div className="flex items-center justify-between p-2 rounded-xl bg-[#F5F5F4] border border-[#E7E5E4]">
                <div>
                  <div className="text-xs font-bold text-[#1C1917]">
                    {configDraft.orderEnabled ? 'Loja aberta para pedidos' : 'Loja fechada para pedidos'}
                  </div>
                  <div className="text-[10px] text-[#57534E]">Chave geral (desliga os pedidos imediatamente)</div>
                </div>
                <button
                  onClick={() => {
                    const opening = !configDraft.orderEnabled;
                    setCfg('orderEnabled', opening);
                    if (opening) setCfg('forceOpen', true);
                  }}
                  className={`w-12 h-7 rounded-full transition relative shrink-0 ${
                    configDraft.orderEnabled ? 'bg-[#059669]' : 'bg-[#D6D3D1]'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${
                      configDraft.orderEnabled ? 'left-6' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between p-2 rounded-xl bg-[#F5F5F4] border border-[#E7E5E4]">
                <div>
                  <div className="text-xs font-bold text-[#1C1917]">
                    {configDraft.forceOpen ? 'Aberta agora (ignorando horário)' : 'Seguindo horário de funcionamento'}
                  </div>
                  <div className="text-[10px] text-[#57534E]">
                    Abrir manualmente tem prioridade sobre os horários cadastrados
                  </div>
                </div>
                <button
                  onClick={() => setCfg('forceOpen', !configDraft.forceOpen)}
                  className={`w-12 h-7 rounded-full transition relative shrink-0 ${
                    configDraft.forceOpen ? 'bg-[#B91C1C]' : 'bg-[#D6D3D1]'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${
                      configDraft.forceOpen ? 'left-6' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              <div className="space-y-1.5">
                {WEEKDAY_NAMES.map((dayName, day) => {
                  const hours = configDraft.openingHours[day];
                  return (
                    <div key={day} className="flex items-center gap-2">
                      <button
                        onClick={() => setCfg(
                          'openingHours',
                          configDraft.openingHours.map((h, i) =>
                            i === day ? (h ? null : { open: '18:00', close: '23:00' }) : h
                          )
                        )}
                        className={`w-16 shrink-0 text-left text-[10px] font-bold px-1.5 py-1 rounded-lg border transition ${
                          hours
                            ? 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]'
                            : 'bg-[#F5F5F4] text-[#A8A29E] border-[#E7E5E4]'
                        }`}
                      >
                        {dayName}
                      </button>
                      {hours ? (
                        <div className="flex items-center gap-1.5 flex-1">
                          <input
                            type="time"
                            value={hours.open}
                            onChange={(e) => {
                              const next = configDraft.openingHours.map((h, i) =>
                                i === day ? { ...h!, open: e.target.value } : h
                              );
                              setCfg('openingHours', next);
                            }}
                            className="flex-1 bg-[#F5F5F4] border border-[#E7E5E4] rounded-lg px-1.5 py-1 text-[10px] text-[#1C1917]"
                          />
                          <span className="text-[10px] text-[#57534E] font-bold">às</span>
                          <input
                            type="time"
                            value={hours.close}
                            onChange={(e) => {
                              const next = configDraft.openingHours.map((h, i) =>
                                i === day ? { ...h!, close: e.target.value } : h
                              );
                              setCfg('openingHours', next);
                            }}
                            className="flex-1 bg-[#F5F5F4] border border-[#E7E5E4] rounded-lg px-1.5 py-1 text-[10px] text-[#1C1917]"
                          />
                        </div>
                      ) : (
                        <span className="text-[10px] text-[#A8A29E] italic flex-1">Fechado — toque para abrir</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-[#A8A29E]">
                Fora do horário, os clientes não conseguem enviar pedidos. Suporta turnos que viram à meia-noite
                (ex: 22:00 às 02:00).
              </p>
            </div>

            <div className="bg-white rounded-2xl p-3 border border-[#E7E5E4] shadow-xs space-y-2">
              <h4 className="text-sm font-extrabold text-[#1C1917] flex items-center gap-2">
                <Wallet className="w-4 h-4 text-[#B91C1C]" />
                Pagamento PIX
              </h4>
              <div>
                <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">
                  Chave PIX (CPF, e-mail, telefone ou aleatória)
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={configDraft.pixKey}
                    onChange={(e) => setCfg('pixKey', e.target.value)}
                    placeholder="Ex: contato@caldinhoexpress.com.br"
                    className="flex-1 bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] font-mono focus:ring-1 focus:ring-[#B91C1C]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCfg('pixKey', generateRandomPixKey());
                      triggerToast('Chave aleatória gerada! Salve as alterações para ativar.');
                    }}
                    title="Gerar chave PIX aleatória (EVP)"
                    className="px-3 rounded-xl bg-[#1C1917] hover:bg-[#292524] text-white text-[11px] font-extrabold flex items-center gap-1.5 transition shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#FDE68A]" />
                    Gerar aleatória
                  </button>
                </div>
                {configDraft.pixKey.trim() && (
                  <>
                    {validatePixKey(configDraft.pixKey) ? (
                      <p className="text-[10px] text-[#B91C1C] font-bold mt-1">
                        ⚠️ {validatePixKey(configDraft.pixKey)}
                      </p>
                    ) : (
                      <p className="text-[10px] text-[#059669] font-bold mt-1">
                        ✓ Chave válida — será usada nos QR Codes dos pedidos
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Pré-visualização: comprova que a chave cadastrada é a que entra no BR Code */}
              {configDraft.pixKey.trim() && !validatePixKey(configDraft.pixKey) && (
                <div className="bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 space-y-1.5">
                  <div className="text-[10px] font-extrabold text-[#1C1917] uppercase tracking-wider">
                    Prévia do PIX (copia e cola) — sua chave em destaque:
                  </div>
                  {normalizePixKey(configDraft.pixKey) !== configDraft.pixKey.trim() && (
                    <div className="text-[9px] text-[#92400E] font-bold bg-[#FEF3C7] border border-[#FCD34D] rounded-lg px-2 py-1 break-all">
                      Pontuação removida automaticamente: {configDraft.pixKey.trim()} →{' '}
                      {normalizePixKey(configDraft.pixKey)}
                    </div>
                  )}
                  <div className="text-[9px] font-mono text-[#57534E] break-all leading-relaxed">
                    {generatePixCopyPaste({
                      pixKey: configDraft.pixKey,
                      amount: 10,
                      merchantName: configDraft.pixMerchantName || 'LOJA',
                      merchantCity: configDraft.pixMerchantCity || 'BRASIL',
                      txid: 'PREVIA',
                    })}
                  </div>
                  <div className="text-[9px] text-[#065F46] font-bold bg-[#ECFDF5] border border-[#A7F3D0] rounded-lg px-2 py-1 break-all">
                    Sua chave no código: {normalizePixKey(configDraft.pixKey)}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">Nome do recebedor</label>
                  <input
                    type="text"
                    value={configDraft.pixMerchantName}
                    onChange={(e) => setCfg('pixMerchantName', e.target.value)}
                    placeholder="Caldinho Express"
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">Cidade do recebedor</label>
                  <input
                    type="text"
                    value={configDraft.pixMerchantCity}
                    onChange={(e) => setCfg('pixMerchantCity', e.target.value)}
                    placeholder="Recife"
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">
                  WhatsApp para receber comprovantes (com DDI)
                </label>
                <input
                  type="text"
                  inputMode="tel"
                  value={configDraft.storeWhatsApp}
                  onChange={(e) => setCfg('storeWhatsApp', e.target.value.replace(/\D/g, '').slice(0, 15))}
                  placeholder="Ex: 5581999990000"
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] font-mono focus:ring-1 focus:ring-[#B91C1C]"
                />
                <p className="text-[10px] text-[#A8A29E] mt-1">
                  O cliente verá o botão "Enviar comprovante no WhatsApp" após o pagamento PIX. Você
                  confirma o pedido no kanban quando receber o comprovante.
                </p>
              </div>
              <p className="text-[10px] text-[#A8A29E]">
                Com a chave cadastrada, o cliente recebe um QR Code PIX real (BR Code válido) no valor exato
                do pedido. A cozinha confirma o pagamento no kanban.
              </p>
            </div>

            <div className="bg-white rounded-2xl p-3 border border-[#E7E5E4] shadow-xs space-y-2">
              <h4 className="text-sm font-extrabold text-[#1C1917] flex items-center gap-2">
                <Wallet className="w-4 h-4 text-[#B91C1C]" />
                Entrega (frete por distância)
              </h4>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">Preço por km (R$)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={configDraft.deliveryPricePerKm}
                    onChange={(e) => setCfg('deliveryPricePerKm', Number(e.target.value))}
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">Taxa base (R$)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={configDraft.deliveryBaseFee}
                    onChange={(e) => setCfg('deliveryBaseFee', Number(e.target.value))}
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">Taxa mínima (R$)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={configDraft.deliveryMinFee}
                    onChange={(e) => setCfg('deliveryMinFee', Number(e.target.value))}
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">Frete grátis acima de (R$)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={configDraft.freeDeliveryAbove}
                    onChange={(e) => setCfg('freeDeliveryAbove', Number(e.target.value))}
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">Raio máximo (km, 0 = ilimitado)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={configDraft.maxDeliveryKm}
                    onChange={(e) => setCfg('maxDeliveryKm', Number(e.target.value))}
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">Pedido mínimo (R$, 0 = sem)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={configDraft.minOrderValue}
                    onChange={(e) => setCfg('minOrderValue', Number(e.target.value))}
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">Fator de rota (ex: 1.35)</label>
                  <input
                    type="number"
                    step="any"
                    min="1"
                    value={configDraft.routeFactor}
                    onChange={(e) => setCfg('routeFactor', Number(e.target.value))}
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">Valor por entrega do motoboy (R$, 0 = taxa do pedido)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={configDraft.driverFeePerDelivery}
                    onChange={(e) => setCfg('driverFeePerDelivery', Number(e.target.value))}
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
              </div>
              <p className="text-[10px] text-[#A8A29E]">
                Fórmula: <strong>taxa = máx(taxa mínima, taxa base + preço/km × km)</strong>. O cliente vê o
                valor exato antes de confirmar o pedido.
              </p>
            </div>

            <div className="bg-white rounded-2xl p-3 border border-[#E7E5E4] shadow-xs space-y-2">
              <h4 className="text-sm font-extrabold text-[#1C1917] flex items-center gap-2">
                <Music className="w-4 h-4 text-[#B91C1C]" />
                Alerta Sonoro do Pedido (áudio personalizado)
              </h4>
              <p className="text-[10px] text-[#A8A29E]">
                Envie um MP3 com a gravação que quiser (ex: "Atenção, novo pedido!"). Ele toca 2 vezes ao
                receber pedido, no lugar da voz do sistema. Sem áudio, a voz feminina padrão continua.
              </p>

              {configDraft.orderSoundUrl ? (
                <div className="space-y-2">
                  <div className="bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 flex items-center gap-3">
                    <Music className="w-5 h-5 text-[#059669] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-extrabold text-[#1C1917]">Áudio personalizado ativo</div>
                      <audio src={configDraft.orderSoundUrl} controls className="w-full h-8 mt-1" />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCfg('orderSoundUrl', '');
                        triggerToast('Áudio removido — a voz do sistema volta a ser usada.');
                      }}
                      className="p-2 rounded-full border border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] hover:bg-[#FEE2E2] transition shrink-0"
                      title="Remover áudio"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <SoundUploadButton
                    onFile={async (dataUrl) => {
                      const url = await uploadImage(dataUrl, 'alerta-pedido');
                      if (url) {
                        setCfg('orderSoundUrl', url);
                        triggerToast('Áudio enviado! Salve as alterações para ativar.');
                      }
                    }}
                  />
                </div>
              ) : (
                <SoundUploadButton
                  onFile={async (dataUrl) => {
                    const url = await uploadImage(dataUrl, 'alerta-pedido');
                    if (url) {
                      setCfg('orderSoundUrl', url);
                      triggerToast('Áudio enviado! Salve as alterações para ativar.');
                    }
                  }}
                />
              )}
              <p className="text-[10px] text-[#A8A29E]">
                Formatos: MP3, WAV, OGG ou WEBM (máx. 15 MB). Grave no celular e envie o arquivo.
              </p>
            </div>

            <div className="bg-white rounded-2xl p-3 border border-[#E7E5E4] shadow-xs space-y-2">
              <h4 className="text-sm font-extrabold text-[#1C1917] flex items-center gap-2">
                <CloudUpload className="w-4 h-4 text-[#B91C1C]" />
                Backup Automático (Google Drive)
              </h4>

              <div className="flex items-center justify-between p-2 rounded-xl bg-[#F5F5F4] border border-[#E7E5E4]">
                <div>
                  <div className="text-xs font-bold text-[#1C1917]">
                    {configDraft.backupEnabled ? 'Backup automático ligado' : 'Backup automático desligado'}
                  </div>
                  <div className="text-[10px] text-[#57534E]">
                    {settings.backupKeySet ? 'Chave do Google cadastrada ✓' : 'Cadastre a chave para ativar'}
                  </div>
                </div>
                <button
                  onClick={() => setCfg('backupEnabled', !configDraft.backupEnabled)}
                  className={`w-12 h-7 rounded-full transition relative shrink-0 ${
                    configDraft.backupEnabled ? 'bg-[#059669]' : 'bg-[#D6D3D1]'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${
                      configDraft.backupEnabled ? 'left-6' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">Frequência</label>
                <select
                  value={configDraft.backupFrequencyDays}
                  onChange={(e) => setCfg('backupFrequencyDays', Number(e.target.value))}
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917]"
                >
                  <option value={1}>Diário</option>
                  <option value={2}>A cada 2 dias</option>
                  <option value={7}>Semanal</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">
                  Chave da conta de serviço (JSON) {settings.backupKeySet ? '— já cadastrada (cole só para trocar)' : ''}
                </label>
                <textarea
                  value={configDraft.backupServiceAccount}
                  onChange={(e) => setCfg('backupServiceAccount', e.target.value)}
                  placeholder='{"type":"service_account","client_email":"...","private_key":"..."}'
                  rows={3}
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-[10px] text-[#1C1917] font-mono resize-none focus:ring-1 focus:ring-[#B91C1C]"
                />
                <p className="text-[9px] text-[#A8A29E] mt-0.5">
                  Segredo: nunca é exibido de volta. Crie em console.cloud.google.com → conta de serviço.
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#57534E] mb-0.5">
                  ID da pasta do Drive (opcional)
                </label>
                <input
                  type="text"
                  value={configDraft.backupFolderId}
                  onChange={(e) => setCfg('backupFolderId', e.target.value)}
                  placeholder="Deixe vazio para salvar na raiz do Drive"
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleRunBackup}
                  disabled={backupRunning || !settings.backupKeySet}
                  className="flex-1 py-2 rounded-full bg-[#1C1917] hover:bg-[#292524] text-white text-[11px] font-extrabold flex items-center justify-center gap-1.5 transition disabled:opacity-40"
                >
                  {backupRunning ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CloudUpload className="w-3.5 h-3.5" />
                  )}
                  {backupRunning ? 'Enviando...' : 'Fazer backup agora'}
                </button>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-bold text-[#1C1917]">
                    {settings.backupLastRun
                      ? new Date(settings.backupLastRun).toLocaleString('pt-BR')
                      : 'Nenhum backup ainda'}
                  </div>
                  <div
                    className={`text-[9px] font-bold ${
                      settings.backupLastStatus === 'ok'
                        ? 'text-[#059669]'
                        : settings.backupLastStatus
                        ? 'text-[#B91C1C]'
                        : 'text-[#A8A29E]'
                    }`}
                  >
                    {settings.backupLastStatus === 'ok'
                      ? `✓ ${settings.backupLastFile}`
                      : settings.backupLastStatus || 'aguardando'}
                  </div>
                </div>
              </div>

              <p className="text-[9px] text-[#A8A29E]">
                O backup inclui o banco (pedidos, cardápio, clientes). Mantém os últimos 15 no Drive.
              </p>
            </div>

            <div className="bg-white rounded-2xl p-3 border border-[#E7E5E4] shadow-xs space-y-2">
              <h4 className="text-sm font-extrabold text-[#1C1917] flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#B91C1C]" />
                Acesso / Segurança
              </h4>
              <div>
                <div className="flex items-center justify-between p-2 rounded-xl bg-[#F5F5F4] border border-[#E7E5E4]">
                  <div>
                    <div className="text-xs font-bold text-[#1C1917]">PIN da Cozinha</div>
                    <div className="text-[10px] text-[#57534E]">
                      {settings.kitchenPinSet ? 'Definido. Digite abaixo para trocar.' : 'Ainda não definido.'}
                    </div>
                  </div>
                  <div className="bg-[#1C1917] text-white font-black text-xs px-3 py-1.5 rounded-lg tracking-[0.3em]">
                    ••••
                  </div>
                </div>
                <input
                  type="password"
                  value={configDraft.kitchenPin}
                  onChange={(e) => setCfg('kitchenPin', e.target.value)}
                  placeholder="Novo PIN (mínimo 4 dígitos) — vazio mantém o atual"
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-1.5 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C] mt-2"
                />
              </div>
              <p className="text-[10px] text-[#A8A29E]">
                O PIN é armazenado com hash (scrypt). Lembre os motoboys de trocar a senha padrão cadastrada.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#57534E]">
            <ChevronRight className="w-3.5 h-3.5 text-[#B91C1C]" />
            <span>
              Cupons, motoboys, produtos e promoções são gerenciados nas abas próprias do painel.
            </span>
          </div>
        </div>
      )}

      {/* ---------- MODAL MOTOBOY ---------- */}
      {driverModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white text-[#1C1917] w-full max-w-md rounded-2xl border border-[#E7E5E4] p-6 shadow-2xl relative">
            <button
              onClick={() => setDriverModalOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-[#F5F5F4] text-[#57534E]"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-extrabold text-[#1C1917] mb-1 flex items-center gap-2">
              <Bike className="w-5 h-5 text-[#B91C1C]" />
              <span>{editingDriver ? 'Editar Motoboy' : 'Cadastrar Motoboy'}</span>
            </h3>
            <p className="text-xs text-[#57534E] mb-4">
              {editingDriver
                ? 'Atualize os dados e a senha de acesso do motoboy.'
                : 'Crie um novo entregador com senha própria para o app.'}
            </p>

            <form onSubmit={handleDriverSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#1C1917] font-bold mb-1">Nome do Motoboy</label>
                <input
                  type="text"
                  value={driverForm.name}
                  onChange={(e) => setDriverForm({ ...driverForm, name: e.target.value })}
                  placeholder="Ex: João Motoboy"
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                  required
                />
              </div>

              <div>
                <label className="block text-[#1C1917] font-bold mb-1 flex items-center gap-1">
                  <Phone className="w-3 h-3 text-[#B91C1C]" />
                  Telefone
                </label>
                <input
                  type="text"
                  value={driverForm.phone}
                  onChange={(e) => setDriverForm({ ...driverForm, phone: e.target.value })}
                  placeholder="(81) 99999-0000"
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                />
              </div>

              <div>
                <label className="block text-[#1C1917] font-bold mb-1 flex items-center gap-1">
                  <KeyRound className="w-3 h-3 text-[#B91C1C]" />
                  Senha de Acesso (PIN)
                </label>
                <input
                  type="password"
                  value={driverForm.password}
                  onChange={(e) => setDriverForm({ ...driverForm, password: e.target.value })}
                  placeholder={editingDriver ? 'Deixe vazio para manter a senha atual' : 'Ex: 1234'}
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C] tracking-[0.3em]"
                  required={!editingDriver}
                />
                <p className="text-[10px] text-[#A8A29E] mt-1">
                  {editingDriver
                    ? 'A senha atual nunca é exibida. Deixe vazio para mantê-la.'
                    : 'O motoboy usa essa senha no app de entregas.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[#1C1917] font-bold mb-1">Modelo da Moto</label>
                  <input
                    type="text"
                    value={driverForm.bikeModel}
                    onChange={(e) => setDriverForm({ ...driverForm, bikeModel: e.target.value })}
                    placeholder="Ex: Honda Biz 125"
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
                <div>
                  <label className="block text-[#1C1917] font-bold mb-1">Placa</label>
                  <input
                    type="text"
                    value={driverForm.plate}
                    onChange={(e) => setDriverForm({ ...driverForm, plate: e.target.value })}
                    placeholder="EX: ABC-1234"
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-2.5 text-[#1C1917] font-mono uppercase focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setDriverModalOpen(false)}
                  className="flex-1 py-2.5 rounded-full bg-[#E7E5E4] text-[#1C1917] font-bold hover:bg-[#D6D3D1]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-full bg-[#B91C1C] text-white font-bold shadow hover:bg-[#991B1B]"
                >
                  {editingDriver ? 'Salvar Alterações' : 'Cadastrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- CONFIRMA EXCLUSÃO MOTOBOY ---------- */}
      {confirmDeleteDriver && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white text-[#1C1917] w-full max-w-sm rounded-2xl border border-[#E7E5E4] p-6 shadow-2xl relative">
            <h3 className="text-lg font-extrabold text-[#1C1917] mb-2">Excluir Motoboy?</h3>
            <p className="text-xs text-[#57534E] mb-5">
              Esta ação remove <strong>{confirmDeleteDriver.name}</strong> permanentemente. Essa operação
              não pode ser desfeita.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteDriver(null)}
                className="flex-1 py-2.5 rounded-full bg-[#E7E5E4] text-[#1C1917] font-bold hover:bg-[#D6D3D1]"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  deleteDriver(confirmDeleteDriver.id);
                  setConfirmDeleteDriver(null);
                }}
                className="flex-1 py-2.5 rounded-full bg-[#B91C1C] text-white font-bold shadow hover:bg-[#991B1B] flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- MODAL NOVO PRODUTO ---------- */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white text-[#1C1917] w-full max-w-md rounded-2xl border border-[#E7E5E4] p-6 shadow-2xl relative">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-[#F5F5F4] text-[#57534E]"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-extrabold text-[#1C1917] mb-4">
              Cadastrar Novo Item no Cardápio
            </h3>
            <form onSubmit={handleCreateProduct} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#1C1917] font-bold mb-1">Nome do Produto</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Caldinho de Peixe da Costa"
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                  required
                />
              </div>

              <div>
                <label className="block text-[#1C1917] font-bold mb-1">Descrição</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Descrição tentadora do produto..."
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-2.5 text-[#1C1917] resize-none h-16 focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                />
              </div>

              <div>
                <label className="block text-[#1C1917] font-bold mb-1">Categoria</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as CategoryId)}
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                >
                  {catList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji} {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[#1C1917] font-bold mb-1">Preço (R$)</label>
                  <input
                    type="number"
                    step="any"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    placeholder="22.90"
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[#1C1917] font-bold mb-1">Tempo de Preparo (min)</label>
                  <input
                    type="number"
                    min="1"
                    value={newPrepTime}
                    onChange={(e) => setNewPrepTime(e.target.value)}
                    placeholder="15"
                    className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
              </div>

              {newCategory === 'combos' && (
                <div>
                  <label className="block text-[#1C1917] font-bold mb-1.5">
                    Sabores do Combo (o cliente escolhe 1 opção por item)
                  </label>
                  <ComboSlotsEditor slots={newComboSlots} onChange={setNewComboSlots} />
                </div>
              )}

              <div>
                <label className="block text-[#1C1917] font-bold mb-1.5">
                  Adicionais / Acompanhamentos (opcional)
                </label>
                <ExtrasEditor extras={newExtras} onChange={setNewExtras} />
              </div>

              <div>
                <label className="block text-[#1C1917] font-bold mb-1">Imagem do Produto</label>
                <div className="flex items-center gap-3">
                  <div
                    onClick={() => newImageRef.current?.click()}
                    className={`relative w-20 h-20 shrink-0 rounded-2xl overflow-hidden border-2 border-dashed transition cursor-pointer group ${
                      newImagePreview ? 'border-[#B91C1C]/40 bg-white' : 'border-[#E7E5E4] bg-[#F5F5F4]'
                    }`}
                  >
                    {newImagePreview ? (
                      <img src={newImagePreview} alt="Produto" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-[#A8A29E]">
                        <ImagePlus className="w-6 h-6" />
                        <span className="text-[9px] font-bold">Sem foto</span>
                      </div>
                    )}
                    {newImageUploading && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <span className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <span className="bg-white/90 text-[#1C1917] text-[9px] font-extrabold px-2 py-1 rounded-full flex items-center gap-1">
                        <Upload className="w-2.5 h-2.5" /> Trocar
                      </span>
                    </div>
                  </div>
                  <input
                    ref={newImageRef}
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleNewProductImage(f);
                      e.target.value = '';
                    }}
                  />
                  <div className="flex-1 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => newImageRef.current?.click()}
                      disabled={newImageUploading}
                      className="w-full bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold py-2.5 rounded-full text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition disabled:opacity-50"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{newImageUploading ? 'Enviando...' : 'Enviar imagem'}</span>
                    </button>
                    <p className="text-[10px] text-[#A8A29E]">PNG, JPG, WEBP ou GIF</p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[#1C1917] font-bold mb-1">URL da Imagem (alternativa ao upload)</label>
                <input
                  type="text"
                  value={newImage.startsWith('data:') ? '' : newImage}
                  onChange={(e) => setNewImage(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                />
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 rounded-full bg-[#E7E5E4] text-[#1C1917] font-bold hover:bg-[#D6D3D1]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-full bg-[#B91C1C] text-white font-bold shadow hover:bg-[#991B1B]"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- MODAL CONFIRMAR EXCLUSÃO DE PRODUTO ---------- */}
      {confirmDeleteProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white text-[#1C1917] w-full max-w-sm rounded-2xl border border-[#E7E5E4] p-6 shadow-2xl relative text-center">
            <div className="w-14 h-14 rounded-full bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-extrabold text-[#1C1917]">Excluir produto?</h3>
            <p className="text-xs text-[#57534E] mt-1 mb-4">
              <strong>{confirmDeleteProduct.name}</strong> será removido do cardápio dos clientes. Essa
              ação não pode ser desfeita.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteProduct(null)}
                className="flex-1 py-2.5 rounded-full bg-[#E7E5E4] text-[#1C1917] font-bold hover:bg-[#D6D3D1] transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  deleteProduct(confirmDeleteProduct.id);
                  setConfirmDeleteProduct(null);
                }}
                className="flex-1 py-2.5 rounded-full bg-[#B91C1C] text-white font-bold hover:bg-[#991B1B] transition"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- MODAL EDITAR PRODUTO ---------- */}
      {editingProduct && (
        <ProductEditModal product={editingProduct} onClose={() => setEditingProduct(null)} />
      )}

      {/* ---------- IMPRESSÃO TÉRMICA ---------- */}
      {printOrder && (
        <OrderReceiptModal
          order={printOrder}
          storeName={settings.storeName}
          onClose={() => setPrintOrder(null)}
        />
      )}
    </div>
  );
};

const CouponForm: React.FC<{ saveCoupon: (c: Coupon) => Promise<void> }> = ({ saveCoupon }) => {
  const [code, setCode] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [discountFixed, setDiscountFixed] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    const coupon: Coupon = {
      code: code.trim().toUpperCase(),
      discountPercent: discountPercent ? Number(discountPercent) : undefined,
      discountFixed: discountFixed ? Number(discountFixed) : undefined,
      minOrderValue: Number(minOrder) || 0,
      description: description.trim() || 'Cupom de desconto',
    };
    saveCoupon(coupon);
    setCode('');
    setDiscountPercent('');
    setDiscountFixed('');
    setMinOrder('');
    setDescription('');
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl p-4 border border-[#E7E5E4] shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 items-end"
    >
      <div>
        <label className="block text-[10px] font-bold text-[#57534E] mb-1">Código</label>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="EX: CALDINHO20"
          className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2 text-xs text-[#1C1917] uppercase focus:ring-1 focus:ring-[#B91C1C]"
          required
        />
      </div>
      <div>
        <label className="block text-[10px] font-bold text-[#57534E] mb-1">% Desconto</label>
        <input
          type="number"
          min="0"
          max="100"
          value={discountPercent}
          onChange={(e) => setDiscountPercent(e.target.value)}
          placeholder="10"
          className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
        />
      </div>
      <div>
        <label className="block text-[10px] font-bold text-[#57534E] mb-1">R$ Fixo</label>
        <input
          type="number"
          min="0"
          step="any"
          value={discountFixed}
          onChange={(e) => setDiscountFixed(e.target.value)}
          placeholder="8.00"
          className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
        />
      </div>
      <div>
        <label className="block text-[10px] font-bold text-[#57534E] mb-1">Pedido mínimo (R$)</label>
        <input
          type="number"
          min="0"
          step="any"
          value={minOrder}
          onChange={(e) => setMinOrder(e.target.value)}
          placeholder="30"
          className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
        />
      </div>
      <div className="lg:col-span-1">
        <label className="block text-[10px] font-bold text-[#57534E] mb-1">Descrição</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="10% OFF..."
          className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
        />
      </div>
      <button
        type="submit"
        className="bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold px-4 py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm transition"
      >
        <PlusCircle className="w-3.5 h-3.5" />
        Criar / Atualizar
      </button>
    </form>
  );
};

const CategoryEditorRow: React.FC<{
  cat: Category;
  productCount: number;
  isFirst: boolean;
  isLast: boolean;
  onSave: (cat: Category) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onMove: (id: string, dir: -1 | 1) => Promise<void>;
}> = ({ cat, productCount, isFirst, isLast, onSave, onDelete, onMove }) => {
  const [draft, setDraft] = useState({ label: cat.label, emoji: cat.emoji, color: cat.color });
  const [emojiOpen, setEmojiOpen] = useState(false);
  const dirty = draft.label !== cat.label || draft.emoji !== cat.emoji || draft.color !== cat.color;

  return (
    <div className="bg-white rounded-2xl p-3 border border-[#E7E5E4] shadow-xs space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-col shrink-0">
          <button
            onClick={() => onMove(cat.id, -1)}
            disabled={isFirst}
            className="p-0.5 text-[#A8A29E] hover:text-[#1C1917] disabled:opacity-25 transition"
            title="Subir"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => onMove(cat.id, 1)}
            disabled={isLast}
            className="p-0.5 text-[#A8A29E] hover:text-[#1C1917] disabled:opacity-25 transition"
            title="Descer"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>

        {/* Ícone: mostra só o atual; abre todos ao clicar (estilo WhatsApp) */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setEmojiOpen((v) => !v)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl border border-[#E7E5E4] hover:border-[#B91C1C]/40 transition"
            style={{ backgroundColor: `${draft.color}1A` }}
            title="Escolher ícone"
          >
            {draft.emoji}
          </button>
          {emojiOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setEmojiOpen(false)} />
              <div className="absolute z-20 mt-1.5 left-0 bg-white border border-[#E7E5E4] rounded-xl shadow-xl p-2 w-52 grid grid-cols-6 gap-1">
                {CATEGORY_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      setDraft((d) => ({ ...d, emoji: e }));
                      setEmojiOpen(false);
                    }}
                    className={`w-7 h-7 rounded-lg text-base flex items-center justify-center transition ${
                      draft.emoji === e ? 'bg-[#FEF2F2] ring-2 ring-[#B91C1C]' : 'hover:bg-[#F5F5F4]'
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <input
          type="text"
          value={draft.label}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          placeholder="Nome da categoria"
          className="flex-1 min-w-0 bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
        />

        <button
          onClick={() => onSave({ ...cat, ...draft })}
          disabled={!dirty || !draft.label.trim()}
          className="p-2 rounded-full bg-[#B91C1C] text-white hover:bg-[#991B1B] transition disabled:opacity-30 shrink-0"
          title="Salvar alterações"
        >
          <Check className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            if (window.confirm(`Excluir a categoria "${cat.label}"?`)) onDelete(cat.id);
          }}
          disabled={productCount > 0}
          className="p-2 rounded-full border border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] hover:bg-[#FEE2E2] transition disabled:opacity-30 shrink-0"
          title={
            productCount > 0
              ? `Tem ${productCount} produto(s) — mova-os antes de excluir`
              : 'Excluir categoria'
          }
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {productCount > 0 && (
        <p className="text-[10px] text-[#A8A29E]">
          {productCount} produto(s) nesta categoria — exclusão bloqueada até esvaziar.
        </p>
      )}
    </div>
  );
};

const ExtrasEditor: React.FC<{
  extras: ExtraOption[];
  onChange: (extras: ExtraOption[]) => void;
}> = ({ extras, onChange }) => {
  const updateExtra = (idx: number, patch: Partial<{ name: string; price: number }>) =>
    onChange(extras.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  const addExtra = () =>
    onChange([
      ...extras,
      { id: 'ext-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), name: '', price: 0 },
    ]);

  return (
    <div className="space-y-1.5">
      {extras.length === 0 && (
        <p className="text-[10px] text-[#A8A29E] italic">
          Nenhum adicional. O cliente verá os adicionais na hora de escolher o produto.
        </p>
      )}
      {extras.map((extra, idx) => (
        <div key={extra.id} className="flex items-center gap-2">
          <input
            type="text"
            value={extra.name}
            onChange={(e) => updateExtra(idx, { name: e.target.value })}
            placeholder="Ex: Queijo Coalho em Cubos"
            className="flex-1 bg-white border border-[#E7E5E4] rounded-lg p-2 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
          />
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[11px] font-bold text-[#57534E]">+R$</span>
            <input
              type="number"
              step="any"
              min="0"
              value={extra.price}
              onChange={(e) => updateExtra(idx, { price: Number(e.target.value) || 0 })}
              className="w-16 bg-white border border-[#E7E5E4] rounded-lg p-2 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
            />
          </div>
          <button
            type="button"
            onClick={() => onChange(extras.filter((_, i) => i !== idx))}
            className="p-2 rounded-full border border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] hover:bg-[#FEE2E2] transition shrink-0"
            title="Remover adicional"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addExtra}
        className="w-full py-2 rounded-xl border border-dashed border-[#B91C1C] hover:bg-[#FEF2F2] text-[#B91C1C] text-[11px] font-bold flex items-center justify-center gap-1.5 transition"
      >
        <PlusCircle className="w-3.5 h-3.5" />
        Adicionar Adicional
      </button>
    </div>
  );
};

const ComboSlotsEditor: React.FC<{
  slots: ComboSlot[];
  onChange: (slots: ComboSlot[]) => void;
}> = ({ slots, onChange }) => {
  const updateSlot = (idx: number, patch: Partial<ComboSlot>) =>
    onChange(slots.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const updateOption = (slotIdx: number, optIdx: number, patch: Partial<{ label: string; priceDelta: number }>) =>
    onChange(
      slots.map((s, si) =>
        si !== slotIdx
          ? s
          : { ...s, options: s.options.map((o, oi) => (oi === optIdx ? { ...o, ...patch } : o)) }
      )
    );

  const addOption = (slotIdx: number) =>
    updateSlot(slotIdx, {
      options: [
        ...slots[slotIdx].options,
        { id: 'opt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), label: '', priceDelta: 0 },
      ],
    });

  const removeOption = (slotIdx: number, optIdx: number) =>
    updateSlot(slotIdx, { options: slots[slotIdx].options.filter((_, i) => i !== optIdx) });

  const addSlot = () =>
    onChange([
      ...slots,
      {
        id: 'slot-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        label: `Escolha ${slots.length + 1}`,
        required: true,
        options: [],
      },
    ]);

  return (
    <div className="space-y-2">
      {slots.length === 0 && (
        <p className="text-[10px] text-[#A8A29E] italic">
          Nenhuma escolha definida. O cliente poderá escolher o sabor de cada item do combo.
        </p>
      )}
      {slots.map((slot, slotIdx) => (
        <div key={slot.id} className="bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={slot.label}
              onChange={(e) => updateSlot(slotIdx, { label: e.target.value })}
              placeholder="Ex: 1º Caldinho (escolha o sabor)"
              className="flex-1 bg-white border border-[#E7E5E4] rounded-lg p-2 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
            />
            <button
              onClick={() => onChange(slots.filter((_, i) => i !== slotIdx))}
              className="p-1.5 rounded-full border border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] hover:bg-[#FEE2E2] transition shrink-0"
              title="Remover escolha"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1.5">
            {slot.options.map((opt, optIdx) => (
              <div key={opt.id} className="flex items-center gap-2">
                <input
                  type="text"
                  value={opt.label}
                  onChange={(e) => updateOption(slotIdx, optIdx, { label: e.target.value })}
                  placeholder="Ex: Caldinho de Feijão Preto"
                  className="flex-1 bg-white border border-[#E7E5E4] rounded-lg p-2 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                />
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] font-bold text-[#57534E]">+R$</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={opt.priceDelta ?? 0}
                    onChange={(e) => updateOption(slotIdx, optIdx, { priceDelta: Number(e.target.value) || 0 })}
                    className="w-14 bg-white border border-[#E7E5E4] rounded-lg p-2 text-xs text-[#1C1917] focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>
                <button
                  onClick={() => removeOption(slotIdx, optIdx)}
                  className="p-1.5 rounded-full text-[#A8A29E] hover:text-[#B91C1C] hover:bg-[#FEF2F2] transition shrink-0"
                  title="Remover opção"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={() => addOption(slotIdx)}
              className="w-full py-1.5 rounded-lg border border-dashed border-[#B91C1C]/50 text-[#B91C1C] text-[10px] font-bold hover:bg-[#FEF2F2] transition"
            >
              + Adicionar opção de sabor
            </button>
          </div>
        </div>
      ))}

      <button
        onClick={addSlot}
        className="w-full py-2 rounded-xl border border-dashed border-[#B91C1C] hover:bg-[#FEF2F2] text-[#B91C1C] text-[11px] font-bold flex items-center justify-center gap-1.5 transition"
      >
        <PlusCircle className="w-3.5 h-3.5" />
        Adicionar Escolha
      </button>
    </div>
  );
};

const ProductEditModal: React.FC<{ product: Product; onClose: () => void }> = ({ product, onClose }) => {
  const { updateProduct, uploadImage, categories } = useKitchen();
  const editCatList: Category[] =
    categories.length > 0 ? [...categories].sort((a, b) => a.sort - b.sort) : FALLBACK_CATEGORIES;
  const [form, setForm] = useState({
    name: product.name,
    description: product.description,
    category: product.category,
    basePrice: String(product.basePrice),
    originalPrice: product.originalPrice != null ? String(product.originalPrice) : '',
    prepTimeMinutes: String(product.prepTimeMinutes || 15),
    available: product.available,
    isPopular: !!product.isPopular,
    isFlashPromo: !!product.isFlashPromo,
    image: product.image,
    allowedExtras: (product.allowedExtras || []).map((e) => ({ ...e })),
    comboSlots: (product.comboSlots || []).map((s) => ({
      ...s,
      options: s.options.map((o) => ({ ...o })),
    })),
  });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const resizeImage = (file: File, maxDim = 1000, quality = 0.85): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Imagem inválida.'));
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Falha ao processar a imagem.'));
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });

  const handleFile = async (file: File) => {
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const dataUrl = await resizeImage(file);
      setForm((f) => ({ ...f, image: dataUrl }));
      const url = await uploadImage(dataUrl, 'produto-' + product.id);
      if (url) setForm((f) => ({ ...f, image: url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar a imagem.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.basePrice) return;
    updateProduct(product.id, {
      name: form.name.trim(),
      description: form.description.trim() || 'Iguaria irresistível da casa.',
      category: form.category,
      basePrice: Number(form.basePrice),
      originalPrice: form.originalPrice ? Number(form.originalPrice) : undefined,
      prepTimeMinutes: Number(form.prepTimeMinutes) || 15,
      available: form.available,
      isPopular: form.isPopular,
      isFlashPromo: form.isFlashPromo,
      image: form.image,
      allowedExtras: form.allowedExtras
        .filter((e) => e.name.trim())
        .map((e) => ({ ...e, name: e.name.trim() })),
      ...(form.category === 'combos'
        ? {
            comboSlots: form.comboSlots
              .filter((s) => s.label.trim())
              .map((s) => ({
                ...s,
                label: s.label.trim(),
                options: s.options.filter((o) => o.label.trim()).map((o) => ({ ...o, label: o.label.trim() })),
              })),
          }
        : {}),
    });
    onClose();
  };

  const toggle = (key: 'available' | 'isPopular' | 'isFlashPromo') =>
    setForm((f) => ({ ...f, [key]: !f[key] }));

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white text-[#1C1917] w-full max-w-lg rounded-2xl border border-[#E7E5E4] shadow-2xl relative max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 pb-3 border-b border-[#E7E5E4] shrink-0">
          <h3 className="text-lg font-extrabold text-[#1C1917] flex items-center gap-2">
            <Pencil className="w-4 h-4 text-[#B91C1C]" />
            <span>Editar Produto</span>
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-[#F5F5F4] text-[#57534E]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs overflow-y-auto p-5">
          <div className="flex gap-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`relative w-28 h-28 shrink-0 rounded-2xl overflow-hidden border-2 border-dashed transition cursor-pointer group ${
                form.image ? 'border-[#B91C1C]/40 bg-white' : 'border-[#E7E5E4] bg-[#F5F5F4]'
              }`}
            >
              {form.image ? (
                <img src={form.image} alt="Produto" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-[#A8A29E]">
                  <ImagePlus className="w-7 h-7" />
                  <span className="text-[9px] font-bold">Sem imagem</span>
                </div>
              )}
              {uploading && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <span className="w-6 h-6 rounded-full border-2 border-white border-t-transparent animate-spin" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                <span className="bg-white/90 text-[#1C1917] text-[10px] font-extrabold px-2.5 py-1.5 rounded-full flex items-center gap-1">
                  <Upload className="w-3 h-3" /> Trocar foto
                </span>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = '';
              }}
            />

            <div className="flex-1 space-y-2">
              <div>
                <label className="block text-[#1C1917] font-bold mb-1">Nome do Produto</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                  required
                />
              </div>
              <div>
                <label className="block text-[#1C1917] font-bold mb-1">Categoria</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as CategoryId }))}
                  className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                >
                  {editCatList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji} {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[#1C1917] font-bold mb-1">Descrição</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] resize-none h-16 focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[#1C1917] font-bold mb-1">Preço (R$)</label>
              <input
                type="number"
                step="any"
                min="0"
                value={form.basePrice}
                onChange={(e) => setForm((f) => ({ ...f, basePrice: e.target.value }))}
                className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                required
              />
            </div>
            <div>
              <label className="block text-[#1C1917] font-bold mb-1">Preço Original (R$)</label>
              <input
                type="number"
                step="any"
                min="0"
                value={form.originalPrice}
                onChange={(e) => setForm((f) => ({ ...f, originalPrice: e.target.value }))}
                placeholder="De: (promoção)"
                className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
              />
            </div>
            <div>
              <label className="block text-[#1C1917] font-bold mb-1">Tempo de Preparo (min)</label>
              <input
                type="number"
                min="1"
                value={form.prepTimeMinutes}
                onChange={(e) => setForm((f) => ({ ...f, prepTimeMinutes: e.target.value }))}
                className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { key: 'available' as const, label: 'Disponível no cardápio' },
                { key: 'isPopular' as const, label: 'Marcar como Popular (⭐)' },
                { key: 'isFlashPromo' as const, label: 'Promoção relâmpago (-%)' },
              ]
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => toggle(opt.key)}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-[11px] font-bold transition ${
                  form[opt.key]
                    ? 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]'
                    : 'bg-[#F5F5F4] text-[#57534E] border-[#E7E5E4]'
                }`}
              >
                <span>{opt.label}</span>
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] shrink-0 ${
                    form[opt.key] ? 'bg-[#059669] text-white' : 'bg-[#E7E5E4] text-[#A8A29E]'
                  }`}
                >
                  {form[opt.key] ? <Check className="w-2.5 h-2.5" /> : ''}
                </span>
              </button>
            ))}
          </div>

          <div>
            <label className="block text-[#1C1917] font-bold mb-1.5">
              Adicionais / Acompanhamentos (opcional)
            </label>
            <ExtrasEditor
              extras={form.allowedExtras}
              onChange={(allowedExtras) => setForm((f) => ({ ...f, allowedExtras }))}
            />
          </div>

          <div>
            <label className="block text-[#1C1917] font-bold mb-1">URL da Imagem (alternativa ao upload)</label>
            <input
              type="text"
              value={form.image.startsWith('data:') ? '' : form.image}
              onChange={(e) => setForm((f) => ({ ...f, image: e.target.value }))}
              placeholder="https://images.unsplash.com/..."
              className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
            />
          </div>

          {error && (
            <p className="text-[11px] text-[#B91C1C] font-bold bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl p-2.5">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-3 pb-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-full bg-[#E7E5E4] text-[#1C1917] font-bold hover:bg-[#D6D3D1] transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-full bg-[#B91C1C] text-white font-bold shadow hover:bg-[#991B1B] transition"
            >
              Salvar Alterações
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const PriceInput: React.FC<{ product: Product }> = ({ product }) => {
  const { updateProductPrice } = useKitchen();
  const [value, setValue] = useState(String(product.basePrice));

  useEffect(() => {
    const t = setTimeout(() => {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0 && n !== product.basePrice) {
        updateProductPrice(product.id, n);
      }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="flex items-center gap-1">
      <span className="font-extrabold text-[#1C1917]">R$</span>
      <input
        type="number"
        step="any"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-16 bg-white border border-[#E7E5E4] rounded-lg p-1 text-xs text-[#1C1917] font-extrabold text-right focus:ring-1 focus:ring-[#B91C1C]"
      />
    </div>
  );
};

const SoundUploadButton: React.FC<{ onFile: (dataUrl: string) => Promise<void> }> = ({ onFile }) => {
  const [reading, setReading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    if (!/^audio\//.test(file.type)) {
      setError('Formato inválido. Envie um arquivo de áudio (MP3, WAV, OGG ou WEBM).');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('Arquivo muito grande (máx. 15 MB).');
      return;
    }
    setError(null);
    setReading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      await onFile(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar o áudio.');
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={reading}
        className="w-full bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold py-2.5 rounded-full text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition disabled:opacity-50"
      >
        {reading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {reading ? 'Enviando...' : 'Enviar áudio do pedido (MP3)'}
      </button>
      <input
        ref={ref}
        type="file"
        accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = '';
        }}
      />
      {error && (
        <p className="text-[10px] text-[#B91C1C] font-bold bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl p-2">
          {error}
        </p>
      )}
    </div>
  );
};

const PromoDoDiaCard: React.FC<{
  products: Product[];
  setCaldinhoDoDia: (id: string) => Promise<void>;
  uploadImage: (dataUrl: string, filename?: string) => Promise<string | null>;
  updateProductImage: (id: string, imageUrl: string) => Promise<void>;
}> = ({ products, setCaldinhoDoDia, uploadImage, updateProductImage }) => {
  const caldinho = products.find((p) => p.isCaldinhoDoDia) || products.find((p) => p.category === 'caldinhos');

  const [selectedId, setSelectedId] = useState<string>(caldinho?.id || '');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>(caldinho?.image || '');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Sincroniza a seleção quando os produtos carregam
  React.useEffect(() => {
    if (!selectedId && caldinho) {
      setSelectedId(caldinho.id);
      setPreview(caldinho.image);
    }
  }, [caldinho, selectedId]);

  const resizeImage = (file: File, maxDim = 1200, quality = 0.85): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Imagem inválida.'));
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Falha ao processar a imagem.'));
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });

  const handleFile = async (file: File) => {
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const dataUrl = await resizeImage(file);
      setPreview(dataUrl);
      const url = await uploadImage(dataUrl, 'promocao-do-dia');
      if (url && selectedId) {
        await updateProductImage(selectedId, url);
      } else if (url && !selectedId) {
        setError('Selecione um caldinho para salvar a imagem.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar a imagem.');
    } finally {
      setUploading(false);
    }
  };

  const handleSelectProduct = (id: string) => {
    setSelectedId(id);
    const p = products.find((x) => x.id === id);
    if (p) {
      setPreview(p.image);
      setCaldinhoDoDia(id);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-[#E7E5E4] shadow-xs">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-10 h-10 rounded-2xl bg-[#B91C1C] flex items-center justify-center text-white shadow-sm">
          <Flame className="w-5 h-5 text-[#FDE68A]" />
        </div>
        <div>
          <h4 className="text-sm font-extrabold text-[#1C1917]">Promoção do Dia</h4>
          <p className="text-[11px] text-[#57534E]">Escolha o caldinho e envie a imagem de destaque.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-4">
        {/* Preview / upload */}
        <div>
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`relative aspect-square rounded-2xl overflow-hidden border-2 border-dashed transition cursor-pointer group ${
              preview ? 'border-[#B91C1C]/40' : 'border-[#E7E5E4] bg-[#F5F5F4]'
            }`}
          >
            {preview ? (
              <img src={preview} alt="Promoção do dia" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[#A8A29E]">
                <ImagePlus className="w-8 h-8" />
                <span className="text-[11px] font-bold">Enviar imagem</span>
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <span className="w-7 h-7 rounded-full border-2 border-white border-t-transparent animate-spin" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
              <span className="bg-white/90 text-[#1C1917] text-[10px] font-extrabold px-3 py-1.5 rounded-full flex items-center gap-1">
                <Upload className="w-3 h-3" /> Trocar imagem
              </span>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          <p className="text-[10px] text-[#A8A29E] mt-1.5 text-center">
            PNG, JPG, WEBP ou GIF
          </p>
        </div>

        {/* Seleção do produto */}
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-bold text-[#57534E] uppercase tracking-wider mb-1.5">
              Caldinho em destaque
            </label>
            <select
              value={selectedId}
              onChange={(e) => handleSelectProduct(e.target.value)}
              className="w-full bg-[#F5F5F4] border border-[#E7E5E4] rounded-2xl p-2.5 text-xs text-[#1C1917] focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
            >
              <option value="" disabled>
                Selecione um caldinho...
              </option>
              {products
                .filter((p) => p.category === 'caldinhos')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — R$ {p.basePrice.toFixed(2)}
                  </option>
                ))}
            </select>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !selectedId}
            className="w-full bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold py-3 rounded-full text-xs flex items-center justify-center gap-2 shadow-sm transition disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            <span>{uploading ? 'Enviando...' : 'Enviar imagem da Promoção'}</span>
          </button>

          {error && (
            <p className="text-[11px] text-[#B91C1C] font-bold bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl p-2.5">
              {error}
            </p>
          )}

          <p className="text-[11px] text-[#57534E] bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-3">
            A imagem enviada substitui a foto atual do produto e aparece no destaque "Especial de hoje"
            para os clientes.
          </p>
        </div>
      </div>
    </div>
  );
};

const StoreLogoUpload: React.FC<{
  logo: string;
  uploadImage: (dataUrl: string, filename?: string) => Promise<string | null>;
  setStoreLogo: (logo: string) => Promise<void>;
}> = ({ logo, uploadImage, setStoreLogo }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const resizeImage = (file: File, maxDim = 400, quality = 0.9): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Imagem inválida.'));
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Falha ao processar a imagem.'));
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png', quality));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });

  const handleFile = async (file: File) => {
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const dataUrl = await resizeImage(file, 400, 0.9);
      const url = await uploadImage(dataUrl, 'logo-loja');
      if (url) await setStoreLogo(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar a imagem.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl p-2.5 space-y-2">
      <label className="block text-[10px] font-bold text-[#57534E]">Logo da Loja</label>

      <div className="flex items-center gap-3">
        <div
          onClick={() => fileInputRef.current?.click()}
          className={`relative w-16 h-16 shrink-0 rounded-xl overflow-hidden border-2 border-dashed transition cursor-pointer group ${
            logo ? 'border-[#B91C1C]/40 bg-white' : 'border-[#E7E5E4] bg-white'
          }`}
        >
          {logo ? (
            <img src={logo} alt="Logo da loja" className="w-full h-full object-contain p-1" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-0.5 text-[#A8A29E]">
              <ImagePlus className="w-5 h-5" />
              <span className="text-[8px] font-bold">Sem logo</span>
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            </div>
          )}
        </div>

        <div className="flex-1 space-y-1.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full bg-[#B91C1C] hover:bg-[#991B1B] text-white font-extrabold py-2.5 rounded-full text-[11px] flex items-center justify-center gap-1.5 shadow-sm transition disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{logo ? 'Trocar Logo' : 'Enviar Logo'}</span>
          </button>
          {logo && (
            <button
              onClick={() => setStoreLogo('')}
              className="w-full py-2 rounded-full text-[11px] font-bold text-[#B91C1C] bg-[#FEF2F2] border border-[#FCA5A5] hover:bg-[#FEE2E2] transition"
            >
              Remover logo
            </button>
          )}
          <p className="text-[10px] text-[#A8A29E]">
            PNG ou JPG • aparece no topo do cardápio do cliente
          </p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />

      {error && (
        <p className="text-[11px] text-[#B91C1C] font-bold bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl p-2.5">
          {error}
        </p>
      )}
    </div>
  );
};