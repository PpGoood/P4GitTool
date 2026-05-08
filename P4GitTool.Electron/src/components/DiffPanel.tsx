import React from 'react';
import { RotateCcw } from 'lucide-react';
import { useAppStore, useCurrentWorkspace } from '../store/appStore';
import { DiffHunk } from '../api/client';

export const DiffPanel: React.FC = () => {
  const ws = useCurrentWorkspace();
  const isLoading = useAppStore((s) => s.isLoading);
  const runDiscardHunk = useAppStore((s) => s.runDiscardHunk);
  const runDiscardLine = useAppStore((s) => s.runDiscardLine);

  if (!ws.selectedFile) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#555] text-[12px]">
        选择左侧文件查看改动内容
      </div>
    );
  }

  // 选中了文件但 diff 还是 null：区分加载中和无内容
  if (!ws.diff) {
    if (isLoading) {
      return (
        <div className="flex-1 flex items-center justify-center text-[#555] text-[12px]">
          加载中...
        </div>
      );
    }
    return (
      <div className="flex-1 flex items-center justify-center text-[#555] text-[12px]">
        无法加载 diff（可能是新增文件或工作区未初始化）
      </div>
    );
  }

  const renderHunk = (hunk: DiffHunk, hunkIndex: number) => {
    let oldLn = hunk.oldStart;
    let newLn = hunk.newStart;

    return (
      <div key={hunkIndex} className="mb-4">
        <div className="group px-4 py-1 bg-[#569cd614] flex items-center justify-between sticky top-0">
          <span className="text-[#569cd6] text-[10px] font-mono">{hunk.header}</span>
          <button
            onClick={async () => {
              if (!confirm('撤销这段改动？')) return;
              await runDiscardHunk(ws.selectedFile!, hunkIndex);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] text-[#888] hover:text-[#f48771] px-2 py-0.5 rounded hover:bg-[#3c3c3c]"
          >
            <RotateCcw size={10} /> Discard hunk
          </button>
        </div>

        <div className="font-mono text-[11px] leading-[1.7]">
          {hunk.lines.map((l, lineIndex) => {
            const isAdd = l.type === 'add';
            const isDel = l.type === 'del';
            const isCtx = l.type === 'ctx';
            const bg = isAdd ? 'bg-[#4ec9b014]' : isDel ? 'bg-[#f4877114]' : '';
            const color = isAdd ? 'text-[#4ec9b0]' : isDel ? 'text-[#f48771]' : 'text-[#888]';
            const sign = isAdd ? '+' : isDel ? '-' : ' ';

            let lnOld: number | string = ' ';
            let lnNew: number | string = ' ';
            if (isCtx) { lnOld = oldLn++; lnNew = newLn++; }
            else if (isAdd) { lnNew = newLn++; }
            else if (isDel) { lnOld = oldLn++; }

            return (
              <div
                key={lineIndex}
                className={`group/line px-4 flex gap-3 ${bg} ${color}`}
              >
                <span className="text-[#444] w-6 text-right select-none">
                  {typeof lnOld === 'number' ? lnOld : ''}
                </span>
                <span className="text-[#444] w-6 text-right select-none">
                  {typeof lnNew === 'number' ? lnNew : ''}
                </span>
                <span className="w-3 select-none">{sign}</span>
                <span className="flex-1 whitespace-pre">{l.content}</span>
                {!isCtx && (
                  <button
                    onClick={async () => {
                      if (!confirm('撤销这一行改动？')) return;
                      await runDiscardLine(ws.selectedFile!, hunkIndex, lineIndex);
                    }}
                    className="opacity-0 group-hover/line:opacity-100 transition-opacity text-[9px] text-[#888] hover:text-[#f48771]"
                    title="撤销单行"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-3 py-1.5 bg-[#252526] border-b border-[#333] flex items-center gap-2 text-[11px]">
        <span className="text-[#ccc] font-bold">{ws.selectedFile}</span>
        <span className="ml-auto text-[10px] text-[#555]">
          {ws.diff.hunks.length} hunk{ws.diff.hunks.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex-1 overflow-auto pt-2 pb-4">
        {ws.diff.hunks.length === 0 ? (
          <div className="text-center text-[#555] text-[12px] py-8">无内容差异</div>
        ) : (
          ws.diff.hunks.map((h, i) => renderHunk(h, i))
        )}
      </div>
    </div>
  );
};
