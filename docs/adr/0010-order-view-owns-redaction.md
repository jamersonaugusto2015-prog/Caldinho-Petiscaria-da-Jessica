# ADR 0010: A redação do contato pertence à vista do pedido, não ao transporte

- Status: accepted
- Date: 2026-08-20

## Context

O `CONTEXT.md` promete que "o nome, telefone e endereço do cliente vão só [para a sala do
motoboy], nunca para o pool compartilhado". A promessa valia para um caminho só.

`stripCustomerContact` morava em `orderEvents.ts` e era aplicada apenas no socket. Fora dali:

- `GET /orders` mandava o pedido inteiro para qualquer motoboy logado.
- Mesmo no socket, a corrida ainda sem dono ia **sem redigir** para o pool, com a justificativa
  de que o motoboy precisa do endereço para decidir se aceita.
- A redação preservava `customerId`, e `GET /orders?customerId=` respondia **sem exigir token
  nenhum**. Quem tivesse o id redigido puxava o pedido inteiro de volta.

Confirmado na tela do app: uma corrida que ninguém tinha aceitado exibia "Ana Souza
(81966665555) · Rua da Aurora, 100".

## Decision

- `server/orderViews.ts` é dono da vista. `orderForDriver(order, viewerDriverId)` é a **única**
  forma de um Order sair rumo a um motoboy; o transporte não decide mais.
- Só o dono da corrida (`order.driverId === viewerDriverId`) vê o contato. `viewerDriverId` vem
  sempre da credencial (ADR-0009), nunca do cliente.
- A redação leva junto `customerId`, `driverPhone`, o `label` do endereço e a `observation` dos
  itens — todos apontam para uma pessoa ou para a casa dela.
- O motoboy decide a corrida por bairro, distância e taxa, que a redação preserva de propósito.
  Endereço e contato aparecem ao aceitar.

## Consequences

Uma rota nova não tem como esquecer de redigir: não existe outro caminho para fora. Os testes
de `orderEvents` passam a valer também para o HTTP, porque os dois chamam a mesma vista.

O motoboy perde o endereço exato na hora de decidir. É a troca que o `CONTEXT.md` já descrevia,
e bairro somado a distância e taxa é o que ele precisa para dizer sim ou não.

`GET /orders?customerId=` continua sendo uma capability: o `customerId` é um UUID aleatório e o
cliente não tem login. O que fechou o buraco foi tirar esse id de tudo que chega ao motoboy.
Dar identidade ao cliente é assunto de outra ADR.
