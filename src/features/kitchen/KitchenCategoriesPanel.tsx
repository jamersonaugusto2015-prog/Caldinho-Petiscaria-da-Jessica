import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, Reorder, motion, useDragControls, useReducedMotion } from 'motion/react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Info,
  Loader2,
  Lock,
  Package,
  Pencil,
  PlusCircle,
  Search,
  Sparkles,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import type { Category, Product } from '../../types';
import {
  CATEGORY_COLOR_OPTIONS,
  STARTER_CATEGORIES,
  normalizeSearch,
} from '../../shared/categories';
import { CategoryIconPicker } from './CategoryIconPicker';

const LABEL_MAX = 30;

interface Props {
  categories: Category[];
  products: Product[];
  onSave: (category: Category) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
}

/**
 * Tela de categorias. A ordem desta lista é a ordem do cardápio do cliente, por
 * isso a tela abre com a prévia do que o cliente vê: quem arrasta um card enxerga
 * na hora o efeito, sem precisar abrir o app do cliente para conferir.
 */
export const KitchenCategoriesPanel: React.FC<Props> = ({
  categories,
  products,
  onSave,
  onDelete,
  onReorder,
}) => {
  const [order, setOrder] = useState<string[]>(() => categories.map((category) => category.id));
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [dragging, setDragging] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const reduceMotion = useReducedMotion();

  // `onDragEnd` do card dispara fora do ciclo de render, então lê a ordem pela ref.
  const orderRef = useRef<string[]>(order);
  orderRef.current = order;

  // A lista do servidor manda; só não sobrescreve enquanto o card está na mão.
  useEffect(() => {
    if (dragging) return;
    setOrder(categories.map((category) => category.id));
  }, [categories, dragging]);

  const byId = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );
  const ordered = useMemo(
    () => order.map((id) => byId.get(id)).filter((category): category is Category => Boolean(category)),
    [order, byId]
  );

  const countFor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) counts.set(product.category, (counts.get(product.category) || 0) + 1);
    return counts;
  }, [products]);

  const term = normalizeSearch(query);
  const visible = term
    ? ordered.filter((category) => normalizeSearch(category.label).includes(term))
    : ordered;
  const filtering = Boolean(term);

  const orphanCount = products.filter((product) => !byId.has(product.category)).length;
  const emptyCount = ordered.filter((category) => !countFor.get(category.id)).length;

  const flashSaved = (id: string) => {
    setJustSaved(id);
    window.setTimeout(() => setJustSaved((current) => (current === id ? null : current)), 1400);
  };

  const handleSave = async (category: Category) => {
    await onSave(category);
    flashSaved(category.id);
    setEditing(null);
  };

  const seedStarters = async () => {
    setSeeding(true);
    try {
      for (const [index, starter] of STARTER_CATEGORIES.entries()) {
        await onSave({ id: `cat-${Date.now()}-${index}`, sort: index, ...starter });
      }
    } finally {
      setSeeding(false);
    }
  };

  const move = (id: string, direction: -1 | 1) => {
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    void onReorder(next);
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-[#B91C1C] text-white flex items-center justify-center shrink-0">
            <Tags className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-[#1C1917] truncate">Categorias</h2>
            <p className="text-xs text-[#57534E]">
              {ordered.length === 0
                ? 'Nenhuma categoria ainda.'
                : `${ordered.length} categoria(s)${emptyCount ? ` · ${emptyCount} sem produto` : ''}`}
            </p>
          </div>
        </div>
        <button className="btn-primary shrink-0" onClick={() => setEditing('new')}>
          <PlusCircle className="w-4 h-4" />
          Nova categoria
        </button>
      </header>

      {ordered.length === 0 ? (
        <EmptyState onCreate={() => setEditing('new')} onSeed={seedStarters} seeding={seeding} />
      ) : (
        <>
          <ClientPreview categories={ordered} />

          {orphanCount > 0 && (
            <Notice tone="warn">
              {orphanCount} produto(s) apontam para uma categoria que não existe mais. Abra o cardápio e
              troque a categoria deles para voltarem a aparecer para o cliente.
            </Notice>
          )}

          {ordered.length > 4 && (
            <div className="relative">
              <Search className="w-4 h-4 text-[#A8A29E] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                className="input pl-9 py-2.5"
                placeholder="Buscar categoria pelo nome..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          )}

          <p className="flex items-center gap-1.5 text-[11px] text-[#57534E]">
            <GripVertical className="w-3.5 h-3.5 text-[#A8A29E]" />
            {filtering
              ? 'Limpe a busca para poder arrastar e reordenar.'
              : 'Arraste pela alça para mudar a ordem — é a mesma ordem que o cliente vê.'}
          </p>

          {visible.length === 0 ? (
            <p className="text-xs text-[#A8A29E] italic py-8 text-center">
              Nenhuma categoria com “{query.trim()}”.
            </p>
          ) : filtering ? (
            <div className="flex flex-col gap-2.5 max-w-3xl">
              {visible.map((category) => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  position={order.indexOf(category.id) + 1}
                  total={order.length}
                  count={countFor.get(category.id) || 0}
                  saved={justSaved === category.id}
                  locked
                  onEdit={() => setEditing(category)}
                  onDelete={() => onDelete(category.id)}
                  onMove={move}
                />
              ))}
            </div>
          ) : (
            <Reorder.Group
              axis="y"
              values={order}
              onReorder={setOrder}
              className="flex flex-col gap-2.5 max-w-3xl list-none p-0 m-0"
            >
              <AnimatePresence initial={false}>
                {visible.map((category) => (
                  <ReorderableCard
                    key={category.id}
                    category={category}
                    position={order.indexOf(category.id) + 1}
                    total={order.length}
                    count={countFor.get(category.id) || 0}
                    saved={justSaved === category.id}
                    reduceMotion={Boolean(reduceMotion)}
                    onEdit={() => setEditing(category)}
                    onDelete={() => onDelete(category.id)}
                    onMove={move}
                    onDragStart={() => setDragging(true)}
                    onDragEnd={() => {
                      void onReorder(orderRef.current).finally(() => setDragging(false));
                    }}
                  />
                ))}
              </AnimatePresence>
            </Reorder.Group>
          )}
        </>
      )}

      <AnimatePresence>
        {editing && (
          <CategoryEditor
            value={editing}
            nextSort={ordered.length}
            usedLabels={ordered
              .filter((category) => editing === 'new' || category.id !== editing.id)
              .map((category) => normalizeSearch(category.label))}
            productCount={editing === 'new' ? 0 : countFor.get(editing.id) || 0}
            onClose={() => setEditing(null)}
            onSave={handleSave}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

/* ------------------------------------------------------------------ prévia */

/** Réplica da faixa de categorias do app do cliente, na mesma ordem da lista. */
const ClientPreview: React.FC<{ categories: Category[] }> = ({ categories }) => (
  <section className="rounded-2xl border border-[#E7E5E4] bg-white overflow-hidden">
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#F5F5F4]">
      <Sparkles className="w-3.5 h-3.5 text-[#B91C1C]" />
      <h3 className="text-[11px] uppercase tracking-wide font-black text-[#57534E]">
        Como o cliente vê
      </h3>
    </div>
    <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 py-3 bg-[#FAFAF9]">
      <div className="flex flex-col items-center gap-1.5 shrink-0 w-16">
        <div className="h-14 w-14 rounded-2xl bg-[#FEE2E2] ring-2 ring-[#B91C1C] flex items-center justify-center text-2xl">
          ⭐
        </div>
        <span className="text-[10px] font-semibold text-[#B91C1C] text-center leading-tight">Todos</span>
      </div>
      {categories.map((category) => (
        <motion.div
          key={category.id}
          layout
          transition={{ type: 'spring', stiffness: 460, damping: 34 }}
          className="flex flex-col items-center gap-1.5 shrink-0 w-16"
        >
          <div
            className="h-14 w-14 rounded-2xl flex items-center justify-center text-2xl"
            style={{ backgroundColor: `${category.color}1A` }}
          >
            {category.emoji}
          </div>
          <span className="text-[10px] font-semibold text-[#44403C] text-center leading-tight line-clamp-2">
            {category.label}
          </span>
        </motion.div>
      ))}
    </div>
  </section>
);

/* -------------------------------------------------------------------- card */

interface CardProps {
  category: Category;
  position: number;
  total: number;
  count: number;
  saved: boolean;
  locked?: boolean;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onMove: (id: string, direction: -1 | 1) => void;
}

const ReorderableCard: React.FC<
  CardProps & {
    reduceMotion: boolean;
    onDragStart: () => void;
    onDragEnd: () => void;
  }
> = ({ reduceMotion, onDragStart, onDragEnd, ...card }) => {
  const dragControls = useDragControls();
  const [held, setHeld] = useState(false);

  return (
    <Reorder.Item
      value={card.category.id}
      dragListener={false}
      dragControls={dragControls}
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 480, damping: 36 }}
      whileDrag={{ scale: 1.03, zIndex: 20, boxShadow: '0 18px 40px rgba(28,25,23,0.18)' }}
      onDragStart={() => {
        setHeld(true);
        onDragStart();
      }}
      onDragEnd={() => {
        setHeld(false);
        onDragEnd();
      }}
      className={`list-none ${held ? 'cursor-grabbing' : ''}`}
    >
      <CardBody
        {...card}
        onGrab={(event) => {
          dragControls.start(event);
        }}
      />
    </Reorder.Item>
  );
};

const CategoryCard: React.FC<CardProps> = (card) => (
  <div className="list-none">
    <CardBody {...card} />
  </div>
);

const CardBody: React.FC<CardProps & { onGrab?: (event: React.PointerEvent) => void }> = ({
  category,
  position,
  total,
  count,
  saved,
  locked,
  onEdit,
  onDelete,
  onMove,
  onGrab,
}) => {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const blocked = count > 0;

  return (
    <article
      className="relative bg-white rounded-2xl border border-[#E7E5E4] overflow-hidden transition-shadow hover:shadow-md"
      style={{ isolation: 'isolate' }}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: category.color }} aria-hidden />

      <div className="flex items-center gap-3 p-3 pl-4">
        <button
          type="button"
          onPointerDown={locked ? undefined : onGrab}
          disabled={locked}
          aria-label={locked ? 'Arrastar indisponível na busca' : `Arrastar ${category.label}`}
          className="shrink-0 w-7 h-9 rounded-lg text-[#A8A29E] hover:text-[#1C1917] hover:bg-[#F5F5F4] flex items-center justify-center transition disabled:opacity-30 disabled:hover:bg-transparent touch-none cursor-grab active:cursor-grabbing disabled:cursor-not-allowed pointer-coarse:w-11 pointer-coarse:h-11"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        <div
          className="relative shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
          style={{ backgroundColor: `${category.color}1A` }}
        >
          {category.emoji}
          <span className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-white border border-[#E7E5E4] text-[10px] font-black text-[#57534E] flex items-center justify-center">
            {position}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="font-extrabold text-sm text-[#1C1917] truncate" title={category.label}>
            {category.label}
          </h3>
          <p className="flex items-center gap-1 text-[11px] text-[#57534E] mt-0.5">
            <Package className="w-3 h-3" />
            {count === 0 ? 'Nenhum produto' : `${count} produto(s)`}
          </p>
        </div>

        {/* As duas setas empilhadas davam 28x20 cada: no dedo, subir uma
            categoria descia a de baixo. Ficam com 44px de largura e 36 de
            altura em ponteiro grosso — 44 de altura nas duas dobraria a linha,
            e quem reordena no dedo usa a alça de arrastar ao lado. */}
        <div className="flex flex-col shrink-0">
          <button
            type="button"
            aria-label={`Subir ${category.label}`}
            disabled={position <= 1}
            onClick={() => onMove(category.id, -1)}
            className="w-7 h-5 rounded-md text-[#57534E] hover:bg-[#F5F5F4] flex items-center justify-center transition disabled:opacity-25 pointer-coarse:w-11 pointer-coarse:h-9"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Descer ${category.label}`}
            disabled={position >= total}
            onClick={() => onMove(category.id, 1)}
            className="w-7 h-5 rounded-md text-[#57534E] hover:bg-[#F5F5F4] flex items-center justify-center transition disabled:opacity-25 pointer-coarse:w-11 pointer-coarse:h-9"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex gap-1.5 shrink-0">
          <button className="btn-secondary p-2 pointer-coarse:min-w-11" title="Editar" aria-label={`Editar ${category.label}`} onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            className="btn-danger p-2 pointer-coarse:min-w-11"
            title={blocked ? `${count} produto(s) usam esta categoria` : 'Excluir'}
            aria-label={`Excluir ${category.label}`}
            disabled={blocked || removing}
            onClick={() => setConfirming(true)}
          >
            {blocked ? <Lock className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {blocked && (
        <p className="px-4 pb-3 -mt-1 text-[11px] text-[#A8A29E]">
          Para excluir, mova os {count} produto(s) para outra categoria primeiro.
        </p>
      )}

      <AnimatePresence>
        {confirming && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="absolute inset-0 z-10 bg-white/96 backdrop-blur-[1px] flex items-center justify-center gap-2 px-4 text-center"
          >
            <div>
              <p className="text-xs font-bold text-[#1C1917]">Excluir “{category.label}”?</p>
              <div className="flex gap-2 justify-center mt-2">
                <button className="btn-secondary" onClick={() => setConfirming(false)}>
                  Cancelar
                </button>
                <button
                  className="btn-danger"
                  disabled={removing}
                  onClick={async () => {
                    setRemoving(true);
                    try {
                      await onDelete();
                    } finally {
                      setRemoving(false);
                      setConfirming(false);
                    }
                  }}
                >
                  {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Excluir
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {saved && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 520, damping: 24 }}
            className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full bg-[#059669] text-white px-2 py-0.5 text-[10px] font-black shadow"
          >
            <Check className="w-3 h-3" strokeWidth={4} />
            Salvo
          </motion.span>
        )}
      </AnimatePresence>
    </article>
  );
};

/* ------------------------------------------------------------------ editor */

const CategoryEditor: React.FC<{
  value: Category | 'new';
  nextSort: number;
  usedLabels: string[];
  productCount: number;
  onClose: () => void;
  onSave: (category: Category) => Promise<void>;
}> = ({ value, nextSort, usedLabels, productCount, onClose, onSave }) => {
  const original = value === 'new' ? null : value;
  const [label, setLabel] = useState(original?.label || '');
  const [emoji, setEmoji] = useState(original?.emoji || '🍽️');
  const [color, setColor] = useState(original?.color || CATEGORY_COLOR_OPTIONS[0].hex);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

  const dirty =
    label !== (original?.label || '') ||
    emoji !== (original?.emoji || '🍽️') ||
    color !== (original?.color || CATEGORY_COLOR_OPTIONS[0].hex);

  const trimmed = label.trim();
  const duplicated = trimmed.length > 0 && usedLabels.includes(normalizeSearch(trimmed));
  const error = touched && !trimmed ? 'Dê um nome à categoria.' : duplicated ? 'Já existe uma categoria com esse nome.' : null;
  const canSave = Boolean(trimmed) && !duplicated && !saving;

  const [discarding, setDiscarding] = useState(false);
  const tryClose = () => {
    if (dirty) setDiscarding(true);
    else onClose();
  };

  useEffect(() => {
    labelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') tryClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        id: original?.id || `cat-${Date.now()}`,
        label: trimmed.slice(0, LABEL_MAX),
        emoji,
        color,
        sort: original?.sort ?? nextSort,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px] p-0 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) tryClose();
      }}
    >
      <motion.form
        onSubmit={submit}
        initial={reduceMotion ? false : { y: 28, scale: 0.98, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { y: 20, scale: 0.98, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        className="bg-white w-full sm:max-w-lg max-h-[100dvh] sm:max-h-[92vh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
      >
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#E7E5E4]">
          <div className="min-w-0">
            <h3 className="text-lg font-extrabold text-[#1C1917] truncate">
              {original ? 'Editar categoria' : 'Nova categoria'}
            </h3>
            <p className="text-xs text-[#57534E]">
              {original
                ? `${productCount} produto(s) nesta categoria.`
                : 'Escolha um ícone, um nome curto e uma cor.'}
            </p>
          </div>
          <button
            type="button"
            onClick={tryClose}
            aria-label="Fechar"
            className="shrink-0 w-9 h-9 rounded-full border border-[#E7E5E4] text-[#57534E] hover:bg-[#F5F5F4] flex items-center justify-center transition pointer-coarse:w-11 pointer-coarse:h-11"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          <div className="flex items-start gap-4">
            <CategoryIconPicker value={emoji} color={color} onChange={setEmoji} />
            <div className="flex-1 min-w-0">
              <label htmlFor="category-label" className="block text-[11px] uppercase tracking-wide font-black text-[#57534E] mb-1.5">
                Nome
              </label>
              <input
                id="category-label"
                ref={labelRef}
                className="input py-2.5 text-sm"
                placeholder="Ex.: Caldinhos"
                maxLength={LABEL_MAX}
                value={label}
                onBlur={() => setTouched(true)}
                onChange={(event) => setLabel(event.target.value)}
                aria-invalid={Boolean(error)}
              />
              <div className="flex items-center justify-between gap-2 mt-1">
                <span className={`text-[11px] ${error ? 'text-[#B91C1C] font-bold' : 'text-[#A8A29E]'}`}>
                  {error || 'Nomes curtos cabem melhor no celular do cliente.'}
                </span>
                <span className="text-[11px] text-[#A8A29E] tabular-nums shrink-0">
                  {label.length}/{LABEL_MAX}
                </span>
              </div>
            </div>
          </div>

          <div>
            <span className="block text-[11px] uppercase tracking-wide font-black text-[#57534E] mb-2">Cor</span>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLOR_OPTIONS.map((option) => {
                const active = color.toUpperCase() === option.hex.toUpperCase();
                return (
                  <button
                    key={option.hex}
                    type="button"
                    title={option.name}
                    aria-label={option.name}
                    aria-pressed={active}
                    onClick={() => setColor(option.hex)}
                    className="relative w-9 h-9 rounded-xl transition-transform duration-150 hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#1C1917]/30"
                    style={{ backgroundColor: option.hex }}
                  >
                    {active && (
                      <motion.span
                        layoutId="category-color-check"
                        className="absolute inset-0 rounded-xl ring-2 ring-offset-2 ring-[#1C1917] flex items-center justify-center"
                      >
                        <Check className="w-4 h-4 text-white" strokeWidth={4} />
                      </motion.span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="block text-[11px] uppercase tracking-wide font-black text-[#57534E] mb-2">
              Prévia no cardápio
            </span>
            <div className="rounded-2xl border border-[#E7E5E4] bg-[#FAFAF9] p-4 flex items-center gap-5">
              <div className="flex flex-col items-center gap-1.5 w-16">
                <div
                  className="h-14 w-14 rounded-2xl flex items-center justify-center text-2xl"
                  style={{ backgroundColor: `${color}1A` }}
                >
                  {emoji}
                </div>
                <span className="text-[10px] font-semibold text-[#44403C] text-center leading-tight line-clamp-2">
                  {trimmed || 'Sem nome'}
                </span>
              </div>
              <div className="flex flex-col items-center gap-1.5 w-16">
                <div
                  className="h-14 w-14 rounded-2xl flex items-center justify-center text-2xl"
                  style={{ backgroundColor: `${color}33`, boxShadow: `0 0 0 2px ${color}, 0 6px 16px ${color}26` }}
                >
                  {emoji}
                </div>
                <span className="text-[10px] font-bold text-center leading-tight line-clamp-2" style={{ color }}>
                  {trimmed || 'Sem nome'}
                </span>
              </div>
              <p className="text-[11px] text-[#57534E] flex-1">
                Normal e selecionada. É assim que aparece na faixa de categorias do cliente.
              </p>
            </div>
          </div>
        </div>

        {/* No celular a folha encosta no rodapé da tela: a barra de gestos do iOS
            cobria estes botões. `pb-safe` vai num invólucro porque a classe
            (que é CSS solto, fora das camadas do Tailwind) sobrescreveria o
            `py-4` do rodapé e colaria os botões na borda no desktop. */}
        <footer className="pb-safe border-t border-[#E7E5E4] bg-[#FAFAF9]">
          <div className="px-5 py-4">
            {discarding ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-bold text-[#1C1917]">Descartar as mudanças?</p>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary" onClick={() => setDiscarding(false)}>
                    Continuar editando
                  </button>
                  <button type="button" className="btn-danger" onClick={onClose}>
                    Descartar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <button type="button" className="btn-secondary" onClick={tryClose}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary px-5" disabled={!canSave}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {saving ? 'Salvando...' : original ? 'Salvar mudanças' : 'Criar categoria'}
                </button>
              </div>
            )}
          </div>
        </footer>
      </motion.form>
    </motion.div>
  );
};

/* ------------------------------------------------------------------ vazios */

const EmptyState: React.FC<{ onCreate: () => void; onSeed: () => Promise<void>; seeding: boolean }> = ({
  onCreate,
  onSeed,
  seeding,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    className="rounded-2xl border border-dashed border-[#E7E5E4] bg-white px-6 py-10 text-center"
  >
    <div className="w-14 h-14 rounded-2xl bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center mx-auto">
      <Tags className="w-7 h-7" />
    </div>
    <h3 className="text-base font-extrabold text-[#1C1917] mt-3">Seu cardápio ainda não tem seções</h3>
    <p className="text-xs text-[#57534E] mt-1 max-w-sm mx-auto">
      Categorias são as abas que o cliente toca para achar o que quer. Comece com as quatro mais comuns
      e ajuste depois.
    </p>
    <div className="flex flex-wrap gap-2 justify-center mt-4">
      <button className="btn-primary" onClick={() => void onSeed()} disabled={seeding}>
        {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {seeding ? 'Criando...' : 'Usar as 4 sugeridas'}
      </button>
      <button className="btn-secondary" onClick={onCreate} disabled={seeding}>
        <PlusCircle className="w-4 h-4" />
        Criar do zero
      </button>
    </div>
    <div className="flex flex-wrap gap-2 justify-center mt-5">
      {STARTER_CATEGORIES.map((starter) => (
        <span
          key={starter.label}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
          style={{ backgroundColor: `${starter.color}1A`, color: starter.color }}
        >
          <span>{starter.emoji}</span>
          {starter.label}
        </span>
      ))}
    </div>
  </motion.div>
);

const Notice: React.FC<{ tone: 'info' | 'warn'; children: React.ReactNode }> = ({ tone, children }) => (
  <div
    className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11px] ${
      tone === 'warn'
        ? 'bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E]'
        : 'bg-[#F5F5F4] border border-[#E7E5E4] text-[#57534E]'
    }`}
  >
    {tone === 'warn' ? (
      <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
    ) : (
      <Info className="w-4 h-4 shrink-0 mt-px" />
    )}
    <p>{children}</p>
  </div>
);
