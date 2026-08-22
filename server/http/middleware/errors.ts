import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { DomainError } from '../../errors';

/**
 * Um formato de erro para a API inteira.
 *
 * O que existia antes eram ~10 `try/catch` copiados dentro das rotas, cada um
 * com a sua ideia de status e de mensagem. Copiar um bloco de tratamento é como
 * a mesma regra passa a ter duas versões: a rota nova esquece o `catch`, o erro
 * vaza como 500 com a pilha dentro, e ninguém percebe até um cliente ver
 * "Cannot read properties of undefined" no lugar de "endereço fora da área".
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) return next(err);

  if (err instanceof DomainError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  // Erro que não é do domínio é bug nosso: o cliente recebe uma frase, o log
  // recebe a causa. Mandar a mensagem original para fora vazaria caminho de
  // arquivo, SQL e nome de coluna.
  console.error('Erro não tratado numa rota:', err);
  res.status(500).json({ error: 'Algo falhou do nosso lado. Tente de novo em instantes.' });
}

/**
 * Embrulha um handler `async` para que uma promessa rejeitada chegue ao
 * `errorHandler`.
 *
 * O Express 4 não faz isso sozinho: um `throw` dentro de um `async` vira uma
 * rejeição não tratada e a requisição fica pendurada até o timeout do cliente.
 */
export const asyncRoute =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
