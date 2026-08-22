import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTRACT_DIR = path.dirname(fileURLToPath(import.meta.url));

function everyFile(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return everyFile(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

function importsOf(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  // Todas as formas de trazer código para dentro — não só `from '...'` com
  // aspas simples: aspas duplas, import de efeito, import() dinâmico e
  // require() também furavam a regra sem este teste perceber.
  const formas = [
    /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return formas.flatMap((re) => [...source.matchAll(re)].map((m) => m[1]));
}

/**
 * Os únicos pacotes externos que o contrato pode importar.
 *
 * `zod` entra porque validar é PARTE do contrato: as regras que dizem o que é
 * uma configuração de loja válida precisam valer nos dois lados, e o zod roda
 * igual no navegador e no Node. Nada de framework: um `express` aqui derruba o
 * build do navegador, um `react` aqui derruba o servidor.
 *
 * Acrescentar nome nesta lista é decisão de arquitetura, não conveniência.
 */
const PACOTES_PERMITIDOS = new Set(['zod']);

/**
 * A regra número um da arquitetura: `contract/` é a ÚNICA coisa que o front e o
 * back dividem, e para isso ele não pode depender de nenhum dos dois.
 *
 * O estrago não aparece na hora — aparece semanas depois, num deploy. Este
 * teste é a única coisa que segura.
 */
test('contract/ não importa nada de fora de contract/', () => {
  const offenders: string[] = [];

  for (const file of everyFile(CONTRACT_DIR)) {
    const isTest = file.endsWith('.test.ts');
    for (const spec of importsOf(file)) {
      // `node:test`/`node:assert` só nos próprios testes: o código de produção
      // do contrato roda no navegador, onde `node:` não existe.
      if (spec.startsWith('node:')) {
        if (!isTest) offenders.push(`${path.relative(CONTRACT_DIR, file)} → ${spec}`);
        continue;
      }
      if (!spec.startsWith('.')) {
        const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!PACOTES_PERMITIDOS.has(pkg)) {
          offenders.push(`${path.relative(CONTRACT_DIR, file)} → ${spec} (pacote externo)`);
        }
        continue;
      }
      const resolved = path.resolve(path.dirname(file), spec);
      if (!resolved.startsWith(CONTRACT_DIR + path.sep)) {
        offenders.push(`${path.relative(CONTRACT_DIR, file)} → ${spec} (sai do contrato)`);
      }
    }
  }

  assert.deepEqual(offenders, [], `contrato impuro:\n  ${offenders.join('\n  ')}`);
});

test('todo import relativo dentro do contrato aponta para um arquivo que existe', () => {
  const missing: string[] = [];
  for (const file of everyFile(CONTRACT_DIR)) {
    for (const spec of importsOf(file)) {
      if (!spec.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(`${resolved}.ts`) && !fs.existsSync(path.join(resolved, 'index.ts'))) {
        missing.push(`${path.relative(CONTRACT_DIR, file)} → ${spec}`);
      }
    }
  }
  assert.deepEqual(missing, [], `import quebrado:\n  ${missing.join('\n  ')}`);
});
