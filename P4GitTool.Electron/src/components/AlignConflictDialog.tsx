import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';

export const AlignConflictDialog: React.FC = () => {
  const viewMode = useAppStore((s) => s.viewMode);
  const runAlignGitContinue = useAppStore((s) => s.runAlignGitContinue);
  const isLoading = useAppStore((s) => s.isLoading);
  const headHash = useAppStore((s) => {
    const stream = s.currentStream;
    if (!stream) return '';
    return s.workspaces[stream]?.status?.headHash ?? '';
  });

  const [resolvedFiles, setResolvedFiles] = useState<string[] | null>(null);

  if (viewMode.kind !== 'conflict') return null;
  const conflicts = viewMode.files;

  const handleTheirs = async () => {
    const result = await runAlignGitContinue('theirs');
    if (result?.resolvedFiles && result.resolvedFiles.length > 0) {
      setResolvedFiles(result.resolvedFiles);
    }
  };

  const copyResult = () => {
    if (!resolvedFiles) return;
    const text = `合并覆盖了以下文件（commit: ${headHash.slice(0, 7)}）：\n${resolvedFiles.map(f => `- ${f}`).join('\n')}`;
    navigator.clipboard.writeText(text);
  };

  // 覆盖完成后显示结果
  if (resolvedFiles) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
        <div className="bg-[#252526] border border-[#444] rounded-lg w-[500px] p-5">
          <h3 className="text-[14px] font-bold text-[#4ec9b0] mb-1">✓ 已用 P4 版本覆盖</h3>
          <p className="text-[11px] text-[#888] mb-3">
            以下文件已被 P4 版本覆盖（commit: <span className="text-[#9cdcfe] font-mono">{headHash.slice(0, 7)}</span>）：
          </p>

          <div className="bg-[#1e1e1e] rounded p-3 mb-3 max-h-[160px] overflow-y-auto">
            {resolvedFiles.map((f, i) => (
              <div key={i} className="text-[11px] text-[#cca700] font-mono py-0.5">
                • {f}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={copyResult}
              className="px-3 py-1.5 bg-[#2a2d2e] hover:bg-[#3c3c3c] text-[#9cdcfe] text-[11px] rounded border border-[#444]"
            >
              📋 复制结果
            </button>
            <button
              onClick={() => setResolvedFiles(null)}
              className="px-3 py-1.5 bg-[#007acc] hover:bg-[#1c91ea] text-white text-[11px] font-bold rounded"
            >
              确认
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-[#252526] border border-[#444] rounded-lg w-[500px] p-5">
        <h3 className="text-[14px] font-bold text-[#f48771] mb-1">⚠ 发现代码冲突</h3>
        <p className="text-[11px] text-[#888] mb-3">以下文件存在冲突，请选择解决方式：</p>

        <div className="bg-[#1e1e1e] rounded p-3 mb-4 max-h-[160px] overflow-y-auto">
          {conflicts.map((f, i) => (
            <div key={i} className="text-[11px] text-[#f48771] font-mono py-0.5">
              • {f}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={handleTheirs}
            disabled={isLoading}
            className="px-3 py-2 bg-[#007acc22] hover:bg-[#007acc33] disabled:opacity-40 text-left rounded border border-[#007acc44]"
          >
            <div className="text-[12px] font-bold text-[#007acc]">以 P4 版本覆盖本地</div>
            <div className="text-[10px] text-[#888]">丢弃本地改动，使用 P4 服务器的版本（覆盖后会显示被覆盖的文件列表）</div>
          </button>

          <button
            onClick={() => runAlignGitContinue('manual')}
            disabled={isLoading}
            className="px-3 py-2 bg-[#4ec9b022] hover:bg-[#4ec9b033] disabled:opacity-40 text-left rounded border border-[#4ec9b044]"
          >
            <div className="text-[12px] font-bold text-[#4ec9b0]">在 Git 中手动解决</div>
            <div className="text-[10px] text-[#888]">在 Fork 或 VSCode 中解决冲突后，回来点击此按钮继续</div>
          </button>
        </div>
      </div>
    </div>
  );
};
