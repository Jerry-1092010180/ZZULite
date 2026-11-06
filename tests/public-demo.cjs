// Offline demo must never touch real school APIs or user storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
module.exports = function checkDemo(ts) {
  const root = path.resolve(__dirname, '..');
  let page; const navigation = [];
  const wx = new Proxy({}, {get(_, key) {
    if (['navigateTo','redirectTo','switchTab'].includes(key)) return v => navigation.push(v.url);
    throw Error('Demo accessed forbidden wx API: '+String(key));
  }});
  const filename = path.join(root,'miniprogram/pages/demo/demo.ts');
  const code = ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(code,{wx,Page:v=>page=v,exports:{},require:()=>{throw Error('Demo imported external service')}});
  const view = {...page,data:JSON.parse(JSON.stringify(page.data)),setData(v){Object.assign(this.data,v)}};
  for(let index=0; index<5; index++) {view.chooseSection({currentTarget:{dataset:{index}}});assert.equal(view.data.section,index);}
  view.chooseSection({currentTarget:{dataset:{index:9}}});assert.equal(view.data.section,4);
  view.semester({detail:{value:'1'}});assert.equal(view.data.grades.length,1);
  view.search({detail:{value:'不存在'}});assert.equal(view.data.grades.length,0);
  view.search({detail:{value:''}});assert.equal(view.data.grades.length,1);
  view.chooseMeter({detail:{value:'1'}});assert.equal(view.data.meter.name,'空调');
  view.chooseMeter({detail:{value:'0'}});assert.equal(view.data.meter.name,'照明');
  view.refresh();assert.equal(view.data.refreshed,true);
  view.toggleRoom();assert.equal(view.data.occupied,true);
  for(let i=0;i<50;i++)view.next();assert.equal(view.data.week,20);
  for(let i=0;i<50;i++)view.previous();assert.equal(view.data.week,1);
  view.login();view.exit();assert.deepEqual(navigation,['/pages/login/login','/pages/today/today']);
  const app=JSON.parse(fs.readFileSync(path.join(root,'miniprogram/app.json'),'utf8'));assert.ok(app.pages.includes('pages/demo/demo'));
  for(const name of ['today','login','more']) {
    const p=fs.readFileSync(path.join(root,`miniprogram/pages/${name}/${name}.wxml`),'utf8');
    assert.ok(p.includes('bindtap="demo"'));assert.ok(p.includes('虚构数据'));
  }
  return 'PASS: public demo sections, filters, meters, navigation, week bounds; no storage, auth or network access';
};
