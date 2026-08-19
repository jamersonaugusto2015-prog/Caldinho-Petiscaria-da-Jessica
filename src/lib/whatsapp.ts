/**
 * Monta link do WhatsApp com mensagem pronta.
 * Adiciona o DDI 55 se faltar e insere o 9º dígito do celular quando o número
 * foi salvo no formato antigo (DDD + 8 dígitos, comum em cadastros anteriores
 * à migração da Anatel). wa.me não encontra a conta sem o 9.
 */
export function whatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  const hasDDI = digits.length > 11 && digits.startsWith('55');
  const local = hasDDI ? digits.slice(2) : digits;
  // Celular sempre tem o 3º dígito (1º do número, após o DDD) entre 6 e 9.
  // Um número de 10 dígitos nesse padrão é quase certamente celular sem o 9.
  const withNinthDigit =
    local.length === 10 && /^[6-9]/.test(local.slice(2))
      ? local.slice(0, 2) + '9' + local.slice(2)
      : local;
  const p =
    withNinthDigit.length === 10 || withNinthDigit.length === 11 ? '55' + withNinthDigit : digits;
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}
