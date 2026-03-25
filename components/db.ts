import { supabase } from "@/lib/supabase";
import type { Profile } from "./types";

export async function loadIndex(): Promise<{ id: string; name: string }[] | null> {
  try {
    const { data } = await supabase
      .from("ig_app_state")
      .select("value")
      .eq("key", "index")
      .single();
    return data?.value ? JSON.parse(data.value) : null;
  } catch {
    return null;
  }
}

export async function saveIndex(idx: { id: string; name: string }[]): Promise<void> {
  try {
    await supabase
      .from("ig_app_state")
      .upsert({ key: "index", value: JSON.stringify(idx) });
  } catch {
    // silent
  }
}

export async function loadProfile(id: string): Promise<Profile | null> {
  try {
    const { data } = await supabase
      .from("ig_profiles")
      .select("data")
      .eq("id", id)
      .single();
    return data?.data ?? null;
  } catch {
    return null;
  }
}

export async function saveProfile(p: Profile): Promise<void> {
  try {
    await supabase.from("ig_profiles").upsert({
      id: p.id,
      name: p.name,
      data: p,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // silent
  }
}

export async function deleteStoredProfile(id: string): Promise<void> {
  try {
    await supabase.from("ig_profiles").delete().eq("id", id);
  } catch {
    // silent
  }
}

export async function loadActiveId(): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("ig_app_state")
      .select("value")
      .eq("key", "active_id")
      .single();
    return data?.value ?? null;
  } catch {
    return null;
  }
}

export async function saveActiveId(id: string): Promise<void> {
  try {
    await supabase
      .from("ig_app_state")
      .upsert({ key: "active_id", value: id });
  } catch {
    // silent
  }
}

export async function migrateIfNeeded(): Promise<boolean> {
  try {
    const idx = await loadIndex();
    if (idx) return false;
    const old = localStorage.getItem("ig_planner_profiles_v3");
    if (!old) return false;
    const profiles = JSON.parse(old);
    if (!profiles?.length) return false;
    await Promise.all(profiles.map((p: Profile) => saveProfile(p)));
    await saveIndex(profiles.map((p: Profile) => ({ id: p.id, name: p.name })));
    const oa = localStorage.getItem("ig_planner_active_v3");
    if (oa) await saveActiveId(oa);
    return true;
  } catch {
    return false;
  }
}
