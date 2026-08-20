# ADR 0013: O alerta do pedido é uma tabela, não três opiniões

- Status: accepted
- Date: 2026-08-20

## Context

A pergunta "chegou um evento do pedido — algum humano precisa saber disso, e quão
alto?" estava respondida três vezes, em três lojas de estado que também cuidavam de
outra coisa:

- `KitchenOrdersStore.tsx` — toast, som, voz e piscada no card, mais um `Set` próprio
  (`knownRequestsRef`) para não repetir o aviso de cancelamento.
- `DriverStore.tsx` — quatro `if` soltos dentro da própria chamada do `useLiveSession`,
  produzindo toasts mudos. Sem som, sem vibração.
- `CheckoutStore.tsx` — comparação com o status anterior, `statusMessageFor` e confete.
  Sem som, sem vibração.

Três cópias da mesma ideia, livres para discordar — e discordavam. A cozinha era
avisada com voz; o motoboy, a quem uma corrida perdida custa dinheiro, recebia uma
faixa colorida que some em quatro segundos; o cliente ganhava confete.

Nada disso era testável: as três viviam dentro de componentes React, e o projeto não
tem runner de teste de frontend. A regra de "o que merece interromper alguém" não
existia escrita em lugar nenhum — cada loja deduzia a sua na hora.

E já havia perda silenciosa. O `liveSession.ts` oferece `onReconnect` justamente porque
"eventos transmitidos enquanto o socket estava fora são perdidos". A cozinha usava; o
motoboy usava pela metade; o `CheckoutStore` não passava nada. Um cliente cujo celular
dormiu durante o `saiu_entrega` simplesmente nunca ficava sabendo.

Somar notificação do sistema e vibração nessa forma significaria a quarta, a quinta e a
sexta cópia de uma regra que já não concordava consigo mesma.

## Decision

Uma tabela só, em `src/shared/orderAlerts.ts`, no mesmo formato do `orderFlow.ts`:
pura, sem DOM, sem React, rodando no `tsx --test`.

- `orderAlertFor(papel, evento, pedido, contexto)` devolve o alerta ou `null`. `null` é
  resposta legítima e a mais comum: a maior parte do tráfego do socket é sincronização
  de estado, não notícia.
- A intensidade é uma escala de três degraus que só sobe — `silent`, `notice`,
  `demand` — e cada degrau tem um conjunto fixo de canais. Só dois eventos nascem
  `demand`: o pedido novo na cozinha e a corrida oferecida ao motoboy. São os dois em
  que há dinheiro parado esperando alguém olhar.
- Todo alerta carrega uma `key` de deduplicação. O canal recusa entregar a mesma chave
  duas vezes, então replay de reconexão, `order:updated` repetido e duas abas abertas
  deixam de dobrar o barulho. Foi isso que substituiu o `knownRequestsRef`.
- A entrega é de outro módulo. A tabela decide o conteúdo e a intensidade; o
  `alertChannel` no navegador e o push no servidor leem daqui — então a notificação que
  chega com o app fechado diz exatamente o que a faixa diria com o app aberto.

## Consequences

- A cozinha continua com som e voz; o motoboy passa a vibrar e tocar numa corrida
  oferecida; o cliente passa a receber notificação do sistema quando o pedido sai para
  entrega. Nenhuma dessas três mudanças é código novo em três lugares: são linhas da
  tabela.
- "O motoboy vibra quando aparece corrida" virou uma asserção, não uma leitura de
  componente.
- O servidor importa a mesma tabela. Isso amarra o texto do push ao texto da faixa de
  propósito: se um mudar, o outro muda junto, porque são o mesmo.
- A tabela não sabe o que já aconteceu: `previousStatus`, `hadPendingCancelRequest` e
  `hadOpenComplaint` entram como contexto de quem chama. Quem chama tem que lembrar —
  no navegador é um `ref` por pedido; no servidor, o que o ciclo de vida souber dizer.
