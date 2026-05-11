import React, { useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (scope: string, alignOnly: boolean) => void;
}

const OPTIONS = [
  {
    value: 'all',
    label: '同步全部',
    desc: '从 P4 拉取最新代码（Source + Content/Script）',
    alignOnly: false,
  },
  {
    value: 'lua',
    label: '只同步 Lua',
    desc: '只拉取 Content/Script/ 下的脚本',
    alignOnly: false,
  },
  {
    value: 'cpp',
    label: '只同步 C++',
    desc: '只拉取 Source/ 下的 C++ 代码',
    alignOnly: false,
  },
  {
    value: 'align',
    label: '对齐 Git（不下载文件）',
    desc: '我已在 P4V 手动 sync，只需更新 Git 记录，消除假改动',
    alignOnly: true,
  },
];

export const P4SyncDialog: React.FC<Props> = ({ open, onClose, onConfirm }) => {
  const [selected, setSelected] = useState('all');

  if (!open) return null;

  const opt = OPTIONS.find(o => o.value === selected)!;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-[#252526] border border-[#444] rounded-lg w-[460px] p-5">
        <h3 className="text-[14px] font-bold text-white mb-1">P4 Sync</h3>
        <p className="text-[11px] text-[#888] mb-4">选择同步方式</p>

        <div className="flex flex-col gap-2 mb-5">
          {OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => setSelected(o.value)}
              className={`text-left px-3 py-2.5 rounded border transition-colors ${
                selected === o.value
                  ? 'border-[#007acc] bg-[#007acc18]'
                  : 'border-[#3e3e42] hover:border-[#555]'
              }`}
            >
              <div className={`text-[12px] font-bold mb-0.5 ${selected === o.value ? 'text-[#007acc]' : 'text-[#ccc]'}`}>
                {o.label}
              </div>
              <div className="text-[10px] text-[#888]">{o.desc}</div>
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] text-[#ccc] hover:bg-[#333] rounded"
          >
            取消
          </button>
          <button
            onClick={() => {
              onConfirm(opt.alignOnly ? 'all' : opt.value, opt.alignOnly);
              onClose();
            }}
            className="px-3 py-1.5 bg-[#007acc] hover:bg-[#1c91ea] text-white text-[11px] font-bold rounded"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
};
