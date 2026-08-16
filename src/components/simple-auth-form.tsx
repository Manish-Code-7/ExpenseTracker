"use client";

import { useState } from "react";

/**
 * The two single-purpose auth forms: request a reset link, and choose a new
 * password. Both are one call with one outcome message.
 */
export function SimpleAuthForm({
  onSubmit,
  submitLabel,
  pendingLabel,
  fields,
  footer,
}: {
  onSubmit: () => Promise<{ error?: string; message?: string }>;
  submitLabel: string;
  pendingLabel: string;
  fields: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [state, setState] = useState<{ error?: string; message?: string }>({});
  const [pending, setPending] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setState({});
        setState(await onSubmit());
        setPending(false);
      }}
      className="space-y-4"
    >
      {fields}

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      {state.message ? (
        <p role="status" className="text-sm text-positive">
          {state.message}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </button>

      {footer}
    </form>
  );
}
