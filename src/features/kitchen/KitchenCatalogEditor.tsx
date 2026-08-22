import React, { useMemo, useState } from 'react';
import { Flame, Pause, Pencil, Play, PlusCircle, Search, Star, Ticket, Trash2, Upload, UtensilsCrossed, Zap } from 'lucide-react';
import type { Category, Coupon, Product } from '../../../contract/catalog/types';
import { ACCEPTED_IMAGE_TYPES, validateImageFile } from '../../lib/image';
import { useImageFramer } from '../../components/common/ImageFramer';
import { useKitchenCatalog } from './KitchenCatalogStore';
import { useKitchenUpload } from './useKitchenUpload';
import { KitchenProductEditor, PRODUCT_IMAGE_FALLBACK } from './KitchenProductEditor';
import { KitchenCategoriesPanel } from './KitchenCategoriesPanel';
import type { KitchenTab } from './kitchenTabs';
import { formatMoney } from '../../../contract/pricing/money';

const FALLBACK_CATEGORIES: Category[] = [
  { id: 'caldinhos', label: 'Caldinhos', emoji: '🍲', color: '#C2410C', sort: 0 },
  { id: 'petiscos', label: 'Petiscos', emoji: '🍤', color: '#7C3AED', sort: 1 },
  { id: 'bebidas', label: 'Bebidas', emoji: '🥤', color: '#2563EB', sort: 2 },
  { id: 'combos', label: 'Combos', emoji: '🍱', color: '#059669', sort: 3 },
];


export const KitchenCatalogEditor: React.FC<{ activeTab: KitchenTab }> = ({ activeTab }) => {
  const {
    products,
    categories,
    coupons,
    toggleProductAvailability,
    updateProductPrice,
    updateProduct,
    deleteProduct,
    addProduct,
    toggleFeatured,
    updateProductImage,
    saveCategory,
    deleteCategory,
    reorderCategories,
    saveCoupon,
    deleteCoupon,
  } = useKitchenCatalog();
  const uploadImage = useKitchenUpload();
  const { frameImage, framerNode } = useImageFramer();
  const [editor, setEditor] = useState<Product | 'new' | null>(null);
  const sortedCategories = useMemo(
    () => (categories.length ? [...categories].sort((a, b) => a.sort - b.sort) : FALLBACK_CATEGORIES),
    [categories]
  );
  const editorModal = editor ? (
    <KitchenProductEditor
      value={editor}
      categories={sortedCategories}
      onClose={() => setEditor(null)}
      onSave={async (product) => {
        if (editor === 'new') await addProduct(product);
        else await updateProduct(product.id, product);
        setEditor(null);
      }}
    />
  ) : null;

  if (activeTab === 'cardapio') {
    return <><ProductCatalog products={products} categories={sortedCategories} onNew={() => setEditor('new')} onEdit={setEditor} onDelete={(product) => { if (window.confirm(`Excluir ${product.name}?`)) void deleteProduct(product.id); }} onToggle={(product) => toggleProductAvailability(product.id, product.available)} onPrice={updateProductPrice} onDay={toggleFeatured} onUpload={async (product, file) => { const invalid = validateImageFile(file); if (invalid) return; const dataUrl = await frameImage(file, { title: `Enquadrar foto de ${product.name}` }); if (!dataUrl) return; const url = await uploadImage(dataUrl, `produto-${product.id}`); if (url) await updateProductImage(product.id, url); }} />{editorModal}{framerNode}</>;
  }

  if (activeTab === 'categorias') {
    return (
      <KitchenCategoriesPanel
        categories={sortedCategories}
        products={products}
        onSave={saveCategory}
        onDelete={deleteCategory}
        onReorder={reorderCategories}
      />
    );
  }

  if (activeTab === 'cupons') {
    return <CouponCatalog coupons={coupons} onSave={saveCoupon} onDelete={deleteCoupon} />;
  }

  return editorModal;
};

const ProductCatalog: React.FC<{
  products: Product[];
  categories: Category[];
  onNew: () => void;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onToggle: (product: Product) => Promise<void>;
  onPrice: (id: string, price: number) => Promise<void>;
  onDay: (product: Product) => Promise<void>;
  onUpload: (product: Product, file: File) => Promise<void>;
}> = ({ products, categories, onNew, onEdit, onDelete, onToggle, onPrice, onDay, onUpload }) => {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('todas');

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryFilter !== 'todas' && product.category !== categoryFilter) return false;
      if (!term) return true;
      return (
        product.name.toLowerCase().includes(term) || product.description.toLowerCase().includes(term)
      );
    });
  }, [products, query, categoryFilter]);

  const pausedCount = products.filter((product) => !product.available).length;
  const countFor = (id: string) => products.filter((product) => product.category === id).length;

  return (
    <div className="space-y-4">
      <Header
        icon={<UtensilsCrossed />}
        title="Cardápio e estoque"
        subtitle={`${products.length} ${products.length === 1 ? 'produto' : 'produtos'}${pausedCount ? ` · ${pausedCount} ${pausedCount === 1 ? 'pausado' : 'pausados'}` : ''}`}
        action={
          <button className="btn-primary shrink-0" onClick={onNew}>
            <PlusCircle className="w-4 h-4" />
            Novo produto
          </button>
        }
      />

      <div className="bg-white rounded-2xl border border-[#E7E5E4] p-3 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-[#A8A29E] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            className="input pl-9 py-2.5"
            placeholder="Buscar produto pelo nome ou descrição…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
          <FilterChip
            active={categoryFilter === 'todas'}
            label={`Todas (${products.length})`}
            onClick={() => setCategoryFilter('todas')}
          />
          {categories.map((category) => (
            <FilterChip
              key={category.id}
              active={categoryFilter === category.id}
              label={`${category.emoji} ${category.label} (${countFor(category.id)})`}
              onClick={() => setCategoryFilter(category.id)}
            />
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty text={query.trim() ? `Nenhum produto para "${query.trim()}".` : 'Nenhum produto nesta categoria.'} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-4">
          {visible.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              categoryLabel={
                categories.find((category) => category.id === product.category)?.label || product.category
              }
              onEdit={onEdit}
              onDelete={onDelete}
              onToggle={onToggle}
              onPrice={onPrice}
              onDay={onDay}
              onUpload={onUpload}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FilterChip: React.FC<{ active: boolean; label: string; onClick: () => void }> = ({
  active,
  label,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold border transition ${
      active
        ? 'bg-[#B91C1C] text-white border-[#B91C1C]'
        : 'bg-[#F5F5F4] text-[#57534E] border-[#E7E5E4] hover:bg-[#E7E5E4]'
    }`}
  >
    {label}
  </button>
);

const ProductCard: React.FC<{
  product: Product;
  categoryLabel: string;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onToggle: (product: Product) => Promise<void>;
  onPrice: (id: string, price: number) => Promise<void>;
  onDay: (product: Product) => Promise<void>;
  onUpload: (product: Product, file: File) => Promise<void>;
}> = ({ product, categoryLabel, onEdit, onDelete, onToggle, onPrice, onDay, onUpload }) => (
  <article
    className={`bg-white rounded-2xl border flex flex-col overflow-hidden transition-colors ${
      product.available ? 'border-[#E7E5E4] hover:border-[#D6D3D1]' : 'border-[#FCA5A5]'
    }`}
  >
    <div className="relative aspect-[16/9] bg-[#F5F5F4] shrink-0">
      <img
        src={product.image || PRODUCT_IMAGE_FALLBACK}
        alt=""
        loading="lazy"
        className={`absolute inset-0 w-full h-full object-cover ${product.available ? '' : 'grayscale opacity-60'}`}
        onError={(event) => {
          (event.currentTarget as HTMLImageElement).src = PRODUCT_IMAGE_FALLBACK;
        }}
      />
      <div className="absolute top-2 left-2 flex flex-wrap gap-1">
        {!product.available && <CardBadge className="bg-[#B91C1C] text-white">Pausado</CardBadge>}
        {product.isFeatured && (
          <CardBadge className="bg-[#FEF3C7] text-[#B45309]">
            <Flame className="h-3 w-3" aria-hidden />
            Do dia
          </CardBadge>
        )}
        {product.isPopular && (
          <CardBadge className="bg-white text-[#1C1917]">
            <Star className="h-3 w-3" aria-hidden />
            Popular
          </CardBadge>
        )}
        {product.isFlashPromo && (
          <CardBadge className="bg-[#7C3AED] text-white">
            <Zap className="h-3 w-3" aria-hidden />
            Flash
          </CardBadge>
        )}
      </div>
    </div>

    <div className="p-4 flex flex-col flex-1 gap-3">
      <div>
        <span className="text-[10px] uppercase tracking-wide font-bold text-[#57534E]">{categoryLabel}</span>
        <h3 className="font-extrabold text-sm text-[#1C1917] leading-snug line-clamp-2" title={product.name}>
          {product.name}
        </h3>
      </div>

      <div className="flex items-center justify-between gap-2 bg-[#F5F5F4] rounded-xl px-3 py-2 text-xs mt-auto">
        <span className="text-[#57534E] font-bold">Preço base</span>
        <PriceInput product={product} onSave={onPrice} />
      </div>

      <div className="flex gap-1.5">
        <button
          className={`flex-1 ${product.available ? 'btn-secondary' : 'btn-primary'}`}
          onClick={() => void onToggle(product)}
        >
          {product.available ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {product.available ? 'Pausar' : 'Reativar'}
        </button>
        <button
          className={product.isFeatured ? 'btn-primary p-2 pointer-coarse:min-w-11' : 'btn-secondary p-2 pointer-coarse:min-w-11'}
          title={product.isFeatured ? 'Tirar da promoção do dia' : 'Marcar como promoção do dia'}
          aria-pressed={product.isFeatured}
          aria-label={product.isFeatured ? 'Tirar da promoção do dia' : 'Marcar como promoção do dia'}
          onClick={() => void onDay(product)}
        >
          <Flame className="w-3.5 h-3.5" />
        </button>
        <label className="btn-secondary p-2 cursor-pointer pointer-coarse:min-w-11" title="Trocar a foto">
          <Upload className="w-3.5 h-3.5" />
          <span className="sr-only">Trocar a foto</span>
          <input
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void onUpload(product, file);
            }}
          />
        </label>
        <button className="btn-secondary p-2 pointer-coarse:min-w-11" title="Editar" aria-label="Editar" onClick={() => onEdit(product)}>
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button className="btn-danger p-2 pointer-coarse:min-w-11" title="Excluir" aria-label="Excluir" onClick={() => onDelete(product)}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  </article>
);

const CardBadge: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black shadow-sm ${className}`}>{children}</span>
);

const PriceInput: React.FC<{ product: Product; onSave: (id: string, price: number) => Promise<void> }> = ({ product, onSave }) => {
  const [value, setValue] = useState(String(product.basePrice));
  return (
    <div className="flex items-center gap-1">
      <span className="text-[#57534E]">R$</span>
      <input
        aria-label={`Preço base de ${product.name}`}
        className="w-20 bg-white border border-[#E7E5E4] rounded-lg px-1.5 py-1 text-xs font-bold text-right outline-none focus:border-[#B91C1C]"
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed >= 0 && parsed !== product.basePrice) void onSave(product.id, parsed);
          else setValue(String(product.basePrice));
        }}
      />
    </div>
  );
};



const CouponCatalog: React.FC<{ coupons: Coupon[]; onSave: (coupon: Coupon) => Promise<void>; onDelete: (code: string) => Promise<void> }> = ({ coupons, onSave, onDelete }) => {
  const [form, setForm] = useState({ code: '', percent: '', fixed: '', min: '', description: '' });
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!form.code.trim()) return; void onSave({ code: form.code.trim().toUpperCase(), discountPercent: form.percent ? Number(form.percent) : undefined, discountFixed: form.fixed ? Number(form.fixed) : undefined, minOrderValue: Number(form.min) || 0, description: form.description.trim() || 'Cupom de desconto' }); setForm({ code: '', percent: '', fixed: '', min: '', description: '' }); };
  return <div className="space-y-4"><Header icon={<Ticket />} title="Cupons de desconto" subtitle={`${coupons.length} ${coupons.length === 1 ? 'ativo' : 'ativos'}.`} /><form onSubmit={submit} className="bg-white rounded-2xl p-4 border border-[#E7E5E4] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2"><input className="input" placeholder="Código" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required /><input className="input" type="number" placeholder="% desconto" value={form.percent} onChange={(event) => setForm({ ...form, percent: event.target.value })} /><input className="input" type="number" placeholder="R$ fixo" value={form.fixed} onChange={(event) => setForm({ ...form, fixed: event.target.value })} /><input className="input" type="number" placeholder="Pedido mínimo" value={form.min} onChange={(event) => setForm({ ...form, min: event.target.value })} /><input className="input" placeholder="Descrição" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><button className="btn-primary"><PlusCircle className="w-4 h-4" />Salvar</button></form><div className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-3">{coupons.map((coupon) => <div key={coupon.code} className="bg-white rounded-2xl p-4 border border-dashed border-[#B91C1C]/40"><div className="flex justify-between gap-2"><strong className="bg-[#B91C1C] text-white rounded px-2 py-1 text-xs">{coupon.code}</strong><button className="btn-danger p-1 pointer-coarse:min-w-11" onClick={() => { if (window.confirm(`Excluir ${coupon.code}?`)) void onDelete(coupon.code); }}><Trash2 className="w-3.5 h-3.5" /></button></div><p className="text-xs mt-2">{coupon.description}</p><span className="text-[10px] text-[#57534E]">{coupon.discountPercent ? `${coupon.discountPercent}% OFF` : coupon.discountFixed ? `-${formatMoney(coupon.discountFixed)}` : 'Sem desconto'} · mínimo {formatMoney(coupon.minOrderValue)}</span></div>)}</div></div>;
};

const Header: React.FC<{ title: string; subtitle?: string; icon: React.ReactNode; action?: React.ReactNode }> = ({ title, subtitle, icon, action }) => <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3 min-w-0"><div className="w-10 h-10 rounded-2xl bg-[#B91C1C] text-white flex items-center justify-center shrink-0">{icon}</div><div className="min-w-0"><h2 className="text-lg font-extrabold text-[#1C1917] truncate">{title}</h2>{subtitle && <p className="text-xs text-[#57534E]">{subtitle}</p>}</div></div>{action}</div>;
const Empty: React.FC<{ text: string }> = ({ text }) => <p className="text-xs text-[#A8A29E] italic py-8 text-center">{text}</p>;
