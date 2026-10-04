import { spawn } from 'node:child_process';

const MAX_CAPTURED_OUTPUT_LENGTH = 200_000;

export interface CommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunCommandInput {
  readonly command: string;
  readonly arguments_: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

// Runs a real child process (no shell) with a hard deadline and bounded output
// capture, for tests that exercise CLIs like the migration runner.
export const runCommand = ({
  command,
  arguments_,
  environment,
  timeoutMs,
}: RunCommandInput): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const appendOutput = (current: string, chunk: Buffer): string => {
      if (current.length >= MAX_CAPTURED_OUTPUT_LENGTH) {
        return current;
      }

      return `${current}${chunk.toString('utf8')}`.slice(0, MAX_CAPTURED_OUTPUT_LENGTH);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk);
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);

      if (timedOut) {
        reject(new Error(`Command exceeded its ${String(timeoutMs)}ms deadline`));
        return;
      }

      resolve({ exitCode, signal, stdout, stderr });
    });
  });
