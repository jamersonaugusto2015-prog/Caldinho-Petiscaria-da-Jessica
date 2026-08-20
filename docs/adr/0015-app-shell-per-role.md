# ADR 0015: Um build, três apps instaláveis

- Status: accepted
- Date: 2026-08-20

## Context

O app não tinha casco. Nenhum manifesto, nenhum service worker, nenhuma rota para
instalar. Os três apps saíam do mesmo `index.html`, com um título só, um ícone emoji
só e uma cor de barra só.

Isso não era só cosmético. Todo alerta que o app produz morria no instante em que a
aba fechava — e num celular a aba passa a maior parte do tempo fechada. Sem service
worker não existe lugar onde uma notificação possa chegar com o app fechado, então a
tabela de alertas (ADR-0013) e o push (ADR-0014) não teriam para onde entregar.

E o que o celular baixava era um pedaço só de **1.108.687 bytes**: quem abria `/` para
pedir um caldinho baixava o painel da cozinha, o Leaflet, o GSAP, o `motion`, o confete
e a impressora térmica de cupom. O Express servia tudo com `maxAge: 0`, então um
celular com cache frio rebaixava o pacote inteiro a cada visita. No plano de dados da
loja, isso era a experiência de instalação.

Havia ainda o que o `viewport-fit=cover` prometia e ninguém cumpria:
`safe-area-inset-top` não aparecia em lugar nenhum do repositório, e os cascos de tela
cheia usavam `min-h-screen` (`100vh`), que transborda a altura da barra de endereço no
Safari do iPhone.

## Decision

**Três manifestos, um bundle.** `public/manifest-cliente.webmanifest`,
`manifest-cozinha.webmanifest`, `manifest-entregador.webmanifest` — cada um com nome,
ícone, cor e `start_url` próprios (`/`, `/cozinha`, `/entregador`). Um `index.html` não
pode linkar três, então o `<link rel="manifest">` é injetado em runtime pelo
`appShell.ts`, escolhido pelo `location.pathname`, antes do primeiro render. A cozinha
instala "Caldinho Cozinha" e o motoboy instala "Caldinho Entregador": dois ícones
diferentes na mesma tela inicial, como devem ser dois apps diferentes.

**Ícones são arquivos de verdade.** Sem dependência de imagem no projeto,
`scripts/generate-icons.mjs` os escreve com `node:zlib` e um escritor de chunk PNG
próprio: 12 PNGs, três paletas, incluindo os `maskable` com a zona segura. O script é a
fonte da verdade e pode ser rodado de novo.

**`public/sw.js`** — JS puro, sem passo de build, servido da raiz para cobrir os três
apps. Precache do casco, `cache-first` nos `/assets` com hash, `stale-while-revalidate`
nas fotos, e **nunca** cache em `/api` nem em `/socket.io`: ali é dinheiro e estado
vivo, e um pedido servido do cache é pior que um erro. Navegação é network-first com
o casco como reserva, então um celular sem sinal ainda abre o app. Ele também renderiza
o `push`, trata o `notificationclick` e reinscreve no `pushsubscriptionchange`.

**Code splitting.** `React.lazy` nos três apps de papel e no `NotFoundScreen` — esse
último puxava os 205 kB do GSAP para o primeiro paint dos três papéis. Vendors pesados
em chunks próprios pela forma de função do `manualChunks` (a forma de objeto gerava um
chunk `react` vazio, porque o app importa `react-dom/client` e `react/jsx-runtime`, que
são ids de módulo diferentes).

**Cache headers** no Express: `/assets` `immutable` por um ano, `index.html` e o
fallback do SPA `no-cache` — senão um deploy nunca chega em ninguém.

## Consequences

- O que bloqueia o primeiro paint caiu de **1.217.063 para 335.250 bytes** (356 kB →
  95 kB em gzip). Corte de 73%.
- Existe finalmente um lugar onde um alerta chega com o app fechado. Sem isso, as
  ADR-0013 e 0014 seriam duas metades de uma ponte.
- `maximum-scale=1.0, user-scalable=no` saiu do viewport. Bloquear o pinch-zoom é falha
  de acessibilidade (WCAG 1.4.4), e quem mais precisa dele é justamente o cliente
  digitando o endereço de entrega.
- As fotos dos produtos moram em `/api/uploads/`, não em `/uploads/`. A regra "nunca
  cachear `/api`" escrita ao pé da letra teria feito cada foto baixar de novo a cada
  abertura; o service worker casa `/api/uploads/` **antes** da regra geral.
- No iOS, o push só existe dentro de um app instalado na tela inicial (16.4+). O
  convite para instalar não é enfeite: é a única porta.
- Ficou dívida medida: `map` (154 kB) e `realtime` (42 kB) ainda entram no grafo
  estático de todo papel, porque o `LiveMap` é importado direto por quatro telas.
