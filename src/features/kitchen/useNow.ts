import { useEffect, useState } from 'react';

/**
 * Relógio local para os prazos calculados na tela. Só a tela que mostra uma
 * contagem monta este hook, para o tique não repintar o resto do painel.
 */
export const useNow = (intervalMs = 1000): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
};
