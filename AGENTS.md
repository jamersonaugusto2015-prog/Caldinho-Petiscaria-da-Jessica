# Regras do projeto (importante)

## Fluxo de trabalho com o assistente (opencode)

- **Fazer alterações SEMPRE em modo local** (editar arquivos, rodar `npm run lint` e `npm run build` para validar).
- **NUNCA fazer `git commit` ou `git push` por conta própria.**
- Só publicar no GitHub (e no Render, que faz deploy automático) quando o dono do projeto pedir
  explicitamente (ex: "publicar", "subir", "deploy", "faz o push").
- Sempre confirmar com o dono antes de qualquer operação no Git remoto.

## Comandos de validação

- Lint/typecheck: `npm run lint`
- Build: `npm run build`
- Rodar local: `npm run dev` (frontend :3000, API :3001)
