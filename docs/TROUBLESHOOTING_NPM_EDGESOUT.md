# Troubleshooting: npm `Cannot read properties of null (reading 'edgesOut')`

## Cause

This error can be an npm Arborist dependency-tree resolution crash, rather than an application runtime error. In October 2026, npm 10.9.3 was reported to crash when resolving a Vitest 4.1.12 optional peer-dependency conflict. The original project used `vitest: ^4.1.0`, which allowed npm to select 4.1.12.

## Compatibility changes in v0.1.1

- Pin Vitest to `4.1.11`.
- Add a package override for Vitest `4.1.11`.
- Declare npm `>=11.6.0` as the recommended installer. npm 11.6.0 includes the Arborist guard for a related `edgesOut` null dereference; npm 11.21.1 is compatible with Node `^20.17.0 || >=22.9.0`.

These changes are a targeted workaround based on the reported npm/Vitest resolver failure. They do not establish that all future dependency graphs are free from npm bugs.

## Windows PowerShell recovery

Run these commands from the project root (the folder containing `package.json`):

```powershell
node -v
npm -v
npm install -g npm@11.21.1
```

Close and reopen PowerShell, then verify the versions:

```powershell
node -v
npm -v
```

Keep Node at `v22.16.0` or newer within the Node 22 line; npm 11.21.1 requires Node `^20.17.0 || >=22.9.0`.

Remove only generated dependency state, not source files:

```powershell
if (Test-Path node_modules) { Remove-Item node_modules -Recurse -Force }
if (Test-Path package-lock.json) { Remove-Item package-lock.json -Force }
npm cache verify
npm install
```

After `npm install` succeeds:

```powershell
npm run dev
```

Then open `http://localhost:3000` in a web browser. Do not type the URL as a PowerShell command.

## If it still fails

Do not immediately use `--force` or `--legacy-peer-deps`, because those options can hide a peer dependency conflict. Collect the full npm debug log from the path printed by npm and inspect the first `verbose stack` / `error` section. Also capture:

```powershell
node -v
npm -v
npm config get registry
npm ls --all
```

Do not share `.env.local`, access tokens, passwords, or confidential document contents with the log.
