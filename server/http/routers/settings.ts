import { Router } from 'express';
import type { Request } from 'express';
import type { Server } from 'socket.io';
import { normalizePixKey, normalizePixProvider, usesLocalPix, validatePixKey } from '../../../contract/payment/pix';
import { isStoreOpen } from '../../../contract/pricing/geo';
import { kitchenRoom, shopRoom } from '../../../contract/shop/rooms';
import { describeSettingsError, shopSettingsPatchSchema } from '../../../contract/shop/settings';
import { hashPassword } from '../../auth';
import { getMetaValue, getSettings, setMetaValue } from '../../db';
import { getSecret, hasSecret, setSecret } from '../../infra/secrets';
import { getPublicKey, isMercadoPagoConnected, isOAuthConfigured, isTestMode, mercadoPagoUserId } from '../../mercadopago';
import { requireStaff, roleOf } from '../middleware/auth';
import { asyncRoute } from '../middleware/errors';
import { shopIdOf } from '../middleware/tenant';

/**
 * As configurações da loja.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function settingsRouter(io: Server): Router {
  const router = Router();

  // ---------- Settings / Configurações ----------
  const backupMeta = (req: Request, key: string, fallback = '') =>
    getMetaValue(shopIdOf(req), key, fallback);

  router.get('/settings', (req, res) => {
    const settings = getSettings(shopIdOf(req));
    // Só o FATO de haver PIN sai daqui, nunca o hash: quem lê esta resposta é o
    // painel, e ele só precisa saber se já existe um cadastrado.
    const pinHash = getSecret(shopIdOf(req), 'kitchen_pin_hash');
    const isKitchen = roleOf(req) === 'kitchen';
    const mpConnected = isMercadoPagoConnected(shopIdOf(req));
    const publicSettings = {
      ...settings,
      kitchenPinSet: isKitchen ? !!pinHash : false,
      isOpen: isStoreOpen(settings),
      // Em 'local' a chave da loja é a única forma de PIX: uma conta do
      // Mercado Pago conectada não pode fazer o cliente ver PIX numa loja
      // que desligou o Mercado Pago e ainda não cadastrou a chave.
      pixEnabled: usesLocalPix(settings.pixProvider)
        ? !!settings.pixKey
        : !!(settings.pixKey || mpConnected),
      mercadoPagoConnected: mpConnected,
      mercadoPagoOAuthReady: isOAuthConfigured(),
      mercadoPagoTestMode: isTestMode(shopIdOf(req)),
      mercadoPagoPublicKey: getPublicKey(shopIdOf(req)),
      mercadoPagoUserId: isKitchen ? mercadoPagoUserId(shopIdOf(req)) : '',
      brandPrimaryColor: getMetaValue(shopIdOf(req), 'brand_primary_color'),
      backupEnabled: false,
      backupFrequencyDays: 1,
      backupFolderId: '',
      backupKeySet: false,
      backupLastRun: '',
      backupLastStatus: '',
      backupLastFile: '',
    };
    if (!isKitchen) {
      return res.json(publicSettings);
    }
    res.json({
      ...publicSettings,
      kitchenPinSet: !!pinHash,
      backupEnabled: backupMeta(req, 'backup_enabled', 'true') === 'true',
      backupFrequencyDays: Number(backupMeta(req, 'backup_frequency_days', '1')) || 1,
      backupFolderId: backupMeta(req, 'backup_folder_id'),
      backupKeySet: hasSecret(shopIdOf(req), 'backup_service_account'),
      mpWebhookSecretSet: hasSecret(shopIdOf(req), 'mp_webhook_secret'),
      backupLastRun: backupMeta(req, 'backup_last_run'),
      backupLastStatus: backupMeta(req, 'backup_last_status'),
      backupLastFile: backupMeta(req, 'backup_last_file'),
    });
  });

  router.post(
    '/settings',
    requireStaff('kitchen'),
    asyncRoute(async (req, res) => {
    // O corpo passa pelo schema do contrato ANTES de encostar no banco.
    // Antes disto ele entrava como `any`: `deliveryBaseFee: -50` era aceito e a
    // loja passava a PAGAR o cliente por entregar. O `.strict()` também recusa
    // campo que não existe, em vez de engolir um erro de digitação em silêncio.
    const parsed = shopSettingsPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: describeSettingsError(parsed.error) });
    }
    const patch = parsed.data;

    const upsert = { run: (key: string, value: string) => setMetaValue(shopIdOf(req), key, value) };

    // Estas duas regras dependem do que JÁ está gravado, então não cabem no
    // schema — ele só enxerga o corpo da requisição.
    if (patch.pixKey) {
      const pixErr = validatePixKey(patch.pixKey);
      if (pixErr) return res.status(400).json({ error: pixErr });
    }
    // Salvar "PIX na minha chave" sem chave nenhuma deixaria a loja anunciando
    // um meio de pagamento que quebra na hora de fechar o pedido.
    if (patch.pixProvider && usesLocalPix(patch.pixProvider)) {
      const nextKey = patch.pixKey ?? getSettings(shopIdOf(req)).pixKey.trim();
      if (!nextKey) {
        return res
          .status(400)
          .json({ error: 'Cadastre a chave PIX da loja antes de cobrar o PIX na própria chave.' });
      }
    }

    /**
     * De campo do contrato para linha da tabela `meta`. Uma tabela em vez de 40
     * `if`: acrescentar uma configuração passa a ser uma linha aqui e uma no
     * schema, e não há mais como esquecer de gravar um campo que foi validado.
     */
    const COLUNA: Partial<Record<keyof typeof patch, string>> = {
      storeName: 'store_name',
      city: 'store_city',
      storeAddress: 'store_address',
      storeLat: 'store_lat',
      storeLng: 'store_lng',
      pickupEnabled: 'pickup_enabled',
      pickupReadyMinutes: 'pickup_ready_minutes',
      deliveryPricePerKm: 'delivery_price_per_km',
      deliveryBaseFee: 'delivery_base_fee',
      deliveryMinFee: 'delivery_min_fee',
      freeDeliveryAbove: 'free_delivery_above',
      maxDeliveryKm: 'max_delivery_km',
      minOrderValue: 'min_order_value',
      routeFactor: 'route_factor',
      driverFeePerDelivery: 'driver_fee_per_delivery',
      pixMerchantName: 'pix_merchant_name',
      pixMerchantCity: 'pix_merchant_city',
      cardOnDeliveryEnabled: 'card_on_delivery_enabled',
      storeWhatsApp: 'store_whatsapp',
      orderSoundUrl: 'order_sound_url',
      loyaltyStampCost: 'loyalty_stamp_cost',
      loyaltyRedeemCategory: 'loyalty_redeem_category',
      timezone: 'timezone',
      orderEnabled: 'order_enabled',
      forceOpen: 'force_open',
      backupEnabled: 'backup_enabled',
      backupFrequencyDays: 'backup_frequency_days',
      backupFolderId: 'backup_folder_id',
    };

    for (const [campo, coluna] of Object.entries(COLUNA)) {
      const valor = patch[campo as keyof typeof patch];
      if (valor === undefined) continue;
      upsert.run(coluna, String(valor));
    }

    // Os que não são um `String(valor)` direto.
    if (patch.pixProvider !== undefined) upsert.run('pix_provider', normalizePixProvider(patch.pixProvider));
    if (patch.pixKey !== undefined) upsert.run('pix_key', normalizePixKey(patch.pixKey));
    if (patch.openingHours !== undefined) upsert.run('opening_hours', JSON.stringify(patch.openingHours));
    if (patch.sizeOptions !== undefined) upsert.run('size_options', JSON.stringify(patch.sizeOptions));
    if (patch.kitchenPin) setSecret(shopIdOf(req), 'kitchen_pin_hash', await hashPassword(patch.kitchenPin));
    if (patch.brandPrimaryColor !== undefined) {
      setMetaValue(shopIdOf(req), 'brand_primary_color', patch.brandPrimaryColor);
    }

    // Segredo: vai para `shop_secrets`, nunca para `meta` (que `GET /settings`
    // serializa inteira para o painel).
    if (patch.mpWebhookSecret) {
      setSecret(shopIdOf(req), 'mp_webhook_secret', patch.mpWebhookSecret);
    }
    if (patch.backupServiceAccount) {
      setSecret(shopIdOf(req), 'backup_service_account', patch.backupServiceAccount);
    }

    const nextSettings = getSettings(shopIdOf(req));
    io.to(shopRoom(shopIdOf(req))).emit('settings:updated', { ...nextSettings, isOpen: isStoreOpen(nextSettings) });
    io.to(kitchenRoom(shopIdOf(req))).emit('settings:updated', {
      ...nextSettings,
      kitchenPinSet: true,
      isOpen: isStoreOpen(nextSettings),
      backupEnabled: backupMeta(req, 'backup_enabled', 'true') === 'true',
      backupFrequencyDays: Number(backupMeta(req, 'backup_frequency_days', '1')) || 1,
      backupFolderId: backupMeta(req, 'backup_folder_id'),
      backupKeySet: hasSecret(shopIdOf(req), 'backup_service_account'),
      backupLastRun: backupMeta(req, 'backup_last_run'),
      backupLastStatus: backupMeta(req, 'backup_last_status'),
      backupLastFile: backupMeta(req, 'backup_last_file'),
    });
    res.json({ ok: true });
  })
  );

  return router;
}
