"use client";

import { useActionState } from "react";
import { changePasswordAction, type ChangePasswordState } from "./actions";

const initialState: ChangePasswordState = { error: null };

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initialState);
  return (
    <form action={action} className="auth-form">
      <label>Senha temporária<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
      <label>Nova senha<input name="nextPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
      <label>Confirmar nova senha<input name="confirmation" type="password" autoComplete="new-password" minLength={12} required /></label>
      <small>Use pelo menos 12 caracteres, incluindo maiúscula, minúscula e número.</small>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending}>{pending ? "Salvando…" : "Definir nova senha"}</button>
    </form>
  );
}
