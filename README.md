# 🍲 Caldinho Express

Aplicativo delivery de caldinhos, petiscos e bebidas com **3 interfaces separadas** e **backend real**:

| Interface | Rota | Descrição |
|---|---|---|
| 👤 Cliente | `/` | Cardápio, carrinho, checkout com PIX real, rastreio no mapa em tempo real, fidelidade e chat |
| 🏪 Cozinha | `/cozinha` | Kanban de pedidos, cardápio, motoboys, cupons, relatórios reais e configurações |
| 🛵 Entregador | `/entregador` | Corridas com GPS real do celular, atribuição por motoboy, ganhos reais |

## Arquitetura

```
caldinho-express/
├── server/                 # Backend: Express + Socket.IO + SQLite (better-sqlite3)
│   ├── index.ts            # API + WebSocket + GPS real do entregador
│   ├── routes.ts           # REST: auth, produtos, pedidos, chat, fidelidade, relatórios, cupons
│   ├── db.ts               # Schema SQLite + migrações + seeds
│   ├── auth.ts             # Hash de senhas (scrypt) e tokens por papel
│   └── pix.ts              # Geração de BR Code PIX válido (EMV + CRC16)
├── src/
│   ├── features/           # Uma pasta por papel (store + telas + header próprios)
│   │   ├── client/         # 👤 Cliente (rota /)
│   │   ├── kitchen/        # 🏪 Cozinha (rota /cozinha)
│   │   └── driver/         # 🛵 Entregador (rota /entregador)
│   ├── components/common/  # LiveMap (Leaflet + OpenStreetMap) e outros
│   ├── lib/                # api.ts (fetch com timeout), socket.ts (Socket.IO), auth.ts
│   ├── shared/             # geo.ts (haversine/frete), pricing.ts, defaults.ts, constants.ts
│   └── types.ts            # Tipos compartilhados entre frontend e backend
└── data/caldinho.db        # Banco SQLite (criado automaticamente, ignorado no git)
```

## Como funciona hoje (produção)

- **Mapa real**: Leaflet + OpenStreetMap (sem chave de API). Geocodificação via Nominatim e CEP via ViaCEP.
- **Frete por distância**: o admin define **preço por km**, taxa base, taxa mínima, frete grátis acima de X,
  raio máximo e pedido mínimo. O servidor calcula a distância (haversine × fator de rota) e o frete é
  **sempre calculado no servidor** (o cliente exibe o mesmo valor antes de confirmar).
- **Local da loja**: configurável no painel com pino arrastável no mapa.
- **PIX real**: o admin cadastra a chave PIX e o sistema gera o BR Code "copia e cola" com CRC válido;
  o cliente vê o QR Code e a cozinha confirma o pagamento no kanban. Cartão e dinheiro pagos na entrega.
- **Cliente por dispositivo**: cada navegador tem um ID anônimo; pedidos e selos de fidelidade são por
  cliente (não globais).
- **GPS do entregador**: o app do motoboy usa `navigator.geolocation` e envia a posição via socket;
  o cliente acompanha o motoboy no mapa em tempo real.
- **Horário de funcionamento**: configurável por dia da semana (com suporte a turnos que viram à
  meia-noite); fora do horário o pedido é recusado.
- **Segurança**: senhas com hash scrypt, PIN da cozinha configurável, tokens de acesso gerados
  aleatoriamente na primeira execução e persistidos no banco.
- **Relatórios**: agregação real no servidor (receita, pedidos, ticket médio, produtos mais vendidos e
  distribuição por hora) com filtro por período.
- **Tempo real**: Socket.IO — o que a cozinha muda aparece na hora para cliente e entregador.

## Rodar localmente

```bash
npm install
npm run dev
```

- Frontend: http://localhost:3000 (proxy `/api` e `/socket.io` → servidor)
- API: http://localhost:3001
- Acesso padrão (altere no painel!): cozinha PIN `1234`; motoboy demo `Marcos Motoboy` / `1234`

## Scripts

| Script | Descrição |
|---|---|
| `npm run dev` | API (:3001) + Frontend (:3000) juntos (concurrently) |
| `npm run lint` | Typecheck completo (frontend + backend) |
| `npm run build` | Build do frontend para produção |
| `npm start` | Sobe apenas a API (serve o build em `dist/` se existir) |

## Fluxo ponta-a-ponta

1. Cliente cadastra o endereço (CEP → mapa → pino) e vê o **frete calculado pela distância**
2. Confirma o pedido (PIX com QR real / cartão na entrega / dinheiro)
3. O pedido cai no kanban da Cozinha com status de pagamento
4. A cozinha prepara e marca como pronto; o motoboy **aceita a corrida** (fica atribuída a ele)
5. O GPS real do motoboy aparece no mapa do cliente até a entrega
6. Cliente avalia, ganha selos e pode resgatar um caldinho grátis

## Antes de ir para produção

- Cadastre a chave PIX e o local da loja no painel (Configurações)
- Troque o PIN padrão da cozinha e a senha do motoboy demo
- Configure o `CORS_ORIGIN` (env) para o domínio do app em produção
- Defina o fuso horário do servidor para o horário de funcionamento funcionar corretamente (ex: `TZ=America/Recife`)

## Deploy gratuito no Render (recomendado)

O Render roda o app completo (API + frontend + Socket.IO) com **disco persistente** para o
SQLite e as imagens — funciona de graça, com domínio próprio `https://seu-app.onrender.com`.

1. Crie uma conta em https://render.com (plano **Free**)
2. Suba este projeto para um repositório no GitHub
3. Em Render: **New → Blueprint** e selecione o repositório — o arquivo `render.yaml` já configura tudo
   (ou: New → **Web Service**, com os valores abaixo)
4. Na aba **Environment**, defina:
   - `CORS_ORIGIN` = `https://seu-app.onrender.com` (o domínio que o Render criar)
   - `TZ` = `America/Recife` (já vem no blueprint)
5. Em **Disks** (Web Service manual): crie um disco de 1 GB montado em `/data`
6. Deploy automático a cada `git push` — o banco e as fotos ficam no disco persistente

> No plano Free o app **hiberna** após ~15 min sem acesso e acorda sozinho quando alguém entra.

### Variáveis de ambiente (produção)

| Variável | Exemplo | Obrigatória |
|---|---|---|
| `PORT` | `10000` | Render define sozinho |
| `CORS_ORIGIN` | `https://seu-app.onrender.com` | Sim |
| `TZ` | `America/Recife` | Sim (horários/relatórios) |
| `DATA_DIR` | `/data` | Sim (disco persistente) |

### Alternativas

- **VPS (DigitalOcean/Hetzner/Oracle Cloud)**: use o `Dockerfile` incluído — `docker build -t caldinho . && docker run -p 3001:3001 -v caldinho-data:/data -e TZ=America/Recife caldinho`
- **Railway / Fly.io**: mesmo modelo do Render (disco persistente + WebSocket), configurável via `Dockerfile`

> ⚠️ **Vercel e Firebase Hosting não funcionam** com este app: o SQLite precisa de disco persistente
> e o tempo real usa Socket.IO (conexões longas), o que esses serviços não suportam sem reescrita.

