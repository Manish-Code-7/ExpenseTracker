import { parseISO, todayISO } from "@/lib/dates";

export type Profile = {
  id: string;
  full_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Suggested options only — `gender` is free text in the database so anyone can
 * self-describe rather than being forced into a list.
 */
export const GENDER_SUGGESTIONS = [
  "Female",
  "Male",
  "Non-binary",
  "Prefer not to say",
] as const;

/**
 * Age is computed from date_of_birth, never stored. A stored age is wrong from
 * the user's next birthday onwards, and nothing would ever correct it.
 */
export function ageFrom(dateOfBirth: string | null, today = todayISO()) {
  if (!dateOfBirth) return null;

  const dob = parseISO(dateOfBirth);
  const now = parseISO(today);
  if (Number.isNaN(dob.y)) return null;

  let age = now.y - dob.y;
  if (now.m < dob.m || (now.m === dob.m && now.d < dob.d)) age -= 1;

  return age >= 0 && age < 130 ? age : null;
}

/** First name if we have one, otherwise the part of the email before the @. */
export function displayName(
  profile: Pick<Profile, "full_name"> | null,
  email?: string | null,
) {
  const name = profile?.full_name?.trim();
  if (name) return name.split(/\s+/)[0];
  return email?.split("@")[0] ?? "there";
}

export function initials(
  profile: Pick<Profile, "full_name"> | null,
  email?: string | null,
) {
  const name = profile?.full_name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (email?.[0] ?? "?").toUpperCase();
}
