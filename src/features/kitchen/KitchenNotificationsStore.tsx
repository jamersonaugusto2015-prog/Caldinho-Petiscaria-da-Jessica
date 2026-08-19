import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

type TriggerToast = (msg: string) => void;

/** The message and the trigger live in separate contexts: every store needs the
 * trigger, but only the shell renders the message. */
const KitchenToastMessageContext = createContext<string | null | undefined>(undefined);
const KitchenToastContext = createContext<TriggerToast | undefined>(undefined);

export const KitchenNotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notificationToast, setNotificationToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerToast = useCallback<TriggerToast>((msg) => {
    setNotificationToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setNotificationToast(null), 4000);
  }, []);

  return (
    <KitchenToastContext.Provider value={triggerToast}>
      <KitchenToastMessageContext.Provider value={notificationToast}>{children}</KitchenToastMessageContext.Provider>
    </KitchenToastContext.Provider>
  );
};

export const useKitchenToast = (): TriggerToast => {
  const context = useContext(KitchenToastContext);
  if (!context) throw new Error('useKitchenToast deve ser usado dentro de KitchenProvider');
  return context;
};

export const useKitchenToastMessage = (): string | null => {
  const context = useContext(KitchenToastMessageContext);
  if (context === undefined) throw new Error('useKitchenToastMessage deve ser usado dentro de KitchenProvider');
  return context;
};
