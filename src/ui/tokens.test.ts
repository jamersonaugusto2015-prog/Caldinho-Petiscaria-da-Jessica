import assert from 'node:assert/strict';
import test from 'node:test';
import { MARCA_ESCURA_PADRAO, MARCA_PADRAO, corValida, escurecer, tokensDaLoja } from './tokens';

test('sem cor escolhida, a loja fica com a cor de sempre', () => {
  assert.deepEqual(tokensDaLoja(undefined), {
    marca: MARCA_PADRAO,
    marcaEscura: MARCA_ESCURA_PADRAO,
  });
  assert.deepEqual(tokensDaLoja(''), { marca: MARCA_PADRAO, marcaEscura: MARCA_ESCURA_PADRAO });
});

test('cor inválida não vira CSS quebrado: cai no padrão', () => {
  // Uma string qualquer vinda do painel viraria `color: azul-marinho` e a tela
  // perderia a cor inteira, sem erro nenhum.
  assert.equal(tokensDaLoja('azul').marca, MARCA_PADRAO);
  assert.equal(tokensDaLoja('#GGG').marca, MARCA_PADRAO);
  assert.equal(tokensDaLoja('#B91C1').marca, MARCA_PADRAO, 'faltou um dígito');
  assert.equal(corValida('#B91C1C'), true);
  assert.equal(corValida('B91C1C'), false, 'sem o # não é cor CSS');
});

test('a loja escolhe UMA cor e ganha o tom de hover junto', () => {
  const { marca, marcaEscura } = tokensDaLoja('#2563EB');
  assert.equal(marca, '#2563EB');
  assert.notEqual(marcaEscura, marca);
  assert.match(marcaEscura, /^#[0-9a-f]{6}$/i);
});

test('escurecer não estoura o intervalo do canal', () => {
  assert.equal(escurecer('#000000'), '#000000');
  assert.match(escurecer('#FFFFFF'), /^#[0-9a-f]{6}$/i);
  assert.equal(escurecer('nao-e-cor'), 'nao-e-cor', 'entrada inválida sai intacta');
});

test('a cor de sempre mantém exatamente o hover de sempre', () => {
  // Sem isto, ligar os tokens mudaria o tom de hover da loja que já existe —
  // uma mudança visual que ninguém pediu.
  assert.equal(tokensDaLoja(MARCA_PADRAO).marcaEscura, MARCA_ESCURA_PADRAO);
});
