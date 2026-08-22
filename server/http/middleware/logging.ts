import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Uma linha por requisição, com a LOJA e um id.
 *
 * Sem a loja no log, o relato "o pedido sumiu" numa plataforma com dezenas de
 * lojas não tem onde ser procurado: os erros de todas caem no mesmo fluxo,
 * indistinguíveis. Sem o id, uma requisição que passa por três camadas vira
 * três linhas soltas que ninguém consegue juntar.
 *
 * Só o que aconteceu é registrado: método, caminho, status e duração. Nada de
 * corpo, nada de header — é lá que moram o telefone do cliente e as
 * credenciais.
 */
declare module 'express-serve-static-core' {
  interface Request {
    /** Id desta requisição. Aparece no log e no header da resposta. */
    requestId?: string;
  }
}

/**
 * Caminhos que não geram linha de log: encheriam o fluxo sem dizer nada.
 *
 * O padrão casa o FIM do caminho porque este middleware roda no nível do `app`,
 * onde `req.path` ainda tem o prefixo `/api` — um `^/health$` aqui nunca casa.
 */
const SILENCIOSOS = [/\/health$/, /\/push\/key$/];

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Um proxy pode já ter posto um id: mantê-lo é o que liga o nosso log ao dele.
  // O `x-request-id` do cliente é aparado e limitado: um valor com CR/LF faz o
  // `setHeader` abaixo lançar (500), e um de 8 KB inchava toda linha de log.
  const idBruto = (req.get('x-request-id') || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
  const id = idBruto || randomUUID().slice(0, 8);
  req.requestId = id;
  res.setHeader('x-request-id', id);

  if (SILENCIOSOS.some((padrao) => padrao.test(req.path))) return next();

  const inicio = Date.now();
  res.on('finish', () => {
    // `req.shop` só existe depois do `resolveTenant`; num 404 de loja ele não
    // chega a existir, e é justamente o caso que precisa aparecer no log.
    const loja = req.shop ? req.shop.slug : '-';
    const duracao = Date.now() - inicio;
    const nivel = res.statusCode >= 500 ? 'erro' : res.statusCode >= 400 ? 'aviso' : 'ok';
    // O `code`/`state` do OAuth do Mercado Pago viajam na query, e a query
    // está em `originalUrl`: sem redigir, o log guardaria um código trocável
    // pelo access token da loja. Redige por nome, mantendo o resto da URL.
    const url = req.originalUrl.replace(
      /([?&](?:code|state|access_token|token)=)[^&]*/gi,
      '$1<redigido>'
    );
    const linha = `[${id}] ${loja} ${req.method} ${url} ${res.statusCode} ${duracao}ms`;
    if (nivel === 'erro') console.error(linha);
    else if (nivel === 'aviso') console.warn(linha);
    else console.log(linha);
  });

  next();
}
