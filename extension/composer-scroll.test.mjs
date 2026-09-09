import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./content.js', import.meta.url), 'utf8');
const rect = (left, top, width = 160, height = 60) => ({left, top, width, height, right:left + width, bottom:top + height});

function harness({measurement = true} = {}) {
  class Element {
    constructor(id, bounds) {
      this.id = id; this.label = id; this.bounds = bounds; this.isConnected = true;
      this.style = {}; this.parentElement = null; this.children = [];
      this.classList = {remove(){}, toggle(){}};
    }
    getBoundingClientRect() { return {...this.bounds}; }
    getRootNode() { return {}; }
    closest() { return null; }
    replaceChildren(...children) { this.children = children; }
  }
  const location = {href:'https://example.test/review'};
  const window = {innerWidth:1200, innerHeight:800, scrollX:0, scrollY:0,
    getComputedStyle:element => element.overflow || {overflowX:'visible',overflowY:'visible'}};
  const sandbox = {window, location, Element, HTMLElement:Element, document:{}, performance:{timeOrigin:42}, structuredClone};
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf('  const ROOT_ATTRIBUTE'), source.indexOf('  const review = new UIDeltaReview();')) + '\nglobalThis.ReviewClass = UIDeltaReview;', sandbox);
  const from = new Element('from',rect(100,300));
  const to = new Element('to',rect(100,500));
  const nodes = {from,to};
  const calls = {resolve:0, rendered:[]};
  const anchor = element => ({preferredSelector:element.id, text:element.label});
  const editor = Object.assign(Object.create(sandbox.ReviewClass.prototype), {
    enabled:true, currentView:'composer', browseMode:false, inspectMode:'annotation',
    selected:from, hovered:to, selectionLocked:true, isSessionActive:()=>true,
    selectedBox:new Element('selected'), hoverBox:new Element('hover'), regionBox:new Element('region'),
    tooltip:new Element('tooltip'), recordPrompt:new Element('prompt'), measurements:new Element('measurements'),
    elementAnchor:anchor, textContent:element => element.label,
    resolveAnchor:stored => { calls.resolve++; return nodes[stored?.preferredSelector] || null; },
    composedContains:(a,b) => { for(let node=b;node;node=node.parentElement) if(node===a) return true; return false; },
    hideDeliveryExampleHover(){}, clampPanelToViewport(){}, renderPins(){},
    renderMeasurementSnapshot:snapshot => { calls.rendered.push(snapshot); editor.measurements.children = snapshot.segments; },
    renderComposer(){ assert.fail('滚动不能重建表单'); }, updateInspector(){ assert.fail('记录期间不能改检查目标'); }
  });
  const snapshot = measurement ? editor.buildMeasurementSnapshot(from,to) : null;
  editor.composer = {issue:{id:'i1',elementAnchor:anchor(to),measurement:snapshot,attachments:{context:'c',detail:'d'},pageSnapshot:{url:location.href,scroll:{x:0,y:0}}},targetElement:to};
  const input = {value:'正在输入的描述',selectionStart:2,selectionEnd:5};
  editor.descriptionInput = input;
  editor.shadow = {activeElement:input};
  editor.lockComposerOverlay();
  return {editor,from,to,window,location,nodes,calls,Element,input};
}

test('记录后整页滚动：框与测距重新投影到原目标，不改证据和输入', () => {
  const env = harness(); const {editor,from,to,window,input,calls} = env;
  const frozen = JSON.stringify(editor.composer.issue);
  editor.onLayoutChange();
  assert.equal(editor.selectedBox.style.top,'300px');
  assert.equal(editor.hoverBox.style.top,'500px');
  window.scrollY = 120;
  from.bounds = rect(100,180); to.bounds = rect(100,380);
  editor.onLayoutChange();
  assert.equal(editor.selectedBox.style.top,'180px');
  assert.equal(editor.hoverBox.style.top,'380px');
  const live = calls.rendered.at(-1);
  assert.equal(live.segments[0].y,240);
  assert.equal(live.segments[0].value,140);
  assert.equal(JSON.stringify(editor.composer.issue),frozen);
  assert.equal(editor.shadow.activeElement,input);
  assert.deepEqual(input,{value:'正在输入的描述',selectionStart:2,selectionEnd:5});
  assert.equal(calls.resolve,2,'不在每次滚动重新寻找可能已变化的选择器');
});

test('表格内部纵向及横向滚动跟随 DOM 实际位置，不依赖 window.scrollY', () => {
  const {editor,from,to,window,Element} = harness();
  const scroller = new Element('scroller',rect(40,100,900,600));
  scroller.overflow = {overflowX:'auto',overflowY:'auto'};
  from.parentElement = scroller; to.parentElement = scroller;
  from.bounds = rect(60,240); to.bounds = rect(60,440);
  editor.onLayoutChange();
  assert.equal(window.scrollY,0);
  assert.equal(editor.selectedBox.style.left,'60px');
  assert.equal(editor.hoverBox.style.top,'440px');
  assert.equal(editor.measurements.children[0].y,300);
});

test('目标滚出内层容器时隐藏，部分可见时裁切，滚回后恢复', () => {
  const {editor,from,to,Element} = harness();
  const scroller = new Element('scroller',rect(50,200,700,400));
  scroller.overflow = {overflowX:'hidden',overflowY:'auto'};
  from.parentElement = scroller; to.parentElement = scroller;
  to.bounds = rect(100,590);
  editor.onLayoutChange();
  assert.equal(editor.hoverBox.style.height,'10px');
  to.bounds = rect(100,610);
  editor.onLayoutChange();
  assert.equal(editor.hoverBox.style.display,'none');
  assert.equal(editor.selectedBox.style.display,'none');
  assert.equal(editor.measurements.children.length,0);
  to.bounds = rect(100,450);
  editor.onLayoutChange();
  assert.equal(editor.hoverBox.style.display,'block');
  assert.equal(editor.hoverBox.style.top,'450px');
});

test('目标移除、虚拟列表复用或切换页面后不把框绑到其他元素', () => {
  for(const change of [
    env => {env.to.isConnected = false; env.nodes.to = new env.Element('replacement',rect(0,0));},
    env => {env.to.label = '其他人员';},
    env => {env.location.href = 'https://example.test/other';}
  ]) {
    const env = harness();
    env.editor.onLayoutChange(); change(env); env.editor.onLayoutChange();
    assert.equal(env.editor.selectedBox.style.display,'none');
    assert.equal(env.editor.hoverBox.style.display,'none');
    assert.equal(env.calls.resolve,2);
    assert.equal(env.editor.composer.issue.id,'i1');
  }
});

test('记录面板暂停 hover 和重复记录提示；返回检查后恢复', () => {
  const {editor,from,to} = harness();
  editor.getTarget = () => assert.fail('记录期间不应命中鼠标下的新元素');
  editor.onPointerMove({clientX:800,clientY:600});
  assert.equal(editor.selected,from); assert.equal(editor.hovered,to);
  assert.equal(editor.isCanvasInteractionView(),false);
  editor.currentView = 'inspect'; assert.equal(editor.isCanvasInteractionView(),true);
});

test('无测距的单目标、fixed 元素和 resize 也按实时 DOM 定位', () => {
  const {editor,to,window} = harness({measurement:false});
  editor.onLayoutChange();
  assert.equal(editor.selectedBox.style.top,'500px');
  window.scrollY = 200; // fixed 元素的 getBoundingClientRect 不变。
  editor.onLayoutChange();
  assert.equal(editor.selectedBox.style.top,'500px');
  to.bounds = rect(240,180,400,80);
  editor.onLayoutChange();
  assert.equal(editor.selectedBox.style.width,'400px');
  assert.equal(editor.selectedBox.style.top,'180px');
  assert.equal(editor.hoverBox.style.display,'none');
});

test('自由框选绑定内容参照，随内层滚动；恢复的区域按文档位置定位', () => {
  const {editor,to,window} = harness({measurement:false});
  const region = rect(80,480,260,120);
  editor.deepElementsFromPoint = () => [to];
  editor.composer.issue.region = region;
  editor.composer.targetElement = null;
  editor.composer.regionTracker = editor.createRegionTracker(region);
  delete editor.composer.overlayAnchor;
  to.bounds = rect(70,420);
  editor.onLayoutChange();
  assert.equal(editor.regionBox.style.top,'400px');
  assert.equal(editor.regionBox.style.left,'50px');
  assert.equal(editor.regionBox.style.height,'120px');
  assert.equal(region.top,480);
  delete editor.composer.regionTracker;
  delete editor.composer.overlayAnchor;
  window.scrollY = 180;
  editor.onLayoutChange();
  assert.equal(editor.regionBox.style.top,'300px');
});

test('截图裁切范围使用当前锁定目标，内层滚动可被前后稳定性检查识别', () => {
  const {editor,from,to,window} = harness();
  editor.captureTargets = new Map([['capture',{element:to,composer:editor.composer,rect:rect(100,300,160,260)}]]);
  const before = editor.captureTargetState('capture');
  from.bounds = rect(100,220); to.bounds = rect(100,420);
  const after = editor.captureTargetState('capture');
  assert.equal(window.scrollY,0);
  assert.equal(after.rect.top,before.rect.top - 80);
  assert.equal(after.rect.bottom,before.rect.bottom - 80);
  assert.equal(editor.composer.issue.measurement.fromRect.top,300);
  to.isConnected = false;
  assert.equal(editor.captureTargetState('capture'),null);
});

test('普通元素无测距时也不复用旧裁切框；浏览模式不显示框', () => {
  const {editor,to} = harness({measurement:false});
  editor.captureTargets = new Map([['capture',{element:to,composer:editor.composer,rect:rect(100,500)}]]);
  to.bounds = rect(120,280);
  assert.equal(editor.captureTargetState('capture').rect.top,280);
  editor.browseMode = true; editor.onLayoutChange();
  assert.equal(editor.selectedBox.style.display,'none');
  assert.equal(editor.hoverBox.style.display,'none');
});
