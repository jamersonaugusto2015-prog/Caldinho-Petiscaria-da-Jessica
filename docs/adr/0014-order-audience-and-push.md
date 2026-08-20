# ADR 0014: A audiência do pedido é um valor; o transporte é adaptador

- Status: accepted
- Date: 2026-08-20

## Context

`emitOrder` respondia duas perguntas na mesma linha: **quem** precisa saber deste
pedido — cozinha, dono da corrida, pool aberto, cliente — e **por onde** o aviso
viaja (salas do socket.io).

O push nasceu precisando só da primeira. As mesmas quatro pontas, as mesmas vistas
redigidas, outro cano. Com a fan-out grudada no `io`, a única forma de ter isso era
copiar a função inteira — e a cópia é exatamente onde a regra do pool começa a
discordar de si mesma. Já havia precedente no repositório: a redação virou dois
caminhos e um deles vazou (ADR-0010), e o `chat:message` está escrito duas vezes em
`routes.ts` com alvos diferentes até hoje.

O socket também só alcança quem está com o app aberto. A cozinha fecha a aba, o
motoboy bloqueia o celular, o cliente sai do navegador — e o pedido novo tocava para
ninguém.

## Decision

**`server/orderAudience.ts`** — a audiência vira um valor. `orderAudience(order)`
devolve uma lista de destinatários, cada um com a sala que o endereça e a vista que
ele tem direito de ver. Nada sobre transporte.

- A redação continua em `orderViews.ts`. O módulo **chama** `orderForDriver`, nunca
  reimplementa o que ela tira — é isso que mantém a ADR-0010 de pé. Um transporte novo
  herda a redação sem saber que ela existe.
- O desconto do pool (`except`) viaja no destinatário, não numa chamada do `io`.
- `emitOrder` virou o adaptador de socket: um laço de seis linhas sobre a audiência.

**`server/push.ts`** — o segundo adaptador, sobre o mesmo endereçamento.

- Uma inscrição é uma linha em `push_subscriptions`, arquivada sob a **mesma string de
  sala** que a audiência produz. Um esquema de endereço, dois transportes.
- O texto vem de `src/shared/orderAlerts.ts`, a mesma tabela que o navegador lê. A
  notificação que chega com o app fechado diz exatamente o que a faixa diria com o app
  aberto, porque são a mesma frase.
- O payload é montado a partir de `recipient.order` — a vista já redigida. Montar do
  pedido cru levaria nome, telefone e rua do cliente para o time inteiro de motoboys:
  o vazamento que a vista fechou no socket e no HTTP, reaberto por um cano novo. Tem
  teste.
- O disparo sai de **dentro** do `emitOrder`, não dos call sites. Enquanto fosse uma
  segunda chamada em cada rota, uma rota nova ia emitir o socket e esquecer o push.
- A sala vem sempre da credencial, nunca do corpo (ADR-0009). O corpo pode mandar
  `room` à vontade: é ignorado.
- Revogar os tokens de um motoboy apaga a inscrição dele junto, no
  `driverSession.revokeDriverTokens` — não numa rota que a próxima possa esquecer.
- 404 ou 410 do serviço de push significam que o navegador largou a inscrição: a linha
  morre. Qualquer outra falha é registrada e ignorada. O envio inteiro é
  fire-and-forget dentro de `try/catch`: um push quebrado nunca derruba a emissão do
  socket nem a resposta HTTP.

**Chaves VAPID** — do ambiente quando alguém as define; senão nascem uma vez e ficam
no `meta`. Persistir não é comodidade: a inscrição do navegador é assinada com a chave
pública que ele recebeu no dia em que aceitou. Um par novo a cada boot invalida em
silêncio todos os inscritos, sem nenhum erro aparecer.

## Consequences

- O cliente recebe "Saiu para Entrega" com o app fechado. A cozinha recebe o pedido
  novo com a aba fechada. O motoboy recebe a corrida com o celular no bolso.
- A audiência ficou testável sem socket.io: doze testes leem a lista direto.
- Uma linha por navegador, não uma por sala. O motoboy guarda só a sala privada
  `driver:<id>`; o pool é resolvido no envio como "todo motoboy menos o dono". Isso
  torna impossível notificar o mesmo aparelho duas vezes pelo mesmo evento.
- O `alertContext` do servidor não carrega `driverId`: a identidade vem da audiência,
  por destinatário, nunca de quem chama.
- Ficou dívida visível: `routes.ts` ainda emite `chat:message` em dois lugares com
  alvos diferentes. A audiência do chat não foi extraída aqui.
