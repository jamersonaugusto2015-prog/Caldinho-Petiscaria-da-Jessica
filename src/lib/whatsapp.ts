/** Monta link do WhatsApp com mensagem pronta. Adiciona DDI 55 se faltar. */
export function whatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  const p = digits.length === 10 || digits.length === 11 ? '55' + digits : digits;
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}
