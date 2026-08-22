import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { countPlatformAdmins, createPlatformAdmin } from '../server/domain/platform/admins';

/**
 * Cria o primeiro administrador da plataforma.
 *
 * Existe como script, e não como rota, porque não há como autenticar quem cria
 * o primeiro admin: uma rota aberta "crie o primeiro admin" é uma rota que
 * qualquer um alcança enquanto ninguém a usou — e uma que precisa lembrar de se
 * fechar depois. O terminal do servidor já é a prova de acesso.
 *
 *   npm run platform:admin -- admin@exemplo.com
 *
 * A senha é pedida no prompt, nunca por argumento: argumento fica no histórico
 * do shell e na lista de processos da máquina.
 */
async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error('Uso: npm run platform:admin -- <email>');
    process.exit(1);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const existentes = countPlatformAdmins();
    if (existentes > 0) {
      console.log(`ℹ  Já existem ${existentes} administrador(es) na plataforma.`);
      const seguir = await rl.question('Criar mais um? (s/N) ');
      if (seguir.trim().toLowerCase() !== 's') {
        console.log('Nada foi criado.');
        return;
      }
    }

    const senha = await rl.question('Senha (mínimo 10 caracteres): ');
    const confirmacao = await rl.question('Repita a senha: ');
    if (senha !== confirmacao) {
      console.error('❌ As senhas não são iguais. Nada foi criado.');
      process.exit(1);
    }
    const nome = await rl.question('Nome (opcional): ');

    const admin = await createPlatformAdmin({ email, password: senha, name: nome });
    console.log(`✅ Administrador criado: ${admin.email} (id ${admin.id})`);
    console.log('   Entre pelo domínio raiz, em /admin.');
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
