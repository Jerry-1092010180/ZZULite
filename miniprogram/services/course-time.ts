export interface Period {
    indexNo: number;
    startTime: string | number;
    endTime: string | number;
}
// User-confirmed ZZU timetable. Only known block boundaries are used;
// individual lesson times within a two-lesson block are not inferred.
const BLOCK_STARTS: Record<number, string> = {
    1: '08:00', 3: '10:10', 5: '14:00', 7: '16:00', 9: '19:00',
};
const BLOCK_ENDS: Record<number, string> = {
    2: '09:40', 4: '11:50', 6: '15:40', 8: '17:40', 10: '20:40',
};
export function clock(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number')
        return '';
    const raw = String(value).trim();
    const match = raw.match(/(?:^|T|\s)(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:$|[+Z\s])/);
    let hour: number, minute: number;
    if (match) {
        hour = Number(match[1]);
        minute = Number(match[2]);
    }
    else if (/^\d{3,4}$/.test(raw)) {
        const number = Number(raw);
        hour = Math.floor(number / 100);
        minute = number % 100;
    }
    else
        return '';
    if (hour > 23 || minute > 59)
        return '';
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}
export function courseTime(course: {
    start: number;
    end: number;
    startTime?: string;
    endTime?: string;
}, periods: Period[] = []): string {
    const first = periods.find(period => period.indexNo === course.start);
    const last = periods.find(period => period.indexNo === course.end);
    const candidates = [
        [clock(course.startTime), clock(course.endTime)],
        [clock(first && first.startTime), clock(last && last.endTime)],
        [BLOCK_STARTS[course.start], BLOCK_ENDS[course.end]],
    ];
    for (const [start, end] of candidates) {
        if (start && end && end > start) return start + '–' + end;
    }
    return '时间待确认';
}
