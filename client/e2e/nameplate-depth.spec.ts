import { expect, test } from '@playwright/test';

test('real nameplate fragments are occluded by walls, remain smooth, and share released resources',async({page})=>{
 await page.goto('/e2e/nameplate-harness.html');
 await page.waitForFunction(()=> 'nameplateModules' in window);
 const result=await page.evaluate(async()=>{
  const {T,SceneAssets}=(window as unknown as {nameplateModules:{T:typeof import('three');SceneAssets:typeof import('../src/render/three/SceneAssets').SceneAssets}}).nameplateModules;
  const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(256,256);renderer.autoClear=false;document.body.append(renderer.domElement);
  const gl=renderer.getContext() as WebGL2RenderingContext;
  const assets=new SceneAssets(),label=assets.label('Аня'),other=assets.label('Аня'),long=assets.label('Длинное имя игрока');
  const scene=new T.Scene(),camera=new T.OrthographicCamera(-2,2,2,-2,.1,20);camera.position.z=5;
  const wall=new T.Mesh(new T.BoxGeometry(3,2,.25),new T.MeshBasicMaterial({color:'#754d34'}));wall.position.z=1;scene.add(wall,label);
  async function samples(blocked:boolean){
   label.visible=false;wall.visible=blocked;renderer.clear();renderer.render(scene,camera);
   wall.visible=false;label.visible=true;
   const query=gl.createQuery()!;gl.beginQuery(gl.ANY_SAMPLES_PASSED,query);renderer.render(scene,camera);gl.endQuery(gl.ANY_SAMPLES_PASSED);gl.flush();
   const deadline=performance.now()+5000;
   while(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){if(performance.now()>deadline)throw new Error('GPU query timed out');await new Promise(resolve=>setTimeout(resolve,16));}
   const visible=Boolean(gl.getQueryParameter(query,gl.QUERY_RESULT));gl.deleteQuery(query);return visible;
  }
  const blocked=await samples(true),clear=await samples(false);
  const style={depthTest:label.material.depthTest,depthWrite:label.material.depthWrite,toneMapped:label.material.toneMapped,linear:label.material.map!.magFilter===T.LinearFilter,proportional:long.scale.x>label.scale.x,sameHeight:long.scale.y===label.scale.y,shared:label.material===other.material};
  let released=0;label.material.map!.addEventListener('dispose',()=>released++);assets.release(label);const whileShared=released;assets.release(other);const afterLast=released;
  assets.release(long);assets.dispose();wall.geometry.dispose();wall.material.dispose();renderer.dispose();renderer.domElement.remove();
  return {blocked,clear,style,whileShared,afterLast};
 });
 expect(result).toEqual({blocked:false,clear:true,style:{depthTest:true,depthWrite:false,toneMapped:false,linear:true,proportional:true,sameHeight:true,shared:true},whileShared:0,afterLast:1});
});
