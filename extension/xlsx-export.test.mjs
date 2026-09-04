import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
const listener = { addListener() {} };
const context = vm.createContext({ Blob, fetch, URL, TextEncoder, chrome:{
  runtime:{ onInstalled:listener, onMessage:listener }, commands:{ onCommand:listener },
  action:{ onClicked:listener }, tabs:{ onRemoved:listener, onUpdated:listener }
} });
vm.runInContext(source.replace(/^import[^\n]+\n/, ''), context);
const issue = (extra = {}) => ({ id:'i1', displayId:'UI-001', type:'ui', title:'第一行', description:'第一行\n第二行，必须保留完整描述。',
  priority:'immediate', severity:'blocked', elementAnchor:{ preferredSelector:'#send', rect:{width:68.25,height:34,x:-12.5,y:0} },
  pageSnapshot:{ route:'/project', url:'https://example.test/project?a=1&b=2' }, ...extra });
const build = async (issues = [issue()], assets = []) => Object.fromEntries((await context.buildXlsxReport({name:'走查 "测试"'}, issues, assets, '2026-09-04T00:00:00Z')).map((entry) => [entry.name, entry.data]));

test('证据预览为第一张且唯一选中，冻结表头和编号；跟进表可筛选', async () => {
  const files = await build();
  assert.match(files['xl/workbook.xml'], /activeTab="0" firstSheet="0"/);
  assert.match(files['xl/workbook.xml'], /<sheet name="证据预览" sheetId="1"[^>]+\/><sheet name="问题清单" sheetId="2"/);
  assert.match(files['xl/worksheets/sheet1.xml'], /tabSelected="1"/);
  assert.match(files['xl/worksheets/sheet1.xml'], /xSplit="1" ySplit="4" topLeftCell="B5"/);
  assert.match(files['xl/worksheets/sheet2.xml'], /tabSelected="0"/);
  assert.match(files['xl/worksheets/sheet2.xml'], /xSplit="3" ySplit="4" topLeftCell="D5"/);
  assert.match(files['xl/worksheets/sheet2.xml'], /<autoFilter ref="A4:AC5"\/>/);
  assert.doesNotMatch(files['xl/worksheets/sheet1.xml'], /<autoFilter/, '截图表不提供会打乱图片锚点的排序入口');
});

test('数据行用非默认样式，具有分隔线、隔行底色、换行和明确字号', async () => {
  const files = await build([issue(), issue({id:'i2',displayId:'UI-002'})]);
  for (const name of ['sheet1', 'sheet2']) {
    const sheet = files[`xl/worksheets/${name}.xml`];
    const row5 = sheet.match(/<row r="5"[^>]*>(.*?)<\/row>/s)[1];
    const row6 = sheet.match(/<row r="6"[^>]*>(.*?)<\/row>/s)[1];
    assert.doesNotMatch(row5 + row6, /s="0"/);
    assert.match(row5, /s="1"/); assert.match(row6, /s="2"/);
  }
  const styles = files['xl/styles.xml'];
  assert.match(styles, /<cellStyle name="Normal" xfId="0" builtinId="0"\/>/);
  assert.match(styles, /FFBEC8B8/); assert.match(styles, /FFF3F6F1/);
  assert.match(styles, /vertical="top" wrapText="1"/);
  assert.match(styles, /<sz val="11"\/>/);
});

test('宽高坐标为数值，保留小数、负数和零；未知值不伪造为零', async () => {
  const sheet = (await build())['xl/worksheets/sheet2.xml'];
  for (const [ref,value] of [['K5','68.25'],['L5','34'],['M5','-12.5'],['N5','0']]) assert.match(sheet, new RegExp(`<c r="${ref}" s="8" t="n"><v>${value.replace('.', '\\.')}</v></c>`));
  for (const value of [null, undefined, '', ' ', 'auto', Infinity]) assert.equal(context.deliveryPixel(value), null);
  assert.equal(context.deliveryPixel('0'), 0);
  assert.equal(context.deliveryPixel(12.345), 12.35);
  const empty = (await build([issue({elementAnchor:{}})]))['xl/worksheets/sheet2.xml'];
  assert.match(empty, /<c r="K5" s="8" t="inlineStr"><is><t xml:space="preserve"><\/t>/);
});

test('完整描述保留，危险前缀只作为文本，控制字符不会破坏 XML', async () => {
  const sheet = (await build())['xl/worksheets/sheet2.xml'];
  assert.match(sheet, /第一行\n第二行，必须保留完整描述。/);
  const cell = context.xlsxInlineCell('C5', '=HYPERLINK("https://bad.test")\u0000<&');
  assert.match(cell, /t="inlineStr"/); assert.doesNotMatch(cell, /<f>|\u0000/);
  assert.match(cell, /&lt;&amp;/);
  const invalidTextFiles = await build([issue({description:'完整\u0000描述\u000B仍保留'})]);
  for (const name of ['sheet1', 'sheet2']) assert.doesNotMatch(invalidTextFiles[`xl/worksheets/${name}.xml`], /[\u0000\u000B]/);
  assert.equal(context.xlsxIssueDescription({title:'【UI】标题',description:'标题\n详情'}), '标题\n详情');
});

test('跟进字段前置且有有效下拉规则、条件格式和编号键关联', async () => {
  const files = await build();
  const list = files['xl/worksheets/sheet2.xml'], evidence = files['xl/worksheets/sheet1.xml'];
  for (const [col,label] of [['D','优先级'],['E','影响程度'],['F','负责人'],['G','处理状态'],['H','修复版本']]) assert.match(list, new RegExp(`<c r="${col}4"[^>]*>.*?${label}`));
  assert.match(list, /dataValidations count="3"/);
  for (const col of ['D','E','G']) assert.match(list, new RegExp(`sqref="${col}5:${col}5"`));
  assert.match(list, /errorStyle="stop"/); assert.match(list, /已解决/);
  assert.match(evidence, /MATCH\(\$A5,'问题清单'!\$A\$5:\$A\$5,0\)/);
  assert.match(evidence, /INDEX\('问题清单'!\$C\$5:\$C\$5/);
  assert.match(evidence, /COUNTA\('问题清单'!\$A\$5:\$A\$5\)/);
  assert.match(files['xl/worksheets/_rels/sheet2.xml.rels'], /Target="https:\/\/example.test\/project\?a=1&amp;b=2"/);
});

test('截图只嵌入证据页，匹配当前附件而非旧资产，等比缩放并落在本行', async () => {
  const blob = new Blob(['png'], {type:'image/png'});
  const files = await build([issue({attachments:{context:'ctx', detail:'detail'}})], [
    {id:'stale',issueId:'i1',kind:'detail',blob,width:1,height:1},
    {id:'ctx',issueId:'i1',kind:'context',blob,width:1600,height:1000},
    {id:'detail',issueId:'i1',kind:'detail',blob,width:800,height:80}
  ]);
  assert.equal(Object.keys(files).filter((key) => key.startsWith('xl/media/')).length, 2);
  assert.doesNotMatch(files['xl/worksheets/sheet2.xml'], /<drawing/);
  const drawing = files['xl/drawings/drawing1.xml'];
  const anchors = [...drawing.matchAll(/<xdr:oneCellAnchor>(.*?)<\/xdr:oneCellAnchor>/g)].map((match) => match[1]);
  assert.equal(anchors.length, 2);
  for (const [index,anchor] of anchors.entries()) {
    assert.match(anchor, new RegExp(`<xdr:col>${index + 2}</xdr:col>`));
    assert.match(anchor, /<xdr:row>4<\/xdr:row>/);
    const [,w,h] = anchor.match(/<xdr:ext cx="(\d+)" cy="(\d+)"/);
    assert.ok(Math.abs(Number(w)/Number(h) - [10,1.6][index]) < .0001);
    assert.ok(Number(h)/9525 <= 152);
    assert.match(anchor, /noChangeAspect="1"/);
  }
  assert.match(files['xl/worksheets/sheet2.xml'], /location="'证据预览'!C5"|location="&#39;证据预览&#39;!C5"/);
});

test('空问题和缺失截图有明确占位，不产生无效范围或悬空图片关系', async () => {
  const files = await build([]);
  assert.doesNotMatch(files['xl/worksheets/sheet2.xml'], /<autoFilter|<dataValidation|<drawing/);
  assert.match(files['xl/worksheets/sheet1.xml'], /本次没有可导出的问题/);
  assert.doesNotMatch(files['xl/worksheets/sheet1.xml'], /A5:A4/);
  assert.ok(!files['xl/drawings/drawing1.xml']);
  const missing = await build([issue({attachments:{context:'missing'}})], [{id:'old',issueId:'i1',kind:'context'}]);
  assert.match(missing['xl/worksheets/sheet1.xml'], /未记录全景截图/);
});

test('内容行高有上限且短问题不会保留截图高度；文本更长时适当增加', () => {
  assert.equal(context.xlsxRowHeight(['简短问题'], [42], 48), 48);
  assert.ok(context.xlsxRowHeight(['长段落'.repeat(30)], [42], 48) > 48);
  assert.equal(context.xlsxRowHeight(['很长'.repeat(5000)], [28], 48), 409);
});
