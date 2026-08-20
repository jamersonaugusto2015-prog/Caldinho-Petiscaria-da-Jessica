# ADR 0012: A passagem de balcão é um portão, e tem uma tabela só

- Status: accepted
- Date: 2026-08-20

## Context

A ADR-0011 separou aceitar a corrida de sair para entrega. Isso deixou visível um
estado que antes não existia: pedido `pronto` **com** motoboy atribuído. E abriu um
furo, verificado com o servidor no ar:

```
apos aceite  -> status: pronto | motoboy: Ze
cozinha pula pronto->entregue -> HTTP 200 | status: entregue | motoboy: Ze
o motoboy conta essa como entrega dele? true
```

A cozinha arrastava o card de "Pronto" direto para "Entregue" e o pedido fechava sem
nunca ter saído da loja — pagando a taxa a um motoboy que não rodou e creditando o selo
de fidelidade ao cliente.

A causa não era o pulo em si, e sim onde a regra morava. "Quem move o pedido, de onde
para onde" estava escrito em **cinco** lugares: a comparação de índice em `orderLifecycle`,
a guarda de retirada, o ramo do motoboy, e o `NEXT_STATUS` mais o `canDropIn` do quadro da
cozinha. Cinco cópias livres para discordar — e discordavam: o botão do quadro oferecia
"Saiu para entrega" enquanto o arrastar deixava pular para "Entregue".

Por cima disso, "retirar" queria dizer duas coisas no mesmo produto: o motoboy retirando
o pedido no balcão e o cliente retirando o pedido no balcão.

## Pesquisa

O iFood, no mesmo problema, separa os dois momentos e não deixa concluir sem passar por
eles:

- `READY_TO_PICKUP` ("pronto para ser retirado pelo cliente ou pelo entregador") e
  `DISPATCHED` ("saiu para entrega") são estados **distintos**, não o mesmo.
  ([workflow](https://developer.ifood.com.br/pt-BR/docs/food/guides/modules/order/workflow/))
- Em **entrega própria** (`deliveredBy: MERCHANT`) — o caso desta loja, que tem motoboys
  próprios — é a **loja** que marca o despacho, com o botão "Pedido despachado".
  ([endpoints](https://developer.ifood.com.br/pt-BR/docs/food/guides/modules/order/endpoints),
  [blog do parceiro](https://blog-parceiros.ifood.com.br/notificacao-despacho/))
- Em entrega com frota da plataforma, quem confirma a coleta é o **entregador**, pelo
  evento `COLLECTED`. A loja não tem endpoint para isso.
  ([eventos](https://developer.ifood.com.br/pt-BR/docs/food/guides/modules/events/order-events/))
- **Concluir sem despachar não existe**: não há endpoint de conclusão, a plataforma conclui
  sozinha. ([workflow](https://developer.ifood.com.br/pt-BR/docs/food/guides/modules/order/workflow/))
- Em **retirada pelo cliente** (takeout) não existe status "cliente retirou" nem código de
  retirada para o cliente: vai de `READY_TO_PICKUP` para concluído. O `pickupCode` do iFood
  é do **entregador**, para a loja conferir antes de liberar a sacola.
  ([takeout](https://developer.ifood.com.br/pt-BR/docs/food/guides/modules/order/takeout),
  [segurança na coleta](https://blog-parceiros.ifood.com.br/seguranca-coleta-pedido/))
- O vocabulário do mercado separa os verbos: **despachar** (sai com o motoboy) x
  **retirar** (o cliente leva).

## Decision

- `src/shared/orderFlow.ts` é a tabela única. Servidor e quadro da cozinha leem daqui.
  O servidor continua sendo quem decide; o quadro usa as mesmas funções só para não
  oferecer o que será recusado.
- A **passagem de balcão** é nomeada: um gesto com dois destinos.
  `handoverRecipient` devolve `driver` (entrega) ou `customer` (retirada).
- Esse passo é um **portão, não um degrau**: não dá para alcançar um status depois dele
  sem tê-lo cruzado. Pular o preparo (`recebido → pronto`) continua valendo — o que a
  cozinha adianta ali não paga ninguém.
- A cozinha **continua** podendo despachar, com ou sem motoboy atribuído. Uma loja cujo
  motoboy não usa o app não pode ficar travada.
- **Sem código de retirada para o cliente.** A pesquisa mostra que o problema que o código
  resolve é outro: entregador desconhecido de uma frota de marketplace. Aqui o motoboy é
  funcionário da loja, com credencial própria (ADR-0009), e a cozinha o conhece de vista.
- Os verbos ficam separados: a cozinha vê "Pedido despachado" x "Cliente retirou"; o app
  do motoboy fala em pegar o pedido; "retirada" fica reservada ao cliente.

## Consequences

O furo do pagamento fecha por construção, não por uma checagem a mais: não existe caminho
de `pronto` para `entregue` numa entrega. Mudar a regra passa a ser mudar um arquivo, e o
quadro da cozinha não tem mais como oferecer o que o servidor recusa.

O quadro perde a possibilidade de fechar um pedido de entrega em um arrasto só. É o
comportamento que estava pagando corrida não feita; a loja passa a arrastar duas vezes,
ou o motoboy fecha do lado dele.

A retirada pelo cliente segue sem prova de quem levou, como no iFood. Se um dia a loja
quiser essa prova, o lugar é um código no pedido — não um status novo.
