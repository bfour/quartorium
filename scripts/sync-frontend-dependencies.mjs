import { spawnSync } from 'node:child_process';

if (process.env.npm_config_user_agent?.startsWith('pnpm/')) {
  const install = spawnSync('pnpm', ['--filter', 'frontend', 'install', '--frozen-lockfile', '--prefer-offline'], {
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (install.error) console.error(install.error.message);
  process.exitCode = install.status ?? 1;
}
