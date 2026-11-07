import "server-only";

import { query } from "@/lib/db";

export type OnboardingStep = "welcome" | "interests" | "watchlist" | "done";

export type MemberProfile = {
  displayName: string | null;
  experience: string | null;
  interests: string[];
  onboardingStep: OnboardingStep;
  onboardingCompleted: boolean;
};

type ProfileRow = {
  display_name: string | null;
  experience: string | null;
  interests: string[] | null;
  onboarding_step: string;
  onboarding_completed: boolean;
};

function toProfile(row: ProfileRow): MemberProfile {
  return {
    displayName: row.display_name,
    experience: row.experience,
    interests: row.interests ?? [],
    onboardingStep: (row.onboarding_step as OnboardingStep) ?? "welcome",
    onboardingCompleted: row.onboarding_completed,
  };
}

export async function getProfile(userId: string): Promise<MemberProfile | null> {
  const rows = await query<ProfileRow>(
    `select display_name, experience, interests, onboarding_step, onboarding_completed
     from member_profile where user_id = $1`,
    [userId],
  );
  return rows[0] ? toProfile(rows[0]) : null;
}

export async function ensureProfile(userId: string, fallbackName: string): Promise<MemberProfile> {
  await query(
    `insert into member_profile (user_id, display_name)
     values ($1, $2)
     on conflict (user_id) do nothing`,
    [userId, fallbackName],
  );

  const profile = await getProfile(userId);
  return profile ?? {
    displayName: fallbackName,
    experience: null,
    interests: [],
    onboardingStep: "welcome",
    onboardingCompleted: false,
  };
}

export async function updateProfile(
  userId: string,
  patch: {
    displayName?: string;
    experience?: string;
    interests?: string[];
    onboardingStep?: OnboardingStep;
    onboardingCompleted?: boolean;
  },
): Promise<MemberProfile> {
  const rows = await query<ProfileRow>(
    `update member_profile set
       display_name = coalesce($2, display_name),
       experience = coalesce($3, experience),
       interests = coalesce($4, interests),
       onboarding_step = coalesce($5, onboarding_step),
       onboarding_completed = coalesce($6, onboarding_completed),
       updated_at = now()
     where user_id = $1
     returning display_name, experience, interests, onboarding_step, onboarding_completed`,
    [
      userId,
      patch.displayName ?? null,
      patch.experience ?? null,
      patch.interests ?? null,
      patch.onboardingStep ?? null,
      patch.onboardingCompleted ?? null,
    ],
  );

  return toProfile(rows[0]);
}
