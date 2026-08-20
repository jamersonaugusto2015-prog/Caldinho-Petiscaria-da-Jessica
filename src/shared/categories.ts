// Catálogo de ícones e cores das categorias (usado pelo seletor no painel da cozinha).
// Os ícones são emoji porque é o que o cardápio do cliente já renderiza — trocar
// para SVG quebraria as categorias que já estão salvas no banco.

export interface CategoryIcon {
  /** O emoji em si — é isso que vai para `Category.emoji`. */
  char: string;
  /** Nome curto mostrado no tooltip. */
  name: string;
  /** Termos de busca em pt-br (sem acento, minúsculo). */
  tags: string;
}

export interface CategoryIconGroup {
  id: string;
  label: string;
  icons: CategoryIcon[];
}

export const CATEGORY_ICON_GROUPS: CategoryIconGroup[] = [
  {
    id: 'principais',
    label: 'Pratos',
    icons: [
      { char: '🍲', name: 'Caldo', tags: 'caldo caldinho sopa panela ensopado' },
      { char: '🥘', name: 'Panela', tags: 'panela paella cozido guisado' },
      { char: '🍛', name: 'Prato feito', tags: 'prato feito pf arroz curry almoco' },
      { char: '🍚', name: 'Arroz', tags: 'arroz branco acompanhamento' },
      { char: '🍜', name: 'Macarrão', tags: 'macarrao lamen sopa massa noodles' },
      { char: '🍝', name: 'Massa', tags: 'massa espaguete macarrao italiano' },
      { char: '🥩', name: 'Carne', tags: 'carne bife picanha churrasco boi' },
      { char: '🍗', name: 'Frango', tags: 'frango coxa galinha ave' },
      { char: '🍖', name: 'Costela', tags: 'costela carne osso churrasco' },
      { char: '🥓', name: 'Bacon', tags: 'bacon toucinho porco' },
      { char: '🌭', name: 'Cachorro-quente', tags: 'cachorro quente hot dog dogao salsicha' },
      { char: '🍔', name: 'Hambúrguer', tags: 'hamburguer burger lanche sanduiche x-burguer' },
      { char: '🥪', name: 'Sanduíche', tags: 'sanduiche lanche misto pao' },
      { char: '🌮', name: 'Taco', tags: 'taco mexicano' },
      { char: '🌯', name: 'Burrito', tags: 'burrito wrap enrolado mexicano' },
      { char: '🥙', name: 'Pita', tags: 'pita esfiha kebab arabe' },
      { char: '🍕', name: 'Pizza', tags: 'pizza fatia italiana' },
      { char: '🥟', name: 'Pastel', tags: 'pastel guioza empanado' },
      { char: '🍱', name: 'Combo', tags: 'combo marmita bento kit box' },
      { char: '🍳', name: 'Ovo', tags: 'ovo frito cafe manha omelete' },
      { char: '🥞', name: 'Panqueca', tags: 'panqueca cafe manha' },
      { char: '🧆', name: 'Bolinho', tags: 'bolinho kibe falafel frito' },
    ],
  },
  {
    id: 'petiscos',
    label: 'Petiscos',
    icons: [
      { char: '🍤', name: 'Camarão', tags: 'camarao petisco frito frutos do mar' },
      { char: '🍟', name: 'Batata frita', tags: 'batata frita porcao fritas petisco' },
      { char: '🧀', name: 'Queijo', tags: 'queijo coalho tabua petisco' },
      { char: '🥨', name: 'Pretzel', tags: 'pretzel salgado aperitivo' },
      { char: '🍿', name: 'Pipoca', tags: 'pipoca snack petisco' },
      { char: '🥜', name: 'Amendoim', tags: 'amendoim castanha petisco' },
      { char: '🫒', name: 'Azeitona', tags: 'azeitona aperitivo tira gosto' },
      { char: '🥓', name: 'Torresmo', tags: 'torresmo bacon porco petisco' },
      { char: '🍢', name: 'Espetinho', tags: 'espetinho espeto churrasco palito' },
      { char: '🍡', name: 'Espeto doce', tags: 'espeto doce bolinha' },
      { char: '🥠', name: 'Biscoito', tags: 'biscoito sorte cracker' },
      { char: '🧅', name: 'Cebola', tags: 'cebola anel onion rings' },
    ],
  },
  {
    id: 'mar',
    label: 'Frutos do mar',
    icons: [
      { char: '🦐', name: 'Camarão', tags: 'camarao frutos do mar' },
      { char: '🦀', name: 'Caranguejo', tags: 'caranguejo siri casquinha' },
      { char: '🦞', name: 'Lagosta', tags: 'lagosta frutos do mar' },
      { char: '🐟', name: 'Peixe', tags: 'peixe pescado frito' },
      { char: '🐠', name: 'Peixe tropical', tags: 'peixe tropical mar' },
      { char: '🦑', name: 'Lula', tags: 'lula anel frito' },
      { char: '🦪', name: 'Ostra', tags: 'ostra marisco frutos do mar' },
      { char: '🐚', name: 'Marisco', tags: 'marisco concha sururu' },
      { char: '🍣', name: 'Sushi', tags: 'sushi japones oriental' },
      { char: '🍥', name: 'Kamaboko', tags: 'japones oriental peixe' },
    ],
  },
  {
    id: 'bebidas',
    label: 'Bebidas',
    icons: [
      { char: '🥤', name: 'Refrigerante', tags: 'refrigerante refri copo bebida suco' },
      { char: '🧃', name: 'Suco', tags: 'suco caixinha natural bebida' },
      { char: '🍺', name: 'Cerveja', tags: 'cerveja chopp breja gelada bebida' },
      { char: '🍻', name: 'Brinde', tags: 'cerveja brinde bar bebida' },
      { char: '🍹', name: 'Drink', tags: 'drink coquetel caipirinha tropical' },
      { char: '🍸', name: 'Coquetel', tags: 'coquetel martini drink bar' },
      { char: '🍷', name: 'Vinho', tags: 'vinho taca tinto' },
      { char: '🥂', name: 'Espumante', tags: 'espumante champanhe brinde' },
      { char: '🥃', name: 'Destilado', tags: 'whisky cachaca dose destilado' },
      { char: '🍾', name: 'Garrafa', tags: 'garrafa champanhe comemoracao' },
      { char: '☕', name: 'Café', tags: 'cafe expresso quente' },
      { char: '🍵', name: 'Chá', tags: 'cha quente infusao' },
      { char: '🧋', name: 'Milkshake', tags: 'milkshake bubble tea shake' },
      { char: '🥛', name: 'Leite', tags: 'leite vitamina copo' },
      { char: '🧉', name: 'Chimarrão', tags: 'chimarrao terere mate' },
      { char: '🧊', name: 'Gelo', tags: 'gelo gelado bebida' },
    ],
  },
  {
    id: 'doces',
    label: 'Doces',
    icons: [
      { char: '🍰', name: 'Bolo', tags: 'bolo fatia sobremesa doce' },
      { char: '🎂', name: 'Bolo de festa', tags: 'bolo aniversario festa doce' },
      { char: '🧁', name: 'Cupcake', tags: 'cupcake bolinho doce' },
      { char: '🍮', name: 'Pudim', tags: 'pudim flan sobremesa doce' },
      { char: '🍨', name: 'Sorvete', tags: 'sorvete sundae gelado sobremesa' },
      { char: '🍦', name: 'Casquinha', tags: 'sorvete casquinha gelado' },
      { char: '🍩', name: 'Rosquinha', tags: 'rosquinha donut doce' },
      { char: '🍪', name: 'Cookie', tags: 'cookie biscoito doce' },
      { char: '🍫', name: 'Chocolate', tags: 'chocolate barra doce' },
      { char: '🍬', name: 'Bala', tags: 'bala doce guloseima' },
      { char: '🍭', name: 'Pirulito', tags: 'pirulito doce guloseima' },
      { char: '🥧', name: 'Torta', tags: 'torta doce fatia' },
      { char: '🍯', name: 'Mel', tags: 'mel doce adocante' },
      { char: '🥮', name: 'Doce recheado', tags: 'doce recheado sobremesa' },
    ],
  },
  {
    id: 'padaria',
    label: 'Padaria',
    icons: [
      { char: '🍞', name: 'Pão', tags: 'pao padaria forma' },
      { char: '🥖', name: 'Baguete', tags: 'baguete pao frances padaria' },
      { char: '🥐', name: 'Croissant', tags: 'croissant padaria cafe' },
      { char: '🥯', name: 'Bagel', tags: 'bagel pao padaria' },
      { char: '🫓', name: 'Tapioca', tags: 'tapioca beiju pao chato' },
      { char: '🧇', name: 'Waffle', tags: 'waffle cafe doce' },
    ],
  },
  {
    id: 'saudavel',
    label: 'Saudável',
    icons: [
      { char: '🥗', name: 'Salada', tags: 'salada verde saudavel fit' },
      { char: '🥦', name: 'Brócolis', tags: 'brocolis legume vegano saudavel' },
      { char: '🥕', name: 'Cenoura', tags: 'cenoura legume vegano' },
      { char: '🌽', name: 'Milho', tags: 'milho espiga legume' },
      { char: '🍅', name: 'Tomate', tags: 'tomate legume salada' },
      { char: '🥑', name: 'Abacate', tags: 'abacate saudavel fit' },
      { char: '🥬', name: 'Folhas', tags: 'alface folha verde salada' },
      { char: '🍎', name: 'Maçã', tags: 'maca fruta' },
      { char: '🍌', name: 'Banana', tags: 'banana fruta' },
      { char: '🍓', name: 'Morango', tags: 'morango fruta' },
      { char: '🍊', name: 'Laranja', tags: 'laranja fruta suco' },
      { char: '🍉', name: 'Melancia', tags: 'melancia fruta' },
      { char: '🍇', name: 'Uva', tags: 'uva fruta' },
      { char: '🍍', name: 'Abacaxi', tags: 'abacaxi fruta' },
      { char: '🥥', name: 'Coco', tags: 'coco fruta agua' },
      { char: '🌱', name: 'Vegano', tags: 'vegano vegetariano planta verde' },
    ],
  },
  {
    id: 'geral',
    label: 'Geral',
    icons: [
      { char: '🍽️', name: 'Prato', tags: 'prato talher geral padrao cardapio' },
      { char: '🔥', name: 'Destaque', tags: 'destaque quente promocao fogo popular' },
      { char: '⭐', name: 'Favoritos', tags: 'estrela favorito destaque mais vendidos' },
      { char: '🏆', name: 'Campeões', tags: 'trofeu campeao top mais vendidos' },
      { char: '💰', name: 'Econômico', tags: 'dinheiro barato promocao economico' },
      { char: '🎁', name: 'Cortesia', tags: 'presente brinde cortesia gratis' },
      { char: '🎉', name: 'Festa', tags: 'festa comemoracao evento' },
      { char: '⚡', name: 'Rápido', tags: 'rapido flash express relampago' },
      { char: '🌶️', name: 'Picante', tags: 'pimenta picante apimentado' },
      { char: '🧂', name: 'Temperos', tags: 'sal tempero condimento' },
      { char: '🥡', name: 'Delivery', tags: 'delivery entrega viagem embalagem' },
      { char: '👶', name: 'Infantil', tags: 'infantil crianca kids' },
      { char: '🌙', name: 'Noturno', tags: 'noite madrugada lua' },
      { char: '☀️', name: 'Café da manhã', tags: 'manha sol cafe' },
      { char: '🎯', name: 'Do dia', tags: 'alvo dia especial sugestao' },
      { char: '🛒', name: 'Mercado', tags: 'mercado compras carrinho' },
    ],
  },
];

/** Lista achatada — usada pela busca do seletor. */
export const CATEGORY_ICONS: CategoryIcon[] = CATEGORY_ICON_GROUPS.flatMap((group) => group.icons);

/** Compatibilidade: paleta curta de emoji usada antes do seletor completo. */

export interface CategoryColor {
  hex: string;
  name: string;
}

/**
 * Paleta fechada: cores com contraste suficiente para texto branco em cima e
 * que ficam legíveis no fundo 10% que o cardápio do cliente usa nos ícones.
 */
export const CATEGORY_COLOR_OPTIONS: CategoryColor[] = [
  { hex: '#B91C1C', name: 'Vermelho' },
  { hex: '#C2410C', name: 'Laranja' },
  { hex: '#D97706', name: 'Âmbar' },
  { hex: '#CA8A04', name: 'Mostarda' },
  { hex: '#4D7C0F', name: 'Oliva' },
  { hex: '#059669', name: 'Verde' },
  { hex: '#0F766E', name: 'Teal' },
  { hex: '#0891B2', name: 'Ciano' },
  { hex: '#2563EB', name: 'Azul' },
  { hex: '#4F46E5', name: 'Índigo' },
  { hex: '#7C3AED', name: 'Violeta' },
  { hex: '#C026D3', name: 'Magenta' },
  { hex: '#DB2777', name: 'Rosa' },
  { hex: '#E11D48', name: 'Framboesa' },
  { hex: '#78716C', name: 'Pedra' },
  { hex: '#44403C', name: 'Grafite' },
];

/** Compatibilidade: só os valores hex. */

/** Remove acento e caixa para a busca aceitar "camarao" e "Camarão". */
export const normalizeSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export const searchCategoryIcons = (query: string): CategoryIcon[] => {
  const term = normalizeSearch(query);
  if (!term) return CATEGORY_ICONS;
  return CATEGORY_ICONS.filter(
    (icon) => icon.tags.includes(term) || normalizeSearch(icon.name).includes(term)
  );
};

/** Sugestões para o estado vazio: um cardápio começa com estas quatro. */
export const STARTER_CATEGORIES: { label: string; emoji: string; color: string }[] = [
  { label: 'Caldinhos', emoji: '🍲', color: '#C2410C' },
  { label: 'Petiscos', emoji: '🍤', color: '#7C3AED' },
  { label: 'Bebidas', emoji: '🥤', color: '#2563EB' },
  { label: 'Combos', emoji: '🍱', color: '#059669' },
];
