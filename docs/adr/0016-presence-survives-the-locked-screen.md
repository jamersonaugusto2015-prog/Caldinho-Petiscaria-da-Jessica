# ADR 0016: A tela bloqueada não é o motoboy indo embora

- Status: accepted
- Date: 2026-08-20

## Context

A ADR-0005 tornou o rastreamento estado derivado. Ela não fala de segundo plano, e era
ali que estava o furo — verificado no código:

O ciclo de vida da página pertencia ao **transporte**. `src/lib/socket.ts` era a coisa
inteira: em `visibilitychange` e em `online`, reconectar o socket. Mais nada no
repositório reagia à página ir para trás — nenhum `pagehide`, nenhum ouvinte de
`offline`, nenhum wake lock.

Então: o motoboy guarda o celular no bolso, o websocket cai, o `disconnect` do
`server/index.ts` marca `online = false` e avisa a cozinha. **Na reconexão as salas
voltam, mas `driver.online` não.** O app do motoboy continuava mostrando ONLINE, a
cozinha mostrava OFFLINE, e nada reconciliava os dois — o `DriverStore` lia presença
uma vez só, na troca de `[driverId]`.

O GPS mentia junto, de três jeitos:

- `socket.volatile.emit` descartava os pontos produzidos com o socket fora, sem
  reposição.
- Um `TIMEOUT` de 20 s era classificado igual a `POSITION_UNAVAILABLE` e **travava** em
  `unavailable`; o watch nunca era reiniciado e só um toque manual limpava.
- E a falha silenciosa, que é a pior: um watch que simplesmente parou de entregar
  posições — tela apagada, aba suspensa — continuava reportando `active`. Nenhuma
  tarja aparecia, e a coordenada guardada ficava no mapa do cliente indistinguível de
  uma viva, porque não havia carimbo de tempo nenhum.

## Decision

**O ciclo de vida ganha dono.** `src/lib/pageLifecycle.ts` responde onde a página está:
`foreground`, `background` ou `offline`. Tela bloqueada é `background`, não `offline`.
O `socket.ts` volta a ser transporte — ele escuta e reconecta, e para de decidir se
alguém está trabalhando.

**Janela de tolerância de 75 s** (`server/driverPresence.ts`). Um `disconnect` não vira
mais `online = false` na hora: agenda. O mesmo motoboy voltando cancela. O número tem
que cobrir tela bloqueada, túnel e troca 4G↔Wi-Fi, e ainda assim derrubar quem foi
embora antes do próximo pedido ficar pronto. A correção multi-aba continua: só a última
aba a fechar conta.

**A intenção é declarada pelo app, não implícita na reconexão.** O socket também volta
para o motoboy que tocou OFFLINE com o app aberto — a reconexão sozinha o devolveria ao
quadro da cozinha. Então o `join` carrega `online`, e a identidade continua vindo só do
token (ADR-0009). O app só declara depois da primeira leitura do servidor, então abrir
o app não põe ninguém online sozinho.

**Todo ponto carrega quando foi tirado** — `locationAt` no motoboy, `driverLocationAt`
no pedido. `locationFreshness` responde `live`, `stale` ou `unknown`, e um ponto sem
carimbo nunca é `live`. Uma posição semeada não recebe carimbo de propósito: semear é um
palpite, e um palpite carimbado como "agora" faria o mapa jurar que o motoboy está na
porta da loja neste instante.

**O watch para de travar.** `TIMEOUT` degrada para `stale` e reinicia com backoff
(5/15/30/60 s). `PERMISSION_DENIED` continua terminal — é a única falha que o usuário
precisa resolver. Um heartbeat detecta o watch calado (45 s sem fix) e o app reporta
`stale` em vez de `active`. O último ponto antes de uma queda é reenviado uma vez, não
volátil, para o mapa do cliente não retomar de uma coordenada de minutos atrás.

**Wake lock** enquanto há entrega ativa, com detecção de recurso, reaquisição no
foreground e toda falha engolida.

## Consequences

- A cozinha para de perder motoboy em farol com sinal ruim, e para de ver motoboy que
  fechou o app.
- O cliente passa a saber que está olhando a última posição conhecida, em vez de achar
  que o motoboy parou no meio da rua.
- A janela de tolerância virou um número testado, não um efeito colateral do socket.
- `server/driverPresence.ts` existe separado porque `server/index.ts` abre a porta e o
  banco ao ser importado: a política precisava sair de lá para ser testável.
- O documento do motoboy é JSON, então `locationAt` atravessou sem migração de schema.
