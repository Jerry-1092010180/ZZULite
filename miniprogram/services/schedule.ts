import { readCache, coversDate, campusDate, ACTIVE_KEY, SCHEDULE_KEY } from './schedule-cache';
import { Period, courseTime, clock } from './course-time';
import { request } from './network';
import { token, identity } from './auth';
export interface Semester {
    id: number;
    nameZh: string;
    startDate?: string;
    endDate?: string;
    weekIndices?: number[];
}
interface Schedule {
    weekIndex: number;
    weekday: number;
    startUnit: number;
    endUnit: number;
    date?: string;
    startTime?: string | number;
    endTime?: string | number;
    customPlace?: string;
    lessonType?: string;
    room?: {
        nameZh?: string;
        building?: {
            nameZh?: string;
        };
    };
}
interface Datum {
    course: {
        id: number;
        nameZh: string;
    };
    schedules: Schedule[];
}
export interface Session {
    id: string;
    name: string;
    startTime?: string;
    endTime?: string;
    time?: string;
    place: string;
    week: number;
    day: number;
    start: number;
    end: number;
    date: string;
    experiment: boolean;
}
export interface Cache {
    account: string;
    semester: Semester;
    semesters: Semester[];
    sessions: Session[];
    updated: number;
    periods?: Period[];
}
const HOST = 'https://jwxt.zzu.edu.cn';
const MICRO = HOST + '/eams-micro-server/api/v1';
async function get<T>(url: string): Promise<T> {
    const env = await request<{
        result: number;
        data: T;
    }>(url, 'GET', undefined, { Authorization: token() });
    if (!env || env.result !== 0 || env.data == null)
        throw new Error('教务数据读取失败，请稍后重试');
    return env.data;
}
export function normalize(data: Datum[]): Session[] {
    if (!Array.isArray(data))
        throw new Error('学校课表格式已变化');
    return data.flatMap((datum, courseIndex) => {
        if (!datum.course || !Array.isArray(datum.schedules))
            throw new Error('学校课程格式已变化');
        return datum.schedules.flatMap((s, index) => {
            const date = s.date ? s.date.slice(0, 10) : '';
            const validGrid = s.weekIndex > 0 && s.weekday >= 1 && s.weekday <= 7 && s.startUnit > 0;
            if (!validGrid && !date)
                return [];
            const building = s.room && s.room.building && s.room.building.nameZh || '';
            const room = s.room && s.room.nameZh || '';
            return [{ id: `${courseIndex}-${index}`, name: datum.course.nameZh, startTime: clock(s.startTime), endTime: clock(s.endTime), place: room ? (room.startsWith(building) ? room : building + ' ' + room).trim() : s.customPlace || '地点待定', week: s.weekIndex, day: s.weekday, start: s.startUnit, end: Math.max(s.startUnit, s.endUnit || s.startUnit), date, experiment: s.lessonType === 'EXPERIMENT' }];
        });
    });
}
export function cached(): Cache | null {
    const cache = readCache();
    if (!cache || !Array.isArray(cache.sessions) || !cache.semester)
        return null;
    return { ...cache, sessions: cache.sessions.map(course => ({ ...course, time: courseTime(course, cache.periods || []) })) };
}
export async function sync(semesterId?: number): Promise<Cache> {
    const account = identity();
    if (!account)
        throw new Error('请先登录学校账号');
    const semesters = await get<Semester[]>(HOST + '/eams-door/api/v1/calendar/get-all-semesters');
    if (!Array.isArray(semesters))
        throw new Error('学校学期列表格式已变化');
    const semester = semesterId ? semesters.find(s => s.id === semesterId) : await get<Semester>(MICRO + '/semester/current-semester');
    if (!semester || !semester.id)
        throw new Error('未找到当前学期，请选择其他学期');
    const [data, periods] = await Promise.all([get<Datum[]>(MICRO + `/lesson/student/course-table/${semester.id}?hasExperiment=true`), get<Period[]>(MICRO + '/room/system/course-units').catch(() => [] as Period[])]);
    const sessions = normalize(data).map(course => ({ ...course, time: courseTime(course, Array.isArray(periods) ? periods : []) }));
    if (identity() !== account)
        throw new Error('账号已切换，请重新同步');
    const cache = { account, semester, semesters, sessions, periods: Array.isArray(periods) ? periods : [], updated: Date.now() };
    const previous = readCache();
    if (previous && previous.account === account && coversDate(previous, campusDate()) && !coversDate(cache, campusDate())) {
        wx.setStorageSync(ACTIVE_KEY, previous);
    }
    wx.setStorageSync(SCHEDULE_KEY, cache);
    if (!semesterId || coversDate(cache, campusDate()))
        wx.setStorageSync(ACTIVE_KEY, cache);
    return cache;
}
export function isoDate(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function weekNow(semester: Semester): number {
    if (!semester.startDate)
        return 1;
    const start = new Date(semester.startDate.slice(0, 10) + 'T00:00:00+08:00');
    return Math.max(1, Math.floor((Date.now() - start.getTime()) / 604800000) + 1);
}
export function forWeek(cache: Cache, week: number): Session[] {
    const start = cache.semester.startDate ? new Date(cache.semester.startDate.slice(0, 10) + 'T00:00:00+08:00') : null;
    return cache.sessions.filter(s => {
        if (s.week > 0)
            return s.week === week;
        if (s.date && start) {
            const d = new Date(s.date + 'T00:00:00+08:00');
            return Math.floor((d.getTime() - start.getTime()) / 604800000) + 1 === week;
        }
        return s.week === week;
    }).sort((a, b) => a.day - b.day || a.start - b.start);
}
