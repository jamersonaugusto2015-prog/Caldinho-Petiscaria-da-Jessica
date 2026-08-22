-- 022_platform_admins — a identidade de PLATAFORMA.
--
-- Quem cria e desativa lojas não é uma loja. A credencial é 100% separada: um
-- token de cozinha, por mais privilegiado que seja dentro da própria loja, não
-- pode criar loja nenhuma nem tocar em outra.
--
-- Por isso duas tabelas novas em vez de um papel a mais em `shop_secrets`: um
-- papel dentro do espaço da loja seria alcançável a partir da loja.

CREATE TABLE IF NOT EXISTS platform_admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  -- Hash scrypt, o mesmo formato de `server/auth.ts`. Nunca a senha.
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- `COLLATE NOCASE`: e-mail não distingue maiúscula na prática, e dois cadastros
-- que só diferem no caso deixariam o login ambíguo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_admins_email
  ON platform_admins (email COLLATE NOCASE);

-- Sessões. Tabela própria, e não um JWT, para que revogar seja apagar uma linha:
-- um token de plataforma perdido abre TODAS as lojas.
CREATE TABLE IF NOT EXISTS platform_tokens (
  token TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  -- Sessão com prazo, ao contrário das da loja: o risco aqui é a plataforma
  -- inteira, não uma loja.
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_platform_tokens_admin ON platform_tokens (admin_id);
