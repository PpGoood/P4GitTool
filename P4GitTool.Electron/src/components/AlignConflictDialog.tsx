import React from 'react';
import { useAppStore } from '../store/appStore';

export const AlignConflictDialog: React.FC = () => {
  const conflicts = useAppStore((s) => s.alignConflicts);
  const runAlignGitContinue = useAppStore((s) => s.runAlignGitContinue);
  const isLoading = useAppStore((s) => s.isLoading);

  if (!conflicts || conflicts.length === 0) return null;

  const copyConflicts = () => {
    const text = `以下文件存在冲突，请帮我解决：\n${conflicts.map(f => `- ${f}`).join('\n')}`;
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-[#252526] border border-[#444] rounded-lg w-[500px] p-5">
        <h3 className="text-[14px] font-bold text-[#f48771] mb-1">⚠ 发现代码冲突</h3>
        <p className="text-[11px] text-[#888] mb-3">以下文件存在冲突，请选择解决方式：</p>

        {/* 冲突文件列表 */}
        <div className="bg-[#1e1e1e] rounded p-3 mb-3 max-h-[160px] overflow-y-auto">
          {conflicts.map((f, i) => (
            <div key={i} className="text-[11px] text-[#f48771] font-mono py-0.5">
              • {f}
            </div>
          ))}
        </div>

        {/* 复制按钮 */}
        <button
          onClick={copyConflicts}
          className="w-full mb-4 px-3 py-1.5 bg-[#2a2d2e] hover:bg-[#3c3c3c] text-[#9cdcfe] text-[11px] rounded border border-[#444] text-left"
        >
          📋 复制文件列表（粘贴给 agent 解决）
        </button>

        <p className="text-[11px] text-[#888] mb-3">必须选择解决方式，冲突未解决不能继续其他操作：</p>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => runAlignGitContinue('theirs')}
            disabled={isLoading}
            className="px-3 py-2 bg-[#007acc22] hover:bg-[#007acc33] disabled:opacity-40 text-left rounded border border-[#007acc44]"
          >
            <div className="text-[12px] font-bold text-[#007acc]">使用 P4 版本</div>
            <div className="text-[10px] text-[#888]">丢弃本地改动，完全使用 P4 服务器的版本</div>
          </button>

          <button
            onClick={() => runAlignGitContinue('ours')}
            disabled={isLoading}
            className="px-3 py-2 bg-[#cca70022] hover:bg-[#cca70033] disabled:opacity-40 text-left rounded border border-[#cca70044]"
          >
            <div className="text-[12px] font-bold text-[#cca700]">使用本地版本</div>
            <div className="text-[10px] text-[#888]">保留本地改动，忽略 P4 的更新</div>
          </button>

          <button
            onClick={() => runAlignGitContinue('manual')}
            disabled={isLoading}
            className="px-3 py-2 bg-[#4ec9b022] hover:bg-[#4ec9b033] disabled:opacity-40 text-left rounded border border-[#4ec9b044]"
          >
            <div className="text-[12px] font-bold text-[#4ec9b0]">我已手动解决</div>
            <div className="text-[10px] text-[#888]">已在 Fork 或编辑器中解决冲突，直接继续</div>
          </button>
        </div>
      </div>
    </div>
  );
};
