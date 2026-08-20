# ADR 0009: A credencial do entregador identifica o motoboy

- Status: accepted
- Date: 2026-08-20

## Context

A ADR-0004 tirou o palpite da escolha do token: cada app manda o token do seu papel.
Faltou o passo seguinte. `getRoleToken('driver')` devolvia **o mesmo token para todos os
motoboys**, gerado uma vez em `db.ts` e nunca rotacionado, então `requireRole('driver')`
provava "é *um* motoboy", nunca "é *este* motoboy". A identidade viajava à parte, como
`driverId` no corpo, na query ou no payload do socket — entrada não provada.

Verificado com o servidor no ar, dois motoboys cadastrados de verdade:

- João desligou a presença da Maria e leu o telefone dela (`/drivers/:id/presence` só exigia
  o papel, nunca o dono).
- João atribuiu uma corrida à Maria mandando o `driverId` dela no corpo do `/assign`.
- Um socket entrava na sala privada `driver:<id>` de qualquer motoboy, que é onde a ADR-0005
  promete que o contato do cliente só vai para o dono.
- Um socket **sem login nenhum** moveu o motoboy no mapa do cliente e gravou no banco.
- Desativar a Maria não cortou nada: o token continuou lendo `GET /orders`.

## Decision

- `server/driverSession.ts` é dono da sessão do entregador. `issueDriverToken` emite uma
  credencial por motoboy no login; `driverFromToken` resolve o dono e recusa motoboy inativo;
  `requireDriver` põe o motoboy em `res.locals.driver` e `currentDriver(res)` o lê.
- Os tokens moram em `driver_tokens`, **fora** do JSON de `drivers`. A linha do motoboy é
  serializada para a cozinha e para o app; um token guardado lá vazaria na primeira rota que
  esquecesse de removê-lo — foi exatamente o que aconteceu com o hash da senha em `GET /drivers`.
- `driverId` deixa de ser entrada. Nenhuma rota e nenhum evento de socket aceita a identidade
  do chamador vinda do cliente; ela vem sempre da credencial.
- Desativar, apagar ou trocar a senha de um motoboy chama `revokeDriverTokens`.
- `publicDriver` é a única forma de um `Driver` sair do servidor.

## Consequences

Autorização passa a ter um ponto de decisão em vez de quatro, e ele é testável sem HTTP.
Agir em nome de outro motoboy deixa de ser possível pela borda: não há mais campo onde
declarar quem se é. Demitir revoga o acesso na hora.

O custo é uma quebra de sessão no deploy: os tokens compartilhados que estão nos aparelhos
não resolvem mais, e cada motoboy cai no portão de login uma vez — pelo caminho de expiração
que a ADR-0004 já definiu.
