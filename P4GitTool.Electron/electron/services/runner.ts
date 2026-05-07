import { spawn } from 'child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
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
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
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
    });

    const handleData = (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    };

    proc.stdout.on('data', handleData);
    proc.stderr.on('data', handleData);
    proc.on('close', (code) => resolve(code ?? 1));
  });
}
