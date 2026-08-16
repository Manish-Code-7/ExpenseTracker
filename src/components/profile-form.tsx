"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc, errorText } from "@/lib/trpc";
import { profileInput } from "@/lib/schemas";
import { GENDER_SUGGESTIONS, ageFrom, type Profile } from "@/lib/profile";
import { todayISO } from "@/lib/dates";

export function ProfileForm({ profile }: { profile: Profile | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const savedGender = profile?.gender ?? "";
  const isSuggested = (GENDER_SUGGESTIONS as readonly string[]).includes(
    savedGender,
  );

  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [gender, setGender] = useState(
    savedGender === "" ? "" : isSuggested ? savedGender : "__custom",
  );
  const [genderCustom, setGenderCustom] = useState(
    isSuggested ? "" : savedGender,
  );
  const [dob, setDob] = useState(profile?.date_of_birth ?? "");

  const age = ageFrom(dob || null);

  const save = trpc.account.updateProfile.useMutation({
    onSuccess: (data) => {
      setSavedAt(data.savedAt);
      // The header avatar reads from the profile, so refresh the shell too.
      router.refresh();
    },
    onError: (e) => setError(errorText(e)),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSavedAt(null);

    const parsed = profileInput.safeParse({
      full_name: fullName,
      gender: gender === "__custom" ? genderCustom : gender,
      date_of_birth: dob || null,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    save.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="card space-y-4 p-4">
        <div>
          <label className="label" htmlFor="full_name">
            Name
          </label>
          <input
            id="full_name"
            className="field"
            maxLength={80}
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your name"
          />
        </div>

        <div>
          <label className="label" htmlFor="date_of_birth">
            Date of birth <span className="normal-case">(optional)</span>
          </label>
          <input
            id="date_of_birth"
            type="date"
            className="field tnum"
            max={todayISO()}
            min="1900-01-02"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-ink-muted">
            {age !== null
              ? `That makes you ${age}. We store the date and work out your age from it, so it never goes stale.`
              : "We store the date rather than an age, so it never goes stale."}
          </p>
        </div>

        <div>
          <label className="label" htmlFor="gender">
            Gender <span className="normal-case">(optional)</span>
          </label>
          <select
            id="gender"
            className="field"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
          >
            <option value="">Not set</option>
            {GENDER_SUGGESTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value="__custom">Self-describe…</option>
          </select>

          {gender === "__custom" ? (
            <input
              className="field mt-2"
              maxLength={40}
              required
              autoFocus
              value={genderCustom}
              onChange={(e) => setGenderCustom(e.target.value)}
              placeholder="How would you describe it?"
              aria-label="Self-described gender"
            />
          ) : null}
        </div>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {savedAt ? (
        <p role="status" className="text-sm text-positive">
          Saved.
        </p>
      ) : null}

      <button
        type="submit"
        className="btn btn-primary w-full"
        disabled={save.isPending}
      >
        {save.isPending ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}
