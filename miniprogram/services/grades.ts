import { attemptTags } from './grade-attempt';
// Endpoint/field evidence: zzu-sensei/zzu_my, zzupy/app/eas/undergrad.py and model/eas.py.
import { identity, token } from './auth';
import { request } from './network';
export interface Grade {
    id: string;
    name: string;
    code: string;
    term: string;
    score: string;
    credits: string;
    gp: string;
    status: string;
    attempts: string[];
}
type Row = Record<string, unknown>;
function object(value: unknown): Row | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : null; }
function first(row: Row, keys: string[]): unknown {
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== '')
            return row[key];
    }
    return null;
}
function text(value: unknown, fallback: string): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback; }
function list(value: unknown, depth = 0): unknown[] | null {
    if (Array.isArray(value))
        return value;
    const row = object(value);
    if (!row || depth > 5)
        return null;
    for (const key of ['data', 'records', 'rows', 'content', 'list', 'items']) {
        const result = list(row[key], depth + 1);
        if (result) {
            const page = object(row._page_);
            const total = first(row, ['total', 'totalElements', 'totalRows']) || page && page.totalRows;
            if (typeof total === 'number' && total > result.length)
                throw new Error('学校返回了分页成绩，需要先适配分页，当前不展示不完整结果');
            return result;
        }
    }
    return null;
}
export function parseGrades(value: unknown): Grade[] {
    const root = object(value);
    if (root) {
        const result = first(root, ['result', 'code']);
        if (result !== null && result !== 0 && result !== '0')
            throw new Error('学校未允许本次成绩查询，请稍后重试或检查登录状态');
    }
    const rows = list(value);
    if (!rows)
        throw new Error('学校成绩响应格式与参考实现不一致，需要核对接口');
    return rows.map((item, index) => {
        const row = object(item);
        if (!row)
            throw new Error('学校成绩条目格式发生变化');
        const course = object(row.course) || {};
        const name = first(row, ['courseNameZh', 'courseName', 'nameZh']) || first(course, ['nameZh', 'name', 'courseName']);
        if (name === null)
            throw new Error('成绩条目缺少课程名称，暂不显示不明数据');
        const rawTerm = first(row, ['semester', 'semesterName', 'term', 'termName']);
        const term = object(rawTerm);
        const passed = first(row, ['passed', 'isPassed']);
        let status = '';
        if (passed === true || passed === 1 || passed === 'true')
            status = '通过';
        if (passed === false || passed === 0 || passed === 'false')
            status = '未通过';
        return { id: String(index), name: text(name, '未知课程'), code: text(first(row, ['lessonCode', 'courseCode', 'code']) || first(course, ['code', 'courseCode']), ''), term: text(term ? first(term, ['nameZh', 'name', 'semesterName', 'termName', 'label']) : rawTerm, '未知学期'), score: text(first(row, ['finalGrade', 'score', 'grade']), '未发布'), credits: text(first(row, ['credits', 'credit']), '—'), gp: text(first(row, ['gp', 'gpa', 'gradePoint']), '—'), attempts: attemptTags(row), status };
    });
}
export async function queryGrades(): Promise<Grade[]> {
    const account = identity();
    const result = await request<unknown>('https://jwxt.zzu.edu.cn/eams-micro-server/api/v1/grade/student/grades', 'GET', undefined, { Authorization: token() });
    if (identity() !== account)
        throw new Error('登录账号已变化，请重新查询');
    return parseGrades(result);
}
