import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router-dom";

// The Form archetype: a titled sheet over one panel of labelled fields, each
// field owning the error that belongs to it, closed by one ruled command band.
// Shared here rather than written into each form, because registration, sign-in,
// and the Brief form are the same job three times — and a form that invents its
// own field, error, and submit treatment is how they drift apart (#35).
//
// The four UI states stay the page's own (uiStates.tsx): the Brief form's edit
// mode picks a state before it has a Brief to draw fields for, and a form-level
// failure is the shared error treatment, not a field's.

// Kind, exit, title, and the panel — in that order, as on a record (#33): a page
// states what it is and offers the way back out before it asks for anything.
// `back` is optional because the auth forms have nowhere behind them; they close
// with `aside` instead, the one link to the other half of the pair.
export function FormPage({
  folio,
  title,
  back,
  onSubmit,
  children,
  aside,
}: {
  folio: string;
  title: string;
  back?: { to: string; label: string };
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <main className="form-page">
      <div className="form-head">
        <p className="form-folio">{folio}</p>
        {back && (
          <Link className="form-return" to={back.to}>
            {back.label}
          </Link>
        )}
      </div>
      <h1>{title}</h1>
      {/* noValidate because every rule the fields enforce is stated in the
          field's own error treatment; the browser's bubbles are a second,
          unstyled voice for the same refusal. */}
      <form className="form-panel" onSubmit={onSubmit} noValidate>
        {children}
      </form>
      {aside && <p className="form-aside">{aside}</p>}
    </main>
  );
}

// What a control needs to be the field's control: its label's target, and the
// wiring that points a screen reader at the error or the hint below it. Handed
// to the caller rather than cloned onto its element, so the control stays a
// plain element the page can type-check and add its own props to.
export type FieldControlProps = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
};

// One field: its label, its control, and the one line under it — the error if
// the field failed, the hint if it has one and did not. Both never at once: a
// field that has just been refused has nothing to advise.
//
// `role="alert"` on the error is the treatment's, not the page's: a validation
// message that appears after a submit has to announce itself, and a restyle
// can't quietly stop it (the same contract uiStates.tsx keeps for the states).
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: (props: FieldControlProps) => ReactNode;
}) {
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
      })}
      {error ? (
        <p className="form-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p className="form-field-hint" id={`${id}-hint`}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

// The panel's command, in its own ruled band: the label says which of the two
// things is happening, and `pending` both says it and stops a second submit —
// one control, so no form can show the in-flight state without also blocking
// the double click.
export function FormSubmit({
  pending,
  pendingLabel,
  children,
}: {
  pending: boolean;
  pendingLabel: string;
  children: string;
}) {
  return (
    <div className="form-actions">
      <button className="form-submit" type="submit" disabled={pending}>
        {pending ? pendingLabel : children}
      </button>
    </div>
  );
}
