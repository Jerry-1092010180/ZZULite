// Read-only school APIs adapted from ZZUPocket (MIT).
import { request } from './network';
import { identity, token } from './auth';
import { queryRechargeCapabilities } from './card-recharge';
import { parseBalance } from './card-balance';
export { parseBalance } from './card-balance';
export interface NamedItem {
    id: number;
    nameZh: string;
}
export interface Occupancy {
    startTime: number;
    endTime: number;
    activityType?: string;
}
export interface Classroom {
    id: number;
    nameZh: string;
    roomOccupationInfoVms: Occupancy[];
}
export interface RoomPage {
    data: Classroom[];
    _page_?: {
        totalPages: number;
        totalRows: number;
    };
}
const MICRO = 'https://jwxt.zzu.edu.cn/eams-micro-server/api/v1';
export async function cardBalance(): Promise<number> {
    const account = identity();
    const config = await queryRechargeCapabilities();
    if (identity() !== account) throw new Error('账号已切换，请重新查询');
    return parseBalance({ balance: config.balance });
}
async function eas<T>(path: string, method: 'GET' | 'POST' = 'GET', data?: object): Promise<T> {
    const account = identity();
    const result = await request<{
        result: number;
        data: T;
    }>(MICRO + path, method, data, { Authorization: token(), 'content-type': 'application/json' });
    if (identity() !== account)
        throw new Error('账号已切换，请重新查询');
    if (!result || result.result !== 0 || result.data == null)
        throw new Error('教务服务未返回查询结果');
    return result.data;
}
export async function campuses(): Promise<NamedItem[]> {
    const list = await eas<NamedItem[]>('/room/place/campus');
    if (!Array.isArray(list))
        throw new Error('校区列表格式已变化');
    return list;
}
export async function buildings(campusId: number): Promise<NamedItem[]> {
    const list = await eas<NamedItem[]>('/room/place/building?campusAssoc=' + encodeURIComponent(String(campusId)));
    if (!Array.isArray(list))
        throw new Error('楼栋列表格式已变化');
    return list;
}
export function roomQuery(buildingId: number, date: string, currentPage: number): object {
    if (!Number.isInteger(buildingId) || buildingId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error('请选择有效的楼栋和日期');
    // campusAssoc must not be sent here; the server expects only buildingIds.
    return { currentPage, pageSize: 30, buildingIds: [buildingId], roomTypeIds: [], floors: [], minSeat: '', maxSeat: '', date };
}
export async function rooms(buildingId: number, date: string, page: number): Promise<RoomPage> {
    const result = await eas<RoomPage>('/room/place/rooms', 'POST', roomQuery(buildingId, date, page));
    if (!result || !Array.isArray(result.data))
        throw new Error('教室列表格式已变化');
    return result;
}
export function clock(value: number): string {
    if (!Number.isInteger(value) || value < 0 || value > 2359 || value % 100 > 59)
        return '时间待定';
    return String(Math.floor(value / 100)).padStart(2, '0') + ':' + String(value % 100).padStart(2, '0');
}
