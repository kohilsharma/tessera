import React, { type ComponentPropsWithoutRef, type ReactNode } from "react";
import { ArrowClockwise, LockKey, WarningCircle } from "@phosphor-icons/react";
import { Button as BaseButton, Input as BaseInput, Select } from "@base-ui-components/react";
import styles from "./primitives.module.css";

type Archetype = "index" | "record" | "form" | "dashboard";

export function PageShell({ archetype, title, action, children }: { archetype: Archetype; title: string; action?: ReactNode; children: ReactNode }) {
  return <main className={`${styles.shell} ${styles[archetype]}`}><header className={styles[`${archetype}Header` as keyof typeof styles]}><h1>{title}</h1>{action}</header>{children}</main>;
}

export function List({ children, label }: { children: ReactNode; label?: string }) {
  return <ul className={styles.list} aria-label={label}>{children}</ul>;
}

export function RegisterRow({ name, value, meta, share = 0, children }: { name: ReactNode; value?: ReactNode; meta?: ReactNode; share?: number; children?: ReactNode }) {
  return <li className={styles.registerRow}><div className={styles.registerRowHeader}><span className={styles.registerRowName}>{name}</span>{value !== undefined && <strong>{value}</strong>}</div>{meta && <span className={styles.registerRowMeta}>{meta}</span>}<div className={styles.meter} aria-hidden="true"><span style={{ "--share": `${Math.max(0, Math.min(1, share)) * 100}%` } as React.CSSProperties} /></div>{children}</li>;
}

export function Card({ children, className, ...props }: ComponentPropsWithoutRef<"section">) {
  return <section {...props} className={`${styles.card}${className ? ` ${className}` : ""}`}>{children}</section>;
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return <div className={styles.stat}><span className={styles.statLabel}>{label}</span><strong className={styles.statValue}>{value}</strong></div>;
}

export function Chip({ children, tone }: { children: ReactNode; tone?: "agree" | "diverge" | "imply" }) {
  return <span className={styles.chip} data-tone={tone}>{children}</span>;
}

export function Button({ children, variant, ...props }: ComponentPropsWithoutRef<typeof BaseButton> & { variant?: "neutral" | "accent" | "danger" }) {
  return <BaseButton {...props} className={styles.button} data-variant={variant}>{children}</BaseButton>;
}

export function TextField({ label, hint, ...props }: ComponentPropsWithoutRef<typeof BaseInput> & { label: string; hint?: string }) {
  return <label className={styles.field}><span>{label}</span><BaseInput {...props} className={styles.input} />{hint && <small className={styles.fieldHint}>{hint}</small>}</label>;
}

export function SelectField({ label, children, ...props }: ComponentPropsWithoutRef<"select"> & { label: string }) {
  const { value, defaultValue, onChange, name, required, disabled, id } = props;
  const items = React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child) || child.type !== "option") return [];
    const option = child as React.ReactElement<{ value?: string; children?: ReactNode }>;
    return [{ value: String(option.props.value), label: option.props.children }];
  });
  return <label className={styles.field}><span>{label}</span><Select.Root items={items} value={value as string | undefined} defaultValue={defaultValue as string | undefined} name={name} required={required} disabled={disabled} id={id} onValueChange={(next) => onChange?.({ target: { value: next ?? "" } } as React.ChangeEvent<HTMLSelectElement>)}><Select.Trigger className={styles.select}><Select.Value /></Select.Trigger><Select.Portal><Select.Positioner><Select.Popup className={styles.selectPopup}><Select.List>{items.map((item) => <Select.Item key={item.value} value={item.value} className={styles.selectItem}>{item.label}</Select.Item>)}</Select.List></Select.Popup></Select.Positioner></Select.Portal></Select.Root></label>;
}

export function TextAreaField({ label, ...props }: ComponentPropsWithoutRef<"textarea"> & { label: string }) {
  return <label className={styles.field}><span>{label}</span><textarea {...props} className={styles.textarea} /></label>;
}

export function CitationChip({ evidenceId, publisher, href }: { evidenceId: string; publisher: string; href: string }) {
  return <a className={styles.citation} href={href}>{evidenceId} · {publisher}</a>;
}

export function RolePanel({ role, children }: { role: string; children: ReactNode }) {
  return <section className={styles.rolePanel} aria-label={`${role} panel`}><p className={styles.rolePanelLabel}><LockKey aria-hidden="true" size={16} /> {role}</p>{children}</section>;
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return <div className={`${styles.state} ${styles.loading}`} role="status" aria-label={label}><span className={styles.skeleton} /><span className={styles.skeleton} /><span className={styles.skeleton} /></div>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <section className={`${styles.state} ${styles.empty}`}><h2 className={styles.stateTitle}>{title}</h2><p className={styles.stateCopy}>{children}</p></section>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <section className={`${styles.state} ${styles.error}`} role="alert"><WarningCircle aria-hidden="true" size={20} /><p className={styles.stateTitle}>{message}</p>{onRetry && <Button onClick={onRetry}><ArrowClockwise aria-hidden="true" size={18} /> Retry</Button>}</section>;
}

export function RefusedState({ role = "your role", children }: { role?: string; children?: ReactNode }) {
  return <section className={`${styles.state} ${styles.refused}`} role="alert" aria-label={`Restricted to ${role}`}><p className={styles.stateTitle}>This area is restricted to {role}.</p><p className={styles.stateCopy}>{children ?? "You do not have permission to view this content."}</p></section>;
}
