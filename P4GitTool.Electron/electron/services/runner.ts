import { spawn } from 'child_process';
import path from 'path';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

// 打包后 Electron 进程的 PATH 可能不包含系统目录，需要手动补全
function getEnv() {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const extraPaths = [
    path.join(systemRoot, 'system32'),
    path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
    systemRoot,
  ].join(path.delimiter);

  const currentPath = process.env.PATH ?? '';
  return {
    ...process.env,
    PATH: currentPath ? `${currentPath}${path.delimiter}${extraPaths}` : extraPaths,
  };
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
      shell: true,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getEnv(),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    proc.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
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
      shell: true,
      windowsHide: true,
      env: getEnv(),
    });

    const handleData = (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    };

    proc.stdout.on('data', handleData);
    proc.stderr.on('data', handleData);
    proc.on('error', (err) => { onLine(`[ERROR] ${err.message}`); resolve(1); });
    proc.on('close', (code) => resolve(code ?? 1));
  });
}
