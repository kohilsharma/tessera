import React, { type ComponentPropsWithoutRef, type ReactNode } from "react";
import { ArrowClockwise, LockKey, WarningCircle } from "@phosphor-icons/react";
import { Button as BaseButton, Input as BaseInput, Select } from "@base-ui-components/react";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { PUBLISHER_LEANINGS, type CoverageSpectrum, type LeaningRating, type LeaningSource } from "../api/client";
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

// CONTEXT.md "Publisher Leaning" · DESIGN.md §8. A rating is somebody else's
// published judgement, so the mark is a *position on their five-point scale*
// rather than a coloured badge: the filled notch says where the outlet sits,
// the label says it in their words, and the colour only reinforces the side
// (§2 rule 3 — remove all colour and the reading survives). The rater's name is
// inside the component, not beside it, so there is no arrangement of these parts
// that shows a verdict about a real publisher with nobody's name on it.
export function Leaning({ leaning }: { leaning: LeaningRating | null }) {
  // Not a blank: raters cover nationally prominent outlets, so most publishers
  // carry no rating and the honest answer is words, not an empty cell. It names
  // no rater, because there is no rating here and therefore nobody whose
  // judgement this is — which is also what keeps the rater's name out of the
  // component and in the data (ADR-0035).
  if (!leaning) return <span className={styles.leaningUnrated}>No published rating</span>;
  return (
    <span className={styles.leaning}>
      <span className={styles.leaningScale} data-band={leaning.band} aria-hidden="true">
        {PUBLISHER_LEANINGS.map((step) => (
          <span key={step} data-on={step === leaning.rating ? "" : undefined} />
        ))}
      </span>
      <span className={styles.leaningLabel}>{leaning.label}</span>
      <a
        className={styles.leaningSource}
        href={leaning.source.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`${leaning.source.name} media bias ratings`}
      >
        {leaning.source.name}
      </a>
    </span>
  );
}

// The credit the rating's licence asks for, once per surface that shows ratings:
// the rater's own attribution line and the licence it is published under, both
// openable. Deduplicated here rather than at each call site, so a page hands over
// every rating it drew and gets one line per distinct rater back — including none
// at all when it drew no rating, which is why an unrated page states no licence.
export function LeaningAttribution({ sources }: { sources: LeaningSource[] }) {
  const distinct = [...new Map(sources.map((source) => [source.name, source])).values()];
  if (distinct.length === 0) return null;
  return (
    <p className={styles.leaningAttribution}>
      {distinct.map((source) => (
        <span key={source.name}>
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.attribution}
          </a>{" "}
          Licensed under{" "}
          <a href={source.licenceUrl} target="_blank" rel="noreferrer">
            {source.licence}
          </a>
          .
        </span>
      ))}
    </p>
  );
}

export function CoverageSpectrum({ spectrum }: { spectrum: CoverageSpectrum }) {
  const ratedTotal = spectrum.left + spectrum.centre + spectrum.right;
  if (spectrum.total === 0 || ratedTotal === 0) {
    return <span className={styles.coverageUnrated}>No rated coverage yet ({spectrum.total} Articles)</span>;
  }
  const bands = [
    ["left", "Left", spectrum.left],
    ["centre", "Centre", spectrum.centre],
    ["right", "Right", spectrum.right],
  ] as const;
  return (
    <div className={styles.coverage}>
      <div className={styles.coverageBar} role="img" aria-label={`Coverage spectrum: ${bands.map(([, label, count]) => `${count} ${label.toLowerCase()}`).join(", ")}; ${spectrum.unrated} unrated`}>
        <ResponsiveContainer width="100%" height={28}>
          <BarChart data={[{ name: "Coverage", left: spectrum.left, centre: spectrum.centre, right: spectrum.right }]} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <XAxis type="number" domain={[0, spectrum.total]} hide />
            <YAxis type="category" dataKey="name" hide />
            <Bar dataKey="left" stackId="coverage" fill="var(--left)" isAnimationActive={false} />
            <Bar dataKey="centre" stackId="coverage" fill="var(--centre)" isAnimationActive={false} />
            <Bar dataKey="right" stackId="coverage" fill="var(--right)" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className={styles.coverageLabels}>
        {bands.map(([, label, count]) => <span key={label}>{label} <strong>{count}</strong></span>)}
        {spectrum.unrated > 0 && <span>Unrated <strong>{spectrum.unrated}</strong></span>}
      </div>
      {spectrum.blindspot && <p className={styles.blindspot} role="alert">Blindspot: overwhelmingly {spectrum.blindspot}-leaning coverage among rated Articles.</p>}
      {spectrum.unrated > 0 && <p className={styles.coverageNote}>{spectrum.unrated} Article{spectrum.unrated === 1 ? " has" : "s have"} no published leaning.</p>}
      <p className={styles.coverageAttribution}>
        Leanings reproduced from{" "}
        <a href="https://www.allsides.com/media-bias/media-bias-ratings" target="_blank" rel="noreferrer">
          AllSides Media Bias Ratings™
        </a>{" "}
        under{" "}
        <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer">
          CC BY-NC 4.0
        </a>.
      </p>
    </div>
  );
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
