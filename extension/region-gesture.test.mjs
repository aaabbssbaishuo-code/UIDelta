import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./content.js',import.meta.url),'utf8');
function fixture(){
  const window={innerWidth:900,innerHeight:700};
  const context=vm.createContext({window});
  vm.runInContext(source.slice(source.indexOf('  const ROOT_ATTRIBUTE'),source.indexOf('  const review = new UIDeltaReview();'))+'\nglobalThis.Review=UIDeltaReview;',context);
  const classes=new Set();
  const review=Object.assign(Object.create(context.Review.prototype),{enabled:true,browseMode:false,regionBox:{style:{},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}},host:{},showToast(){}});
  return {review,classes};
}
test('连续框选重置旧状态，松开后边框停止跟随',()=>{
  const {review,classes}=fixture();
  for(let i=0;i<3;i++){
    review.startRegionSelection(100+i*10,100);
    assert.equal(review.pendingRegionRect,null);assert.equal(classes.has('editable'),false);
    review.updateRegionSelection(300,250);
    review.onDocumentPointerUp({button:0,clientX:300,clientY:250,preventDefault(){},stopImmediatePropagation(){}});
    assert.equal(review.regionSelection,null);assert.equal(classes.has('editable'),true);
    const rect=JSON.stringify(review.pendingRegionRect);
    review.updateRegionSelection(800,600);
    assert.equal(JSON.stringify(review.pendingRegionRect),rect);
  }
});
test('UI 隔离仍将松开事件交给框选和调整手势',()=>{
  const {review}=fixture();
  const target={dispatchEvent:()=>true};
  class Event {constructor(type,init){Object.assign(this,init);this.type=type;}preventDefault(){}stopImmediatePropagation(){}composedPath(){return [target,review.host];}}
  review.startRegionSelection(100,100);
  review.onToolbarPageEvent(new Event('pointerup',{button:0,clientX:260,clientY:200}));
  assert.equal(review.regionSelection,null);assert.equal(review.pendingRegionRect.width,160);
  review.regionEdit={mode:'move'};
  review.onToolbarPageEvent(new Event('pointerup',{button:0}));
  assert.equal(review.regionEdit,null);
});
test('拖动越过 UI 仍更新；丢失松开或取消不会留下无限框选',()=>{
  const {review}=fixture();review.updatePinHover=()=>{throw Error('gesture must precede hover');};
  review.startRegionSelection(100,100);
  review.onPointerMove({buttons:1,clientX:400,clientY:300});
  assert.equal(review.regionBox.style.width,'300px');
  review.onPointerMove({buttons:0,clientX:500,clientY:400});
  assert.equal(review.regionSelection,null);assert.equal(review.regionBox.style.display,'none');
  review.startRegionSelection(100,100);review.cancelRegionGesture();
  assert.equal(review.regionSelection,null);
});
test('小框选不会保留上一轮选区，记录按钮不启动移动',()=>{
  const {review}=fixture();review.startRegionSelection(100,100);review.finishRegionSelection(200,200);
  review.beginRegionEdit({button:0,target:{closest:()=>true}});assert.equal(review.regionEdit,null);
  review.startRegionSelection(10,10);review.finishRegionSelection(12,12);
  assert.equal(review.pendingRegionRect,null);assert.equal(review.regionBox.style.display,'none');
});
