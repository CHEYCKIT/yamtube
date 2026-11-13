const assert=require('node:assert/strict')
module.exports=async({app,page})=>{
  await app.evaluate(({BrowserWindow})=>{
    const window=BrowserWindow.getAllWindows()[0]
    window.__controlOriginals=Object.fromEntries(['minimize','maximize','unmaximize','close','isMaximized'].map(key=>[key,window[key]]))
    window.__controlProbe={minimize:0,maximize:0,unmaximize:0,close:0,maximized:false}
    window.minimize=()=>{window.__controlProbe.minimize++}
    window.maximize=()=>{window.__controlProbe.maximize++;window.__controlProbe.maximized=true;window.emit('maximize')}
    window.unmaximize=()=>{window.__controlProbe.unmaximize++;window.__controlProbe.maximized=false;window.emit('unmaximize')}
    window.close=()=>{window.__controlProbe.close++}
    window.isMaximized=()=>window.__controlProbe.maximized
  })
  try{
    await page.getByRole('button',{name:'Maximize window',exact:true}).click()
    await page.getByRole('button',{name:'Restore window',exact:true}).click()
    await page.getByRole('button',{name:'Minimize window',exact:true}).click()
    await page.getByRole('button',{name:'Close window',exact:true}).click()
    const result=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].__controlProbe)
    assert.deepEqual(result,{minimize:1,maximize:1,unmaximize:1,close:1,maximized:false})
  }finally{
    await app.evaluate(({BrowserWindow})=>{
      const window=BrowserWindow.getAllWindows()[0]
      Object.assign(window,window.__controlOriginals)
    })
  }
  assert.equal(await page.locator('header.wt-topbar').evaluate(node=>getComputedStyle(node).getPropertyValue('-webkit-app-region')),'drag')
  assert.equal(await page.getByRole('link',{name:'Return home',exact:true}).evaluate(node=>getComputedStyle(node).getPropertyValue('-webkit-app-region')),'no-drag')
  assert.equal(await page.getByRole('button',{name:'Close window',exact:true}).evaluate(node=>getComputedStyle(node).getPropertyValue('-webkit-app-region')),'no-drag')
  console.log('PASS: integrated window buttons reach their owning native window, maximize state updates and interactive controls stay outside the drag region')
}
