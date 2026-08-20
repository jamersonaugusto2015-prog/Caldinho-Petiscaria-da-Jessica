import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Search, Smile, X } from 'lucide-react';
import {
  CATEGORY_ICON_GROUPS,
  normalizeSearch,
  searchCategoryIcons,
  type CategoryIcon,
} from '../../shared/categories';

const RECENT_KEY = 'caldinho:category-icons:recent';
const RECENT_MAX = 12;

const readRecent = (): string[] => {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const pushRecent = (char: string) => {
  try {
    const next = [char, ...readRecent().filter((item) => item !== char)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* modo privado do navegador: seguir sem histórico */
  }
};

interface Props {
  /** Emoji escolhido no momento. */
  value: string;
  /** Cor da categoria — pinta o fundo do botão e do item marcado. */
  color: string;
  onChange: (emoji: string) => void;
}

/**
 * Botão + popover de ícones. O popover abre ancorado no botão e vira folha
 * inteira no celular, porque uma grade de 8 colunas não cabe num popover de
 * 260px em tela pequena.
 */
/** Altura aproximada do popover, usada só para escolher abrir para cima ou para baixo. */
const POPOVER_HEIGHT = 400;

export const CategoryIconPicker: React.FC<Props> = ({ value, color, onChange }) => {
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();
  const open = anchor !== null;

  /**
   * O popover é `fixed`: o corpo do modal rola e cortaria um popover `absolute`.
   *
   * A conta usa o `visualViewport` e não o `window.innerHeight` porque no iOS,
   * com o teclado aberto, `innerHeight` continua contando a tela toda: o popover
   * era colocado "dentro da tela" num ponto que o teclado já cobria, e a grade de
   * ícones ficava escondida atrás dele. O `clamp` no fim garante que ele nunca
   * saia por cima nem por baixo, mesmo quando não cabe em lugar nenhum — nesse
   * caso o `max-h` do próprio painel corta e a lista rola por dentro.
   */
  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewport = window.visualViewport;
    const viewWidth = viewport?.width ?? window.innerWidth;
    const viewHeight = viewport?.height ?? window.innerHeight;
    const width = Math.min(viewWidth * 0.92, 360);
    const height = Math.min(POPOVER_HEIGHT, viewHeight - 16);
    const left = Math.min(Math.max(8, rect.left), viewWidth - width - 8);
    const below = rect.bottom + 8;
    const preferred = below + height > viewHeight - 8 ? rect.top - height - 8 : below;
    const top = Math.min(Math.max(8, preferred), Math.max(8, viewHeight - height - 8));
    setAnchor({ left, top });
  };

  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    // No iOS abrir/fechar o teclado e recolher a barra do Safari não disparam
    // `resize` na janela — só no `visualViewport`.
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setAnchor(null) : place())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Ícone da categoria: ${value}. Clique para trocar`}
        className="group relative w-[68px] h-[68px] rounded-2xl border-2 flex items-center justify-center text-3xl transition-[border-color,transform,box-shadow] duration-200 hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{
          backgroundColor: `${color}1A`,
          borderColor: open ? color : 'transparent',
          boxShadow: open ? `0 0 0 4px ${color}22` : 'none',
        }}
      >
        <motion.span
          key={value}
          initial={reduceMotion ? false : { scale: 0.55, rotate: -14, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 22 }}
          className="block leading-none"
        >
          {value}
        </motion.span>
        <span
          className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white border border-[#E7E5E4] shadow-sm flex items-center justify-center text-[#57534E] transition group-hover:text-[#1C1917]"
          aria-hidden
        >
          <Smile className="w-3.5 h-3.5" />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <IconPopover
            value={value}
            color={color}
            anchor={anchor}
            onPick={(char) => {
              pushRecent(char);
              onChange(char);
              setAnchor(null);
              buttonRef.current?.focus();
            }}
            onClose={() => {
              setAnchor(null);
              buttonRef.current?.focus();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

const IconPopover: React.FC<{
  value: string;
  color: string;
  anchor: { left: number; top: number };
  onPick: (char: string) => void;
  onClose: () => void;
}> = ({ value, color, anchor, onPick, onClose }) => {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>('todos');
  const recent = useMemo(() => readRecent(), []);
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    // `setTimeout` para não capturar o mesmo clique que abriu o popover.
    const timer = window.setTimeout(() => document.addEventListener('pointerdown', onPointerDown), 0);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown);
      window.clearTimeout(timer);
    };
  }, [onClose]);

  const results = useMemo(() => {
    const term = normalizeSearch(query);
    if (term) return searchCategoryIcons(term);
    if (group === 'todos') return null; // null = mostrar agrupado
    return CATEGORY_ICON_GROUPS.find((item) => item.id === group)?.icons ?? [];
  }, [query, group]);

  const visibleGroups = useMemo(
    () => (group === 'todos' ? CATEGORY_ICON_GROUPS : []),
    [group]
  );

  const custom = query.trim();
  const isCustomEmoji = custom.length > 0 && custom.length <= 4 && !/[a-zA-Z0-9]/.test(custom);

  return (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-label="Escolher ícone da categoria"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 460, damping: 32 }}
      style={{ left: anchor.left, top: anchor.top }}
      className="fixed z-[60] flex max-h-[calc(100dvh-16px)] w-[min(92vw,360px)] origin-top-left flex-col overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white shadow-2xl"
    >
      <div className="p-3 pb-2 border-b border-[#F5F5F4]">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#A8A29E] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchRef}
              className="input pl-9 py-2"
              placeholder="Buscar: camarão, cerveja, doce..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar seletor"
            className="w-8 h-8 shrink-0 rounded-full border border-[#E7E5E4] text-[#57534E] hover:bg-[#F5F5F4] flex items-center justify-center transition pointer-coarse:w-11 pointer-coarse:h-11"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {!query && (
          <div className="flex gap-1 overflow-x-auto no-scrollbar mt-2 -mx-1 px-1">
            <GroupChip active={group === 'todos'} label="Todos" onClick={() => setGroup('todos')} />
            {CATEGORY_ICON_GROUPS.map((item) => (
              <GroupChip
                key={item.id}
                active={group === item.id}
                label={item.label}
                onClick={() => setGroup(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 max-h-[300px] flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-3">
        {isCustomEmoji && (
          <section>
            <GroupTitle>Usar este</GroupTitle>
            <div className="grid grid-cols-8 gap-1">
              <IconButton icon={{ char: custom, name: custom, tags: '' }} selected={value === custom} color={color} onPick={onPick} />
            </div>
          </section>
        )}

        {!query && recent.length > 0 && (
          <section>
            <GroupTitle>Usados recentemente</GroupTitle>
            <div className="grid grid-cols-8 gap-1">
              {recent.map((char) => (
                <IconButton
                  key={`recent-${char}`}
                  icon={{ char, name: char, tags: '' }}
                  selected={value === char}
                  color={color}
                  onPick={onPick}
                />
              ))}
            </div>
          </section>
        )}

        {results && (
          <section>
            {query && <GroupTitle>{results.length} resultado(s)</GroupTitle>}
            <div className="grid grid-cols-8 gap-1">
              {results.map((icon, index) => (
                <IconButton
                  key={`${icon.char}-${index}`}
                  icon={icon}
                  selected={value === icon.char}
                  color={color}
                  onPick={onPick}
                />
              ))}
            </div>
            {results.length === 0 && (
              <p className="text-[11px] text-[#A8A29E] italic py-4 text-center">
                Nada encontrado. Cole qualquer emoji na busca para usá-lo.
              </p>
            )}
          </section>
        )}

        {visibleGroups.map((item) => (
          <section key={item.id}>
            <GroupTitle>{item.label}</GroupTitle>
            <div className="grid grid-cols-8 gap-1">
              {item.icons.map((icon, index) => (
                <IconButton
                  key={`${item.id}-${icon.char}-${index}`}
                  icon={icon}
                  selected={value === icon.char}
                  color={color}
                  onPick={onPick}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </motion.div>
  );
};

const GroupTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-[10px] uppercase tracking-wide font-black text-[#A8A29E] mb-1.5">{children}</h4>
);

const GroupChip: React.FC<{ active: boolean; label: string; onClick: () => void }> = ({
  active,
  label,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold border transition ${
      active
        ? 'bg-[#1C1917] text-white border-[#1C1917]'
        : 'bg-white text-[#57534E] border-[#E7E5E4] hover:bg-[#F5F5F4]'
    }`}
  >
    {label}
  </button>
);

const IconButton: React.FC<{
  icon: CategoryIcon;
  selected: boolean;
  color: string;
  onPick: (char: string) => void;
}> = ({ icon, selected, color, onPick }) => (
  <button
    type="button"
    title={icon.name}
    aria-label={icon.name}
    aria-pressed={selected}
    onClick={() => onPick(icon.char)}
    className="relative aspect-square rounded-xl text-xl flex items-center justify-center transition-[background-color,transform] duration-150 hover:scale-110 hover:bg-[#F5F5F4] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1917]/30"
    style={selected ? { backgroundColor: `${color}26` } : undefined}
  >
    <span className="leading-none">{icon.char}</span>
    {selected && (
      <span
        className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full text-white flex items-center justify-center shadow"
        style={{ backgroundColor: color }}
        aria-hidden
      >
        <Check className="w-2.5 h-2.5" strokeWidth={4} />
      </span>
    )}
  </button>
);
