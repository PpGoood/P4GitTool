import { useState } from 'react';
import { Settings, X, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { P4GitConfig } from '../api/client';

export function ConfigDialog({ onClose }: { onClose: () => void }) {
  const config = useAppStore((s) => s.config);
  const saveConfig = useAppStore((s) => s.saveConfig);

  const [form, setForm] = useState<P4GitConfig>(
    config ?? { p4_port: '', p4_user: '', streams: [] }
  );

  const handleSave = async () => {
    await saveConfig(form);
    onClose();
  };

  const addStream = () => {
    setForm((f) => ({
      ...f,
      streams: [...f.streams, { name: '', client: '', root: '' }],
    }));
  };

  const removeStream = (i: number) => {
    setForm((f) => ({ ...f, streams: f.streams.filter((_, idx) => idx !== i) }));
  };

  const updateStream = (i: number, key: string, value: string) => {
    setForm((f) => ({
      ...f,
      streams: f.streams.map((s, idx) => idx === i ? { ...s, [key]: value } : s),
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#252526] border border-[#3e3e42] rounded-lg w-[520px] max-h-[80vh] flex flex-col shadow-2xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3e3e42]">
          <div className="flex items-center gap-2 text-[#cccccc]">
            <Settings size={14} />
            <span className="text-sm font-medium">配置</span>
          </div>
          <button onClick={onClose} className="text-[#858585] hover:text-[#cccccc] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* P4 配置 */}
          <div className="space-y-3">
            <div className="text-[#858585] text-[11px] uppercase tracking-wider">P4 配置</div>
            <Field label="P4 Port" value={form.p4_port} onChange={(v) => setForm((f) => ({ ...f, p4_port: v }))} placeholder="ssl:server:1666" />
            <Field label="P4 User" value={form.p4_user} onChange={(v) => setForm((f) => ({ ...f, p4_user: v }))} placeholder="username" />
          </div>

          {/* Streams */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[#858585] text-[11px] uppercase tracking-wider">工作区</div>
              <button
                onClick={addStream}
                className="flex items-center gap-1 text-[#858585] hover:text-[#cccccc] text-[11px] transition-colors"
              >
                <Plus size={11} />
                <span>添加</span>
              </button>
            </div>
            {form.streams.map((s, i) => (
              <div key={i} className="bg-[#1e1e1e] rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[#858585] text-[11px]">Stream {i + 1}</span>
                  <button onClick={() => removeStream(i)} className="text-[#858585] hover:text-[#f44747] transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>
                <Field label="名称" value={s.name} onChange={(v) => updateStream(i, 'name', v)} placeholder="dev / main / release" />
                <Field label="Client" value={s.client} onChange={(v) => updateStream(i, 'client', v)} placeholder="p4-client-name" />
                <Field label="Root" value={s.root} onChange={(v) => updateStream(i, 'root', v)} placeholder="D:\work\code\dev_code" />
              </div>
            ))}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex gap-2 px-4 py-3 border-t border-[#3e3e42]">
          <button
            onClick={handleSave}
            className="flex-1 bg-[#007acc] hover:bg-[#1a8ad4] text-white text-xs py-1.5 rounded transition-colors"
          >
            保存
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-[#3c3c3c] hover:bg-[#4a4a4a] text-[#cccccc] text-xs py-1.5 rounded transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-[#858585] text-xs w-16 shrink-0">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-[#3c3c3c] text-[#cccccc] text-xs px-2 py-1.5 rounded border border-[#555] outline-none focus:border-[#007acc] placeholder-[#555]"
      />
    </div>
  );
}
