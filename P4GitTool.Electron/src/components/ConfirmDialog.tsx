import React from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'danger' | 'warning';
  disabled?: boolean;
  disabledReason?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmDialog: React.FC<Props> = ({
  open,
  title,
  message,
  detail,
  confirmText = '确认',
  cancelText = '取消',
  confirmVariant = 'primary',
  disabled = false,
  disabledReason,
  onConfirm,
  onClose,
}) => {
  if (!open) return null;

  const confirmClass = {
    primary: 'bg-[#007acc] hover:bg-[#1c91ea]',
    danger:  'bg-[#f44747] hover:bg-[#e03030]',
    warning: 'bg-[#cca700] hover:bg-[#e0b800] text-black',
  }[confirmVariant];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-[#252526] border border-[#444] rounded-lg w-[440px] p-5">
        <h3 className="text-[14px] font-bold text-white mb-3">{title}</h3>
        <p className="text-[11px] text-[#ccc] mb-2">{message}</p>
        {detail && (
          <p className="text-[11px] text-[#888] mb-2">{detail}</p>
        )}
        {disabled && disabledReason && (
          <div className="bg-[#f4877122] border border-[#f4877144] rounded p-2 text-[11px] text-[#f48771] mb-2">
            {disabledReason}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] text-[#ccc] hover:bg-[#333] rounded"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={disabled}
            className={`px-3 py-1.5 text-[11px] text-white font-bold rounded disabled:opacity-40 disabled:cursor-not-allowed ${confirmClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
