# ADR 0011: Aceitar a corrida não é sair para entrega

- Status: accepted
- Date: 2026-08-20

## Context

`assign` gravava o motoboy **e** avançava `pronto → saiu_entrega` na mesma tacada. Duas
consequências, as duas verificadas com o app aberto:

- O cliente lia "Saiu para Entrega! O Motoboy já está a caminho" no instante do aceite, com o
  motoboy ainda no outro lado da cidade indo buscar o pedido. O rastreio mentia por todo o
  trajeto até a loja.
- A `DriverView` tinha um ramo para `isMine && status === 'pronto'` — o texto "Dirija até a
  loja para retirar o pedido" — que **nunca renderizava**, porque o status já tinha mudado.
  O motoboy via direto o botão de confirmar entrega e podia concluir a corrida sem ter passado
  na loja.

A UI descrevia um passo que o domínio não tinha.

## Decision

- `assign` grava `driverId`, `driverName`, `driverPhone` e semeia a posição. O status continua
  `pronto`.
- O domínio ganha a transição que faltava: o motoboy move `pronto → saiu_entrega` ao retirar o
  pedido na loja, e só na corrida dele. A cozinha continua podendo fazer o mesmo movimento.
- `entregue` continua exigindo `saiu_entrega`, então não há como concluir sem ter saído.
- O cliente e a cozinha leem `pronto` + `driverId` como "motoboy indo buscar", em vez de um
  estado novo. Não foi preciso alargar `OrderStatus`.

## Consequences

O rastreio passa a dizer a verdade nos dois trechos, e o ramo morto da `DriverView` vira o
botão que faltava. `saiu_entrega` volta a significar o que o nome diz, o que torna o tempo
estimado calculável a partir dele.

Um pedido `pronto` com motoboy atribuído é um estado que não existia antes. Quem lista corridas
disponíveis precisa filtrar por `!driverId` e não só por `status === 'pronto'` — o app do
entregador já fazia isso.
