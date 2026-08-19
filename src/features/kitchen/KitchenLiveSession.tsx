import React, { useCallback } from 'react';
import { useLiveSession } from '../../lib/liveSession';
import { getStoredRoleToken } from '../../lib/auth';
import { useKitchenSettingsSync } from './KitchenSettingsStore';
import { useKitchenCatalogSync } from './KitchenCatalogStore';
import { useKitchenDriversSync } from './KitchenDriversStore';
import { useKitchenReportsSync } from './KitchenReportsStore';
import { useKitchenOrdersSync } from './KitchenOrdersStore';
import { useKitchenChatSync } from './KitchenChatStore';

/**
 * Single socket seam for the kitchen: every store exposes a stable sync handle,
 * so a reconnect reconciles all of them and not only the order board.
 */
export const KitchenLiveSession: React.FC = () => {
  const { applySettings, refetch: refetchSettings } = useKitchenSettingsSync();
  const { refetch: refetchCatalog } = useKitchenCatalogSync();
  const { refetch: refetchDrivers } = useKitchenDriversSync();
  const { refetch: refetchReports } = useKitchenReportsSync();
  const { receiveNewOrder, applyOrder, refetch: refetchOrders } = useKitchenOrdersSync();
  const { receiveMessage } = useKitchenChatSync();

  const refetchAll = useCallback(() => {
    refetchOrders();
    refetchCatalog();
    refetchDrivers();
    refetchSettings();
    refetchReports();
  }, [refetchOrders, refetchCatalog, refetchDrivers, refetchSettings, refetchReports]);

  useLiveSession({
    role: 'kitchen',
    token: getStoredRoleToken('kitchen'),
    onSettingsUpdated: applySettings,
    onOrderNew: receiveNewOrder,
    onOrderUpdated: applyOrder,
    onChatMessage: receiveMessage,
    onReconnect: refetchAll,
  });

  return null;
};
