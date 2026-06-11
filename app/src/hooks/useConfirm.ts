import { useState, useCallback } from 'react';
import type { ConfirmOptions } from '../components/ConfirmModal';

interface PendingConfirm {
  options:  ConfirmOptions;
  resolve:  (value: boolean) => void;
}

export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      setPending({ options, resolve });
    });
  }, []);

  function handleConfirm() {
    pending?.resolve(true);
    setPending(null);
  }

  function handleCancel() {
    pending?.resolve(false);
    setPending(null);
  }

  return { confirm, pending, handleConfirm, handleCancel };
}
