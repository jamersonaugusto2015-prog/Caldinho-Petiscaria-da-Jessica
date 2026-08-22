import React from 'react';
import { useKitchenOrders } from './KitchenOrdersStore';
import { useKitchenCatalog } from './KitchenCatalogStore';
import { useKitchenDrivers } from './KitchenDriversStore';
import { useKitchenSettings } from './KitchenSettingsStore';
import { useKitchenReports } from './KitchenReportsStore';

/**
 * O aviso de "não consegui carregar" da cozinha.
 *
 * As stores já sabiam do erro e da recarga, mas ninguém lia esses campos: uma
 * queda de rede no boot deixava o quadro mostrando "Nenhum pedido ainda" e a
 * tela de configurações mostrando os PADRÕES como se fossem os da loja — os
 * dois sem sinal nenhum. A cozinha lia isso como "está tudo certo, sem pedido".
 *
 * Aqui o erro aparece de fato, com um botão que refaz a carga. Um só banner
 * para as quatro cargas: o cozinheiro não precisa saber qual endpoint caiu,
 * precisa saber que a tela não é confiável e ter como tentar de novo.
 */
export const KitchenLoadError: React.FC = () => {
  const pedidos = useKitchenOrders();
  const catalogo = useKitchenCatalog();
  const motoboys = useKitchenDrivers();
  const config = useKitchenSettings();
  const relatorios = useKitchenReports();

  const falhas = [
    { nome: 'pedidos', error: pedidos.error, reload: pedidos.reload },
    { nome: 'cardápio', error: catalogo.error, reload: catalogo.reload },
    { nome: 'motoboys', error: motoboys.error, reload: motoboys.reload },
    { nome: 'configurações', error: config.error, reload: config.reload },
    { nome: 'relatórios', error: relatorios.error, reload: relatorios.reload },
  ].filter((f) => f.error);

  if (falhas.length === 0) return null;

  const recarregarTudo = () => {
    for (const f of falhas) f.reload();
  };

  const oQueFalhou = falhas.map((f) => f.nome).join(', ');

  return (
    <div
      role="alert"
      className="mb-4 flex flex-col gap-2 rounded-2xl border border-[#FCA5A5] bg-[#FEF2F2] p-4 text-[#7F1D1D] sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-sm font-bold">Não deu para carregar {oQueFalhou}.</p>
        <p className="mt-0.5 text-xs text-[#991B1B]">
          A tela pode estar desatualizada. Verifique a internet e tente de novo.
        </p>
      </div>
      <button
        type="button"
        onClick={recarregarTudo}
        className="shrink-0 rounded-xl bg-[#DC2626] px-4 py-2 text-sm font-bold text-white shadow-sm active:scale-95"
      >
        Tentar de novo
      </button>
    </div>
  );
};
