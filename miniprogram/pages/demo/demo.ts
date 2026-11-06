// Public, offline sample experience. Never import auth, storage or school APIs here.
const sections = ['课表', '成绩', '校园卡', '宿舍电量', '教室'];
const sampleCourses = [
    { id: 'sample-math', day: '周一', name: '高等数学（示例）', time: '08:00–09:40', place: '示例教学楼 A101' },
    { id: 'sample-english', day: '周三', name: '大学英语（示例）', time: '10:10–11:50', place: '示例教学楼 B202' },
    { id: 'sample-physics', day: '周五', name: '大学物理（示例）', time: '14:00–15:40', place: '示例实验楼 C303' },
];
const sampleGrades = [
    { id: 'sample-1', semester: 0, name: '高等数学（示例）', score: '88', credits: '4', note: '正常考试' },
    { id: 'sample-2', semester: 0, name: '大学英语（示例）', score: '良好', credits: '2', note: '文字成绩' },
    { id: 'sample-3', semester: 1, name: '大学物理（示例）', score: '65', credits: '3', note: '补考 · 示例标记' },
];
const sampleMeters = [
    { name: '照明', room: '示例宿舍 · 照明表', kwh: '36.80', readings: [{ time: '示例日 08:00', value: '37.20' }, { time: '示例日 12:00', value: '37.00' }, { time: '示例日 16:00', value: '36.80' }] },
    { name: '空调', room: '示例宿舍 · 空调表', kwh: '52.40', readings: [{ time: '示例日 08:00', value: '55.60' }, { time: '示例日 12:00', value: '54.00' }, { time: '示例日 16:00', value: '52.40' }] },
];
Page({
    data: { sections, meterNames: ['照明', '空调'], section: 0, week: 8, semester: 0, semesters: ['示例学期一', '示例学期二'], search: '', grades: sampleGrades.filter(g => g.semester === 0), courses: sampleCourses, meterIndex: 0, meter: sampleMeters[0], refreshed: false, occupied: false },
    chooseSection(e: WechatMiniprogram.TouchEvent) {
        const i = Number(e.currentTarget.dataset.index);
        if (Number.isInteger(i) && i >= 0 && i < sections.length) this.setData({ section: i });
    },
    previous() { if (this.data.week > 1) this.setData({ week: this.data.week - 1 }); },
    next() { if (this.data.week < 20) this.setData({ week: this.data.week + 1 }); },
    semester(e: WechatMiniprogram.PickerChange) {
        const i = Number(e.detail.value);
        if (i !== 0 && i !== 1) return;
        this.setData({ semester: i }); this.filterGrades();
    },
    search(e: WechatMiniprogram.Input) { this.setData({ search: e.detail.value }); this.filterGrades(); },
    filterGrades() { const q = this.data.search.trim().toLowerCase(); this.setData({ grades: sampleGrades.filter(g => g.semester === this.data.semester && g.name.toLowerCase().includes(q)) }); },
    chooseMeter(e: WechatMiniprogram.PickerChange) { const i = Number(e.detail.value); if (i === 0 || i === 1) this.setData({ meterIndex: i, meter: sampleMeters[i] }); },
    refresh() { this.setData({ refreshed: true }); },
    toggleRoom() { this.setData({ occupied: !this.data.occupied }); },
    login() { wx.redirectTo({ url: '/pages/login/login' }); },
    exit() { wx.switchTab({ url: '/pages/today/today' }); },
});
