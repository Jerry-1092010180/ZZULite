import type { Cache, Session } from './schedule';
import { courseTime } from './course-time';
export const SCHEDULE_KEY = 'zzu.schedule';
export const ACTIVE_KEY = 'zzu.schedule.active';
const DAY_MS = 86400000;
// Campus dates stay in UTC+8, independent of the phone's system timezone.
export function campusDate(now = new Date()): string {
    const local = new Date(now.getTime() + 8 * 3600000);
    return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
}
export function dayNumber(value: string): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match)
        return NaN;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() / DAY_MS : NaN;
}
export function readCache(key = SCHEDULE_KEY): Cache | null {
    try {
        const cache = wx.getStorageSync(key) as Cache;
        if (!cache || !cache.semester || !Array.isArray(cache.sessions) || typeof cache.account !== 'string')
            return null;
        if (!cache.sessions.every(s => s && typeof s.name === 'string' && typeof s.start === 'number' && typeof s.end === 'number'))
            return null;
        return { ...cache, periods: Array.isArray(cache.periods) ? cache.periods : [] };
    }
    catch (_) {
        return null;
    }
}
export function coversDate(cache: Cache, date: string): boolean {
    if (cache.sessions.some(s => s.date === date))
        return true;
    const day = dayNumber(date), start = dayNumber(cache.semester.startDate || ''), end = dayNumber(cache.semester.endDate || '');
    return Number.isFinite(day) && Number.isFinite(start) && Number.isFinite(end) && day >= start && day <= end;
}
export function todayCache(date: string): Cache | null {
    const selected = readCache(), active = readCache(ACTIVE_KEY);
    // Never combine snapshots belonging to different accounts.
    const candidates = [selected, active].filter((c): c is Cache => !!c && (!selected || c.account === selected.account));
    const applicable = candidates.filter(c => coversDate(c, date));
    applicable.sort((a, b) => b.updated - a.updated);
    return applicable[0] || selected || active;
}
export function coursesOn(cache: Cache, date: string): Session[] {
    const day = dayNumber(date), start = dayNumber(cache.semester.startDate || '');
    const week = Math.floor((day - start) / 7) + 1;
    const weekday = ((day + 3) % 7 + 7) % 7 + 1;
    const covered = coversDate(cache, date);
    return cache.sessions.filter(s => s.date ? s.date === date : covered && week > 0 && s.week === week && s.day === weekday)
        .sort((a, b) => (a.start || 99) - (b.start || 99))
        .map(s => ({ ...s, time: courseTime(s, cache.periods || []) }));
}
export function nextDayDelay(now = new Date()): number {
    const elapsed = (now.getTime() + 8 * 3600000) % DAY_MS;
    return DAY_MS - elapsed + 50;
}
export function syncLabel(timestamp: number): string {
    if (!Number.isFinite(timestamp) || timestamp <= 0)
        return '同步时间未知';
    const local = new Date(timestamp + 8 * 3600000);
    return `${campusDate(new Date(timestamp))} ${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}
