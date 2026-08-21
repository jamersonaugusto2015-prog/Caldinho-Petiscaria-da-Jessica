import { ComboChoice } from '../types';

/** Só as escolhas, sem o rótulo do bloco: "Caldinho de Feijão Preto ×2,
 *  Batata Frita Especial Suprema". O rótulo do bloco ("Escolha 2 Caldinhos...")
 *  é um texto de instrução do cardápio — na comanda só interessa o que
 *  escolheram. Repetição do mesmo item vira "×N". */
export function formatComboChoices(choices: ComboChoice[]): string {
  return choiceLabels(choices).join(', ');
}

/** Mesmo conteúdo, em linhas separadas — usado onde cabe quebrar linha. */
export function comboChoiceLines(choices: ComboChoice[]): string[] {
  const labels = choiceLabels(choices);
  return labels.length === 0 ? [] : [labels.join(', ')];
}

function choiceLabels(choices: ComboChoice[]): string[] {
  if (!choices || choices.length === 0) return [];
  // optionLabel -> vezes escolhidas (a mesma opção pode se repetir no bloco)
  const counts = new Map<string, number>();
  for (const c of choices) {
    counts.set(c.optionLabel, (counts.get(c.optionLabel) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => (count > 1 ? `${label} ×${count}` : label));
}
