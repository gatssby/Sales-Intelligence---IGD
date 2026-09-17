# Gemini POC launcher (macOS)

Arquivos auxiliares do POC local do Sales Intelligence IGD.

## Iniciar

```bash
zsh scripts/gemini-poc-start.command
```

O launcher:

1. verifica as credenciais no macOS Keychain;
2. abre o túnel SSH local `55432 -> oracle-vps:5432` se necessário;
3. sobe o Next.js local na porta `3000` usando **somente** `sales_igd_test`;
4. abre o Gemini no Brave;
5. passa `igd_poc_autostart=1`, fazendo o userscript ligar o worker automaticamente.

O token e a senha não são gravados em arquivos pelo launcher.

## Encerrar

```bash
zsh scripts/gemini-poc-stop.command
```

O stop encerra apenas processos que o launcher marcou como próprios. Se o túnel ou backend já estavam rodando antes, eles são preservados.

## Log

```text
/tmp/sales-igd-gemini-poc-next.log
```

## Pré-requisitos

- worktree: `/Users/gatsby/Workspace/Sales Intelligence - IGD-gemini-poc`
- SSH alias: `oracle-vps`
- Keychain:
  - `sales-igd-test-db-password`
  - `sales-igd-gemini-poc-worker-token`
- Tampermonkey com o userscript `sales-intelligence-gemini-worker.user.js` v0.1.2+
