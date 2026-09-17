# Gemini POC launcher (macOS)

Arquivos auxiliares do POC local do Sales Intelligence IGD.

## Iniciar

Por padrão, abre 2 abas/workers:

```bash
zsh scripts/gemini-poc-start.command
```

Para escolher a quantidade:

```bash
zsh scripts/gemini-poc-start.command 1
zsh scripts/gemini-poc-start.command 2
zsh scripts/gemini-poc-start.command 4
zsh scripts/gemini-poc-start.command 8
```

Aceita de 1 a 16 workers. Cada aba recebe identidade própria via `sessionStorage`.

O launcher:

1. verifica as credenciais no macOS Keychain;
2. abre o túnel SSH local `55432 -> oracle-vps:5432` se necessário;
3. sobe o Next.js local na porta `3000` usando **somente** `sales_igd_test`;
4. abre N abas do Gemini no Brave (padrão: 2);
5. passa `igd_poc_autostart=1` e um slot distinto para cada aba, fazendo o userscript ligar cada worker automaticamente.

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
