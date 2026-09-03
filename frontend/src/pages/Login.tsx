import { FormEvent, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { login } from "../api/client";
import { Field, FormPage, FormSubmit } from "../components/formArchetype";
import { ErrorState } from "../components/uiStates";
import { themeTransitionSettled } from "../theme";

type FieldErrors = { email?: string; password?: string; form?: string };

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  // The request is done and the sweep is running: still not interactive, but no
  // longer working. #78 rules out a spinner, and a button narrating "Logging in…"
  // across the whole 700ms is the same thing wearing a label — it tells the reader
  // the app is busy through the one moment it is meant to be performing.
  const [sweeping, setSweeping] = useState(false);

  // Presence only. Login must not tell a visitor which half of a wrong pair was
  // wrong, so anything beyond "you left this blank" is the backend's 401 to give
  // — which lands in the shared error treatment below the fields, not against a
  // field, because neither field is the one that failed.
  function validate(): FieldErrors {
    const found: FieldErrors = {};
    if (!email) found.email = "Enter your email address";
    if (!password) found.password = "Enter your password";
    return found;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validate();
    if (found.email || found.password) {
      setErrors(found);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await login({ email, password });
      setSweeping(true);
      // The sweep retints *this* page (#78, DESIGN.md §7), so the navigation waits
      // for it: /login and /dashboard are different layouts, and leaving now would
      // replace every node mid-transition, leaving nothing painted to retint.
      // login() has already put the dashboard's data in flight, so the wait buys
      // the arrival rather than costing it — and under reduced motion there is no
      // sweep to wait for and this resolves at once.
      await themeTransitionSettled();
      navigate("/dashboard");
    } catch (err) {
      setErrors({ form: (err as Error).message });
    } finally {
      setSubmitting(false);
      setSweeping(false);
    }
  }

  return (
    <FormPage
      folio="Account access"
      title="Log in"
      onSubmit={onSubmit}
      aside={
        <>
          Need an account? <Link to="/register">Register</Link>
        </>
      }
    >
      <Field id="email" label="Email" error={errors.email}>
        {(props) => (
          <input
            {...props}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors((prev) => ({ ...prev, email: undefined }));
            }}
            required
          />
        )}
      </Field>
      <Field id="password" label="Password" error={errors.password}>
        {(props) => (
          <input
            {...props}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrors((prev) => ({ ...prev, password: undefined }));
            }}
            required
          />
        )}
      </Field>
      {errors.form && <ErrorState>{errors.form}</ErrorState>}
      <FormSubmit pending={submitting} pendingLabel={sweeping ? "Log in" : "Logging in…"}>
        Log in
      </FormSubmit>
    </FormPage>
  );
}
