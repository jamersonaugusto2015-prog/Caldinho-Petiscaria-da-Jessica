import React from 'react';
import { KitchenNotificationsProvider } from './KitchenNotificationsStore';
import { KitchenSettingsProvider } from './KitchenSettingsStore';
import { KitchenSoundProvider } from './KitchenSoundStore';
import { KitchenReportsProvider } from './KitchenReportsStore';
import { KitchenCatalogProvider } from './KitchenCatalogStore';
import { KitchenDriversProvider } from './KitchenDriversStore';
import { KitchenOrdersProvider } from './KitchenOrdersStore';
import { KitchenChatProvider } from './KitchenChatStore';
import { KitchenLiveSession } from './KitchenLiveSession';

/**
 * Composition order follows the dependencies: the toast is needed by every store,
 * the sound alert reads the store settings and the order feed uses both.
 */
export const KitchenProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <KitchenNotificationsProvider>
    <KitchenSettingsProvider>
      <KitchenSoundProvider>
        <KitchenReportsProvider>
          <KitchenCatalogProvider>
            <KitchenDriversProvider>
              <KitchenOrdersProvider>
                <KitchenChatProvider>
                  <KitchenLiveSession />
                  {children}
                </KitchenChatProvider>
              </KitchenOrdersProvider>
            </KitchenDriversProvider>
          </KitchenCatalogProvider>
        </KitchenReportsProvider>
      </KitchenSoundProvider>
    </KitchenSettingsProvider>
  </KitchenNotificationsProvider>
);
