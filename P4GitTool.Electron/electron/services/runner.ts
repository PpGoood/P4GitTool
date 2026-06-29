import { spawn } from 'child_process';
import path from 'path';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

// 打包后 Electron 进程的 PATH 可能不包含系统目录，需要手动补全。
// 同时删除 PWD/OLDPWD：这是 Unix 风格的路径环境变量，
// p4 在 Windows 上会优先用它解析相对路径，导致 spawn 的 cwd 被覆盖
// → sync 报 "Path ... is not under client's root" 瞬间失败。
// (现象：工具点 P4 Sync 后遮罩一闪而过、没拉到文件、日志卡在"正在同步")
function getEnv() {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const extraPaths = [
    path.join(systemRoot, 'system32'),
    path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
    systemRoot,
  ].join(path.delimiter);

  const currentPath = process.env.PATH ?? '';
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: currentPath ? `${currentPath}${path.delimiter}${extraPaths}` : extraPaths,
  };
  delete env.PWD;
  delete env.OLDPWD;
  return env;
}

/**
 * 擦掉 stderr / 错误信息里可能回显的 P4 敏感参数：
 * `-u <user>` / `-p <port>` / `-c <client>` / `-P <password>`。
 * 用于把 stderr 透传给日志或 UI 之前。
 */
export function redactSensitive(text: string): string {
  if (!text) return text;
  return text.replace(/(-[upPc])\s+(\S+)/g, (_m, flag) => `${flag} ***`);
}

export async function run(
  cmd: string,
  args: string[],
  cwd?: string,
  silent = false,
  stdin?: string
): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: cwd ?? process.cwd(),
      shell: false,          // 不经过 cmd.exe，参数不会被拆分
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getEnv(),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr: redactSensitive(stderr) });
    });

    proc.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: redactSensitive(err.message) });
    });

    if (stdin !== undefined) {
      proc.stdin.write(stdin);
    }
    proc.stdin.end();
  });
}

// 流式执行，每行通过回调推送（用于 SSE 日志）
export function runStream(
  cmd: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void
): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: getEnv(),
    });

    const handleData = (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) onLine(redactSensitive(line));
      }
    };

    proc.stdout.on('data', handleData);
    proc.stderr.on('data', handleData);
    proc.on('error', (err) => { onLine(`[ERROR] ${redactSensitive(err.message)}`); resolve(1); });
    proc.on('close', (code) => resolve(code ?? 1));
  });
}
