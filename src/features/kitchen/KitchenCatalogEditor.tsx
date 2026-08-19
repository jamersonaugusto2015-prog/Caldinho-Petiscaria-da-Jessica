import React, { useMemo, useState } from 'react';
import { Check, Flame, ImagePlus, Megaphone, Pause, Pencil, Play, PlusCircle, Search, Tags, Ticket, Trash2, Upload, UtensilsCrossed } from 'lucide-react';
import type { Category, Coupon, Product } from '../../types';
import { ACCEPTED_IMAGE_TYPES, resizeImage, validateImageFile } from '../../lib/image';
import { useKitchenCatalog } from './KitchenCatalogStore';
import { useKitchenUpload } from './useKitchenUpload';
import { KitchenProductEditor, PRODUCT_IMAGE_FALLBACK } from './KitchenProductEditor';
import type { KitchenTab } from './kitchenTabs';

const FALLBACK_CATEGORIES: Category[] = [
  { id: 'caldinhos', label: 'Caldinhos', emoji: '🍲', color: '#C2410C', sort: 0 },
  { id: 'petiscos', label: 'Petiscos', emoji: '🍤', color: '#7C3AED', sort: 1 },
  { id: 'bebidas', label: 'Bebidas', emoji: '🥤', color: '#2563EB', sort: 2 },
  { id: 'combos', label: 'Combos', emoji: '🍱', color: '#059669', sort: 3 },
];

const money = (value: number) => `R$ ${value.toFixed(2)}`;

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
    setCaldinhoDoDia,
    updateProductImage,
    saveCategory,
    deleteCategory,
    moveCategory,
    saveCoupon,
    deleteCoupon,
  } = useKitchenCatalog();
  const uploadImage = useKitchenUpload();
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
    return <><ProductCatalog products={products} categories={sortedCategories} onNew={() => setEditor('new')} onEdit={setEditor} onDelete={(product) => { if (window.confirm(`Excluir ${product.name}?`)) void deleteProduct(product.id); }} onToggle={(product) => toggleProductAvailability(product.id, product.available)} onPrice={updateProductPrice} onDay={setCaldinhoDoDia} onUpload={async (product, file) => { const invalid = validateImageFile(file); if (invalid) return; const url = await uploadImage(await resizeImage(file), `produto-${product.id}`); if (url) await updateProductImage(product.id, url); }} />{editorModal}</>;
  }

  if (activeTab === 'categorias') {
    return <CategoryCatalog categories={sortedCategories} products={products} onSave={saveCategory} onDelete={deleteCategory} onMove={moveCategory} />;
  }

  if (activeTab === 'promocoes') {
    return <><PromotionCatalog products={products} onDay={setCaldinhoDoDia} onEdit={setEditor} onUpdate={updateProduct} onUpload={async (product, file) => { const invalid = validateImageFile(file); if (invalid) return; const url = await uploadImage(await resizeImage(file), `promocao-${product.id}`); if (url) await updateProductImage(product.id, url); }} />{editorModal}</>;
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
  onDay: (id: string) => Promise<void>;
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
        subtitle={`${products.length} produto(s)${pausedCount ? ` · ${pausedCount} pausado(s)` : ''}`}
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
            placeholder="Buscar produto pelo nome ou descrição..."
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
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
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
  onDay: (id: string) => Promise<void>;
  onUpload: (product: Product, file: File) => Promise<void>;
}> = ({ product, categoryLabel, onEdit, onDelete, onToggle, onPrice, onDay, onUpload }) => (
  <article
    className={`bg-white rounded-2xl border flex flex-col overflow-hidden transition hover:shadow-md ${
      product.available ? 'border-[#E7E5E4]' : 'border-[#FCA5A5]'
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
        {product.isCaldinhoDoDia && <CardBadge className="bg-[#FEF3C7] text-[#B45309]">🔥 Do dia</CardBadge>}
        {product.isPopular && <CardBadge className="bg-white text-[#1C1917]">⭐ Popular</CardBadge>}
        {product.isFlashPromo && <CardBadge className="bg-[#7C3AED] text-white">⚡ Flash</CardBadge>}
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
        {product.category === 'caldinhos' && (
          <button
            className={product.isCaldinhoDoDia ? 'btn-primary p-2' : 'btn-secondary p-2'}
            title={product.isCaldinhoDoDia ? 'Este é o caldinho do dia' : 'Marcar como caldinho do dia'}
            aria-pressed={product.isCaldinhoDoDia}
            aria-label="Marcar como caldinho do dia"
            onClick={() => void onDay(product.id)}
          >
            <Flame className="w-3.5 h-3.5" />
          </button>
        )}
        <label className="btn-secondary p-2 cursor-pointer" title="Trocar a foto">
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
        <button className="btn-secondary p-2" title="Editar" aria-label="Editar" onClick={() => onEdit(product)}>
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button className="btn-danger p-2" title="Excluir" aria-label="Excluir" onClick={() => onDelete(product)}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  </article>
);

const CardBadge: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => (
  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black shadow-sm ${className}`}>{children}</span>
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


const CategoryCatalog: React.FC<{ categories: Category[]; products: Product[]; onSave: (category: Category) => Promise<void>; onDelete: (id: string) => Promise<void>; onMove: (id: string, direction: -1 | 1) => Promise<void> }> = ({ categories, products, onSave, onDelete, onMove }) => <div className="space-y-4"><Header icon={<Tags />} title="Categorias" action={<button className="btn-primary" onClick={() => void onSave({ id: `cat-${Date.now()}`, label: 'Nova categoria', emoji: '🍽️', color: '#B91C1C', sort: categories.length })}><PlusCircle className="w-4 h-4" />Nova categoria</button>} /><div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{categories.map((category, index) => <CategoryRow key={category.id} category={category} count={products.filter((product) => product.category === category.id).length} first={index === 0} last={index === categories.length - 1} onSave={onSave} onDelete={onDelete} onMove={onMove} />)}</div></div>;

const CategoryRow: React.FC<{ category: Category; count: number; first: boolean; last: boolean; onSave: (category: Category) => Promise<void>; onDelete: (id: string) => Promise<void>; onMove: (id: string, direction: -1 | 1) => Promise<void> }> = ({ category, count, first, last, onSave, onDelete, onMove }) => {
  const [label, setLabel] = useState(category.label);
  const [emoji, setEmoji] = useState(category.emoji);
  const [color, setColor] = useState(category.color);
  return <div className="bg-white rounded-2xl p-3 border border-[#E7E5E4] flex items-center gap-2"><div className="flex flex-col"><button disabled={first} onClick={() => void onMove(category.id, -1)}><span className="sr-only">Subir</span>↑</button><button disabled={last} onClick={() => void onMove(category.id, 1)}><span className="sr-only">Descer</span>↓</button></div><input aria-label="Emoji" className="w-12 bg-[#F5F5F4] rounded-lg p-2 text-center" value={emoji} onChange={(event) => setEmoji(event.target.value)} /><input className="flex-1 input" value={label} onChange={(event) => setLabel(event.target.value)} /><input aria-label="Cor" type="color" className="w-8 h-8" value={color} onChange={(event) => setColor(event.target.value)} /><button className="btn-primary p-2" onClick={() => void onSave({ ...category, label, emoji, color })}><Check className="w-4 h-4" /></button><button className="btn-danger p-2" disabled={count > 0} onClick={() => { if (window.confirm(`Excluir ${category.label}?`)) void onDelete(category.id); }}><Trash2 className="w-4 h-4" /></button></div>;
};

const PromotionCatalog: React.FC<{ products: Product[]; onDay: (id: string) => Promise<void>; onEdit: (product: Product) => void; onUpdate: (id: string, patch: Partial<Product>) => Promise<void>; onUpload: (product: Product, file: File) => Promise<void> }> = ({ products, onDay, onEdit, onUpdate, onUpload }) => <div className="space-y-4"><Header icon={<Megaphone />} title="Promoções" /><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{products.filter((product) => product.isPopular || product.isFlashPromo || product.isCaldinhoDoDia).map((product) => <div key={product.id} className="bg-white rounded-2xl border border-[#E7E5E4] p-4"><div className="flex items-center gap-3"><img src={product.image} alt={product.name} className="w-14 h-14 rounded-xl object-cover" /><div className="flex-1"><strong className="block">{product.name}</strong><span className="text-xs text-[#B91C1C]">{money(product.basePrice)}</span></div></div><div className="flex flex-wrap gap-1.5 mt-3 text-[10px] font-bold">{product.isCaldinhoDoDia && <span className="badge">🔥 Destaque</span>}{product.isPopular && <span className="badge">⭐ Popular</span>}{product.isFlashPromo && <span className="badge">⚡ Flash</span>}</div><div className="flex gap-2 mt-3"><button className="btn-secondary flex-1" onClick={() => onEdit(product)}>Editar</button><button className="btn-danger" onClick={() => void onUpdate(product.id, { isPopular: false, isFlashPromo: false, isCaldinhoDoDia: false, originalPrice: null })}>Remover</button><button className="btn-secondary" onClick={() => void onDay(product.id)}>🔥</button><label className="btn-secondary cursor-pointer"><ImagePlus className="w-3.5 h-3.5" /><input type="file" accept={ACCEPTED_IMAGE_TYPES} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void onUpload(product, file); }} /></label></div></div>)}</div>{products.every((product) => !product.isPopular && !product.isFlashPromo && !product.isCaldinhoDoDia) && <Empty text="Nenhuma promoção ativa." />}</div>;

const CouponCatalog: React.FC<{ coupons: Coupon[]; onSave: (coupon: Coupon) => Promise<void>; onDelete: (code: string) => Promise<void> }> = ({ coupons, onSave, onDelete }) => {
  const [form, setForm] = useState({ code: '', percent: '', fixed: '', min: '', description: '' });
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!form.code.trim()) return; void onSave({ code: form.code.trim().toUpperCase(), discountPercent: form.percent ? Number(form.percent) : undefined, discountFixed: form.fixed ? Number(form.fixed) : undefined, minOrderValue: Number(form.min) || 0, description: form.description.trim() || 'Cupom de desconto' }); setForm({ code: '', percent: '', fixed: '', min: '', description: '' }); };
  return <div className="space-y-4"><Header icon={<Ticket />} title="Cupons de desconto" subtitle={`${coupons.length} ativo(s).`} /><form onSubmit={submit} className="bg-white rounded-2xl p-4 border border-[#E7E5E4] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2"><input className="input" placeholder="Código" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required /><input className="input" type="number" placeholder="% desconto" value={form.percent} onChange={(event) => setForm({ ...form, percent: event.target.value })} /><input className="input" type="number" placeholder="R$ fixo" value={form.fixed} onChange={(event) => setForm({ ...form, fixed: event.target.value })} /><input className="input" type="number" placeholder="Pedido mínimo" value={form.min} onChange={(event) => setForm({ ...form, min: event.target.value })} /><input className="input" placeholder="Descrição" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><button className="btn-primary"><PlusCircle className="w-4 h-4" />Salvar</button></form><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{coupons.map((coupon) => <div key={coupon.code} className="bg-white rounded-2xl p-4 border border-dashed border-[#B91C1C]/40"><div className="flex justify-between gap-2"><strong className="bg-[#B91C1C] text-white rounded px-2 py-1 text-xs">{coupon.code}</strong><button className="btn-danger p-1" onClick={() => { if (window.confirm(`Excluir ${coupon.code}?`)) void onDelete(coupon.code); }}><Trash2 className="w-3.5 h-3.5" /></button></div><p className="text-xs mt-2">{coupon.description}</p><span className="text-[10px] text-[#57534E]">{coupon.discountPercent ? `${coupon.discountPercent}% OFF` : coupon.discountFixed ? `-${money(coupon.discountFixed)}` : 'Sem desconto'} · mínimo {money(coupon.minOrderValue)}</span></div>)}</div></div>;
};

const Header: React.FC<{ title: string; subtitle?: string; icon: React.ReactNode; action?: React.ReactNode }> = ({ title, subtitle, icon, action }) => <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3 min-w-0"><div className="w-10 h-10 rounded-2xl bg-[#B91C1C] text-white flex items-center justify-center shrink-0">{icon}</div><div className="min-w-0"><h2 className="text-lg font-extrabold text-[#1C1917] truncate">{title}</h2>{subtitle && <p className="text-xs text-[#57534E]">{subtitle}</p>}</div></div>{action}</div>;
const Empty: React.FC<{ text: string }> = ({ text }) => <p className="text-xs text-[#A8A29E] italic py-8 text-center">{text}</p>;
