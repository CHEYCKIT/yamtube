const assert=require('node:assert/strict')
const {readFile}=require('node:fs/promises')
const {join}=require('node:path')
module.exports=async({app,page,profile})=>{
  assert.equal(await page.title(),'LokTube')
  assert.equal(await page.getByText('LokTube',{exact:true}).count()>0,true)
  const parser=await app.evaluate(({app})=>{
    const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json')
    const {Parser}=require('youtubei.js')
    const malformed={videoRenderer:{videoId:'jNQXAC9IVRw',title:{simpleText:'Optional malformed renderer'},thumbnail:{thumbnails:[null]}}}
    const video={videoRenderer:{videoId:'aqz-KE-bpKQ',title:{simpleText:'Playable item'},thumbnail:{thumbnails:[]}}}
    const rows=Parser.parseArray([malformed,video])
    return {count:rows.length,title:rows[0].title.toString()}
  })
  assert.deepEqual(parser,{count:1,title:'Playable item'})
  console.log('PASS: packaged parser warning recovers instead of crashing on missing bugs.url')

  await page.locator('a[href="#/"]:visible').first().click()
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
  const card=page.locator('[data-video-id="jNQXAC9IVRw"]:visible').first()
  await card.waitFor()
  const count=await page.getByRole('tab').count()
  await card.click({button:'right'})
  await page.getByRole('menuitem',{name:'Open in new tab',exact:true}).click()
  assert.equal(await page.getByRole('tab').count(),count+1)
  // The + action belongs to the scrollable tab strip and follows the final
  // tab, rather than being pinned to the far-right edge of the entire bar.
  const tabBarLayout=await page.evaluate(()=>{
    const strip=document.querySelector('[role="tablist"]')
    const plus=strip?.querySelector('button[aria-label="New tab"]')
    const tabs=[...strip.querySelectorAll('[draggable="true"]')]
    const last=tabs.at(-1)
    return { afterLast:plus?.previousElementSibling===last,
      gap:plus.getBoundingClientRect().left-last.getBoundingClientRect().right,
      freeSpace:strip.getBoundingClientRect().right-plus.getBoundingClientRect().right,
      scrollable:strip.scrollWidth>=strip.clientWidth }
  })
  assert.equal(tabBarLayout.afterLast,true)
  assert.ok(tabBarLayout.gap>=0&&tabBarLayout.gap<=8,JSON.stringify(tabBarLayout))
  assert.ok(tabBarLayout.freeSpace>16,JSON.stringify(tabBarLayout))
  assert.equal(tabBarLayout.scrollable,true)
  console.log('PASS: new-tab button follows the last tab inside the scrolling tab strip')
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
  await card.click({button:'right'})
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('menu',{name:'Video options'}).count(),0)
  console.log('PASS: video context menu opens a background tab and dismisses with Escape')

  // Simulate an OS protocol activation. The already-open LokTube window must
  // receive the link in a new tab without destroying the original Home tab.
  await app.evaluate(({app}) => app.emit('second-instance', {},
    ['LokTube.exe', 'loktube://open?url=' + encodeURIComponent('https://www.youtube.com/results?search_query=external%20link')], ''))
  await page.waitForFunction(n => document.querySelectorAll('[role="tab"]').length === n, count + 2, { timeout: 15_000 })
  assert.match(await page.locator('[role="tab"][aria-selected="true"]').textContent(), /external link/)
  await page.getByRole('button',{name:'Close external link'}).click()
  await page.getByRole('tab',{name:'Home',exact:true}).click()
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
  assert.equal(await page.getByRole('tab').count(),count+1)
  console.log('PASS: external YouTube protocol opens a new internal tab without replacing Home')

  // Send the actual Windows BrowserWindow event through main/preload IPC.
  await page.locator('a[href="#/music"]:visible').first().click()
  await page.getByRole('heading',{name:'YouTube Music',exact:true}).waitFor()
  assert.equal(await page.getByText('All songs',{exact:true}).count()>0,true)
  await page.locator('a[href="#/account"]:visible').first().click()
  await page.getByRole('heading',{name:'Account & privacy'}).waitFor()
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].emit('app-command',{},'browser-backward'))
  await page.getByRole('heading',{name:'YouTube Music',exact:true}).waitFor()
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].emit('app-command',{},'browser-forward'))
  await page.getByRole('heading',{name:'Account & privacy'}).waitFor()
  await page.evaluate(()=>window.dispatchEvent(new MouseEvent('mouseup',{button:3,bubbles:true,cancelable:true})))
  await page.getByRole('heading',{name:'YouTube Music',exact:true}).waitFor()
  console.log('PASS: Windows Back/Forward commands and mouse side-button navigation use active-tab history')

  await app.evaluate(({ipcMain})=>{
    ipcMain.removeHandler('youtube:search')
    ipcMain.handle('youtube:search',()=>({ok:true,data:[],channels:[],collections:[]}))
  })
  await page.getByRole('textbox',{name:'Search',exact:true}).fill('fixture')
  await page.getByRole('textbox',{name:'Search',exact:true}).press('Enter')
  await page.getByRole('heading',{name:'Results for “fixture”'}).waitFor()
  await page.locator('summary').filter({hasText:/^Filters/}).click()
  const filters=page.locator('details[open]').filter({hasText:'Upload date'})
  await filters.waitFor()
  const filterText=await filters.textContent()
  for(const label of ['Upload date','Any time','Any duration']) assert.equal(filterText.includes(label),true,label)
  assert.equal(await page.getByText('Fecha de subida',{exact:true}).count(),0)
  console.log('PASS: English search filters and music UI')

  const media=await readFile(join(__dirname,'fixtures/playback.webm'))
  const blob=await page.evaluate((bytes)=>URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'video/webm'})),[...media])
  await app.evaluate(({ipcMain},url)=>{
    globalThis.__featurePlaybackRequests=[]
    ipcMain.removeHandler('youtube:get-video-info')
    ipcMain.handle('youtube:get-video-info',(_event,{videoId})=>{
      globalThis.__featurePlaybackRequests.push(videoId)
      return {ok:true,data:{playbackToken:'',videoId,title:'Playback fixture',channelId:null,channelName:'Fixture creator',
        channelThumbnailUrl:null,subscriberCountText:null,captions:[],storyboardVtt:null,
        relatedVideos:[{videoId:'aqz-KE-bpKQ',title:'Next fixture',channelId:null,channelName:'Fixture creator',thumbnailUrl:null,durationText:'0:20',viewCountText:null,publishedText:null}],
        thumbnailUrl:null,lengthSeconds:20,durationText:'0:20',viewCountText:null,likeCountText:null,publishedText:null,category:null,description:null,
        dashManifest:null,sabr:null,liveManifests:[{url,mimeType:'video/webm'}]}}
    })
  },blob)
  await page.locator('a[href="#/"]:visible').first().click()
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
  await page.locator('[data-video-id="jNQXAC9IVRw"]:visible').first().click({button:'right'})
  await page.getByRole('menuitem',{name:'Play in mini player',exact:true}).click()
  await page.waitForFunction(()=>[...document.querySelectorAll('video')].some(video=>!video.paused&&video.currentTime>0.05))
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
  assert.equal(await page.getByRole('tab').count(),count+1)
  assert.equal((await app.evaluate(()=>globalThis.__featurePlaybackRequests)).includes('jNQXAC9IVRw'),true)
  console.log('PASS: context menu starts real local media in the mini player without leaving the browsing page')

  await page.locator('.shaka-overflow-menu-button:visible').first().click({force:true})
  const autoplay=page.locator('.shaka-autoplay-button:visible').first()
  await autoplay.waitFor()
  assert.equal(await autoplay.getAttribute('aria-checked'),'true')
  await autoplay.click()
  await page.waitForFunction(async()=> (await window.api.getAppPreferences()).autoplayNext===false)
  // The preferences IPC commit can resolve before its React context update.
  // Confirm the Shaka control reflects the new preference before simulating
  // the media ending, rather than racing against the previous listener.
  await page.waitForFunction(()=>document.querySelector('.shaka-autoplay-button')?.getAttribute('aria-checked')==='false')
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  const requested=await app.evaluate(()=>globalThis.__featurePlaybackRequests.length)
  await page.evaluate(()=>{const video=[...document.querySelectorAll('video')].find(item=>!item.paused);video.currentTime=video.duration-0.05})
  await page.waitForFunction(()=>[...document.querySelectorAll('video')].some(video=>video.ended))
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  assert.equal(await app.evaluate(()=>globalThis.__featurePlaybackRequests.length),requested)
  assert.equal(JSON.parse(await readFile(profile.dataPath,'utf8')).settings.appPreferences.autoplayNext,false)
  // Keep changing an unrelated setting from resetting autoplay.
  await page.evaluate(async()=>{const pref=await window.api.getAppPreferences();await window.api.setAppPreferences({language:pref.language,checkForUpdatesOnStartup:!pref.checkForUpdatesOnStartup})})
  assert.equal((await page.evaluate(()=>window.api.getAppPreferences())).autoplayNext,false)
  console.log('PASS: player settings persist autoplay off and the video ends without advancing')
  if(!await page.locator('.shaka-autoplay-button:visible').count()) await page.locator('.shaka-overflow-menu-button:visible').first().click({force:true})
  await page.locator('.shaka-autoplay-button:visible').first().click()
  await page.waitForFunction(async()=> (await window.api.getAppPreferences()).autoplayNext===true)
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await page.evaluate(async()=>{const video=[...document.querySelectorAll('video')].find(item=>item.ended);video.currentTime=0;await video.play();video.currentTime=video.duration-0.05})
  for(let i=0;i<100;i++){if((await app.evaluate(()=>globalThis.__featurePlaybackRequests)).includes('aqz-KE-bpKQ'))break;await new Promise(resolve=>setTimeout(resolve,50))}
  assert.equal((await app.evaluate(()=>globalThis.__featurePlaybackRequests)).includes('aqz-KE-bpKQ'),true)
  console.log('PASS: turning autoplay back on advances to the next video')


  await page.screenshot({path:'.cache/yamtube-mini-player.png',fullPage:true})
  await require('./desktop-theater.cjs')({app,page})
  await require('./desktop-pip.cjs')({app,page})
  await require('./desktop-fullscreen.cjs')({app,page})
  await page.locator('a[href="#/account"]:visible').first().click()
  await page.getByRole('heading',{name:'Account & privacy'}).waitFor()
  await app.evaluate(()=>console.warn('Diagnostics fixture', {Cookie:'SID=diagnostics-secret; SAPISID=diagnostics-secret',authorization:'Bearer diagnostics-secret',poToken:'diagnostics-secret'}))
  await page.getByRole('button',{name:'View logs',exact:true}).click()
  await page.getByLabel('Recent diagnostic logs').waitFor()
  const contents=await page.getByLabel('Recent diagnostic logs').textContent()
  assert.equal(contents.includes('Diagnostics fixture'),true)
  assert.equal(contents.includes('diagnostics-secret'),false)
  const exported=join(profile.dataPath,'..','diagnostics-export.txt')
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file})},exported)
  await page.getByRole('button',{name:'Export logs',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Logs exported to'}).waitFor()
  assert.equal((await readFile(exported,'utf8')).includes('diagnostics-secret'),false)
  console.log('PASS: settings show recent logs and export them with credentials redacted')
  await require('./desktop-sabr.cjs')({app,page})
}
