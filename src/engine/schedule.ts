import type { Clip, Platform, ScheduleSlot } from './types';
import { PLATFORM_LABELS } from './generate/titles';

/**
 * Posting slots, by platform and weekday.
 *
 * These encode ordinary platform convention — short-form windows cluster
 * around the commute and the evening scroll, and weekends shift later. They
 * are a defensible default a creator can override, not a claim about reach.
 */
const SLOTS: Record<Platform, { weekday: string[]; weekend: string[] }> = {
  'youtube-shorts': { weekday: ['12:00', '17:30', '20:00'], weekend: ['11:00', '15:00', '19:30'] },
  tiktok: { weekday: ['07:00', '13:00', '19:00'], weekend: ['10:30', '16:00', '20:30'] },
  'instagram-reels': { weekday: ['08:30', '12:30', '18:30'], weekend: ['11:30', '17:00', '20:00'] },
  x: { weekday: ['09:00', '13:30', '16:30'], weekend: ['10:00', '14:00'] },
  linkedin: { weekday: ['08:00', '11:30'], weekend: [] },
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Distribute clips across a week.
 *
 * Three rules, in order of precedence:
 *  1. The highest-scoring clip goes out first, on the platform with the
 *     tightest fit — there is no reason to hold the best cut back.
 *  2. No two clips from the same topic segment land on the same day, so a
 *     week does not read as one subject repeated.
 *  3. Each platform gets its own cadence rather than a simultaneous blast.
 */
export function buildSchedule(
  clips: Clip[],
  platforms: Platform[],
  startDate: Date,
  days = 7,
): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  const usedPerDay = new Map<string, Set<number>>();
  const platformCursor = new Map<Platform, number>();

  const dayFor = (offset: number) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + offset);
    d.setHours(12, 0, 0, 0);
    return d;
  };

  const ordered = [...clips].sort((a, b) => b.score - a.score);

  // Placement reasons are only informative when they distinguish one clip from
  // the others, so each is compared against this set rather than against fixed
  // thresholds that either fire for everything or for nothing.
  const avg = (pick: (c: Clip) => number) =>
    clips.length ? clips.reduce((n, c) => n + pick(c), 0) / clips.length : 0;
  const norms = {
    hook: avg((c) => c.signals.hook),
    payoff: avg((c) => c.signals.payoff),
    curiosity: avg((c) => c.signals.curiosity),
    concrete: avg((c) => c.signals.concrete),
    duration: avg((c) => c.durationSec),
  };

  ordered.forEach((clip, i) => {
    const primary = platforms[i % platforms.length];

    let placed = false;
    for (let attempt = 0; attempt < days && !placed; attempt++) {
      const offset = (i + attempt) % days;
      const date = dayFor(offset);
      const dayKey = isoDate(date);

      const segsToday = usedPerDay.get(dayKey) ?? new Set<number>();
      if (segsToday.has(clip.segmentIndex) && attempt < days - 1) continue;

      const weekend = date.getDay() === 0 || date.getDay() === 6;
      const table = SLOTS[primary];
      const times = weekend ? table.weekend : table.weekday;
      if (!times.length) continue;

      const cursor = platformCursor.get(primary) ?? 0;
      const time = times[cursor % times.length];
      platformCursor.set(primary, cursor + 1);

      segsToday.add(clip.segmentIndex);
      usedPerDay.set(dayKey, segsToday);

      slots.push({
        clipId: clip.id,
        platform: primary,
        date: dayKey,
        time,
        dayLabel: DAY_NAMES[date.getDay()],
        rationale: rationale(clip, primary, i, weekend, norms),
      });
      placed = true;
    }
  });

  return slots.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

interface Norms { hook: number; payoff: number; curiosity: number; concrete: number; duration: number }

function rationale(clip: Clip, platform: Platform, rank: number, weekend: boolean, n: Norms): string {
  const name = PLATFORM_LABELS[platform];
  const when = weekend ? 'weekend' : 'weekday';

  if (rank === 0) return `Strongest cut of the set (${clip.score.toFixed(0)}) — leads the week on ${name}.`;

  // Whichever property most separates this clip from the rest decides the note.
  const lifts: [number, string][] = [
    [clip.signals.hook - n.hook, `Hardest open in the set, so it survives ${name}'s cold ${when} scroll.`],
    [clip.signals.curiosity - n.curiosity, `Leaves the most unresolved, which is what carries a ${when} feed on ${name}.`],
    [clip.signals.payoff - n.payoff, `Resolves most cleanly of the set — it holds a slower ${when} audience on ${name}.`],
    [clip.signals.concrete - n.concrete, `Carries the most specific detail, which is what gets saved and shared on ${name}.`],
  ];

  const [bestLift, note] = lifts.sort((a, b) => b[0] - a[0])[0];
  if (bestLift > 0.02) return note;

  if (clip.durationSec > n.duration * 1.25) {
    return `Longest cut of the set — placed on ${name}, where the duration ceiling is generous.`;
  }
  return `Spaced from the other ${name} posts and off the topic already used that day.`;
}

export function scheduleToCSV(slots: ScheduleSlot[], clips: Clip[]): string {
  const byId = new Map(clips.map((c) => [c.id, c]));
  const rows = [
    ['date', 'time', 'day', 'platform', 'clip_id', 'title', 'duration_sec', 'source_in', 'source_out', 'score', 'rationale'],
    ...slots.map((s) => {
      const c = byId.get(s.clipId);
      const title = c?.titles.find((t) => t.platform === s.platform)?.text ?? c?.hook ?? '';
      return [
        s.date, s.time, s.dayLabel, s.platform, s.clipId, title,
        c ? c.durationSec.toFixed(1) : '',
        c ? c.start.toFixed(2) : '',
        c ? c.end.toFixed(2) : '',
        c ? c.score.toFixed(1) : '',
        s.rationale,
      ];
    }),
  ];

  return rows
    .map((r) => r.map((cell) => (/[",\n]/.test(String(cell)) ? `"${String(cell).replace(/"/g, '""')}"` : String(cell))).join(','))
    .join('\n');
}
