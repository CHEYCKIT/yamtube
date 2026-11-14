const assert = require('node:assert/strict')

module.exports = async ({app,page}) => {
  // Isolate Home's layout from live search availability. Real Shorts renderer
  // mapping is covered by the core unit tests.
  await app.evaluate(({ipcMain}) => {
    const video = (id,title) => ({
      videoId:id,title,channelId:null,channelName:'Fixture channel',
      thumbnailUrl:null,durationText:'1:05',viewCountText:null,publishedText:null
    })
    const feed = ['aaaaaaaaaaa','bbbbbbbbbbb','ccccccccccc','ddddddddddd',
      'eeeeeeeeeee','fffffffffff','ggggggggggg'].map((id,i)=>video(id,`Video ${i+1}`))
    const shorts = 'hijklmnopqrs'.split('').map((letter,index) =>
      ({ ...video(letter.repeat(11), 'Recommended Short '+(index+1)), durationText:null }))
    ipcMain.removeHandler('youtube:get-home-feed')
    ipcMain.handle('youtube:get-home-feed', () => ({ok:true,data:feed,home:{
      shorts, topics:['All','Science','Music'], sessionId:'fixture-home', hasMore:true
    }}))
    const more = [video('bbbbbbbbbbb','Already loaded'),
      ...['kkkkkkkkkkk','lllllllllll','mmmmmmmmmmm','nnnnnnnnnnn'].map((id,i)=>video(id,'More video '+(i+1)))]
    ipcMain.removeHandler('youtube:get-home-more')
    ipcMain.handle('youtube:get-home-more', (_event,sessionId) => sessionId === 'fixture-home'
      ? {ok:true,data:more,home:{shorts:[],sessionId,hasMore:false}}
      : {ok:false,error:'Bad continuation session'})
    ipcMain.removeHandler('youtube:get-home-topic')
    ipcMain.handle('youtube:get-home-topic', (_event,{sessionId,topic}) => sessionId !== 'fixture-home'
      ? {ok:false,error:'Bad topic session'}
      : {ok:true,data:topic ? [video('ooooooooooo','Science video')] : feed,
        home:{shorts:[],topics:['All','Science','Music'],sessionId:'fixture-topic',hasMore:false}})
  })
  // TabRoutePages keeps previously visited Home pages mounted. A reload
  // discards the old feed and ensures Home picks up this deterministic fixture.
  await page.reload()
  // A reload preserves the current hash (often /account at the end of smoke).
  // Navigate to the now-fresh Home route after restoring the renderer.
  await page.locator('a[href="#/"]:visible').first().click()
  await page.getByRole('heading',{name:'For you',exact:true}).waitFor()

  const sectionTitles=await page.locator('section[aria-label="Home"]:visible h2').allTextContents()
  assert.deepEqual(sectionTitles,['For you','Shorts'])
  assert.equal(await page.getByRole('heading',{name:'More to explore',exact:true}).count(),0)
  const firstRow=page.locator('section[aria-label="Home"]:visible [data-home-first-row] [data-video-id]')
  const regularGrid=page.locator('section[aria-label="Home"]:visible [data-home-video-grid] [data-video-id]')
  assert.equal(await firstRow.count(),3,'first For you row must have three equally sized cards')
  assert.equal(await regularGrid.count(),4,'the rest of For you continues in the normal grid')
  const firstSizes=await firstRow.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width))
  assert.ok(firstSizes.every(width=>Math.abs(width-firstSizes[0])<2),JSON.stringify(firstSizes))
  const showMore=page.getByRole('button',{name:'Show more',exact:true})
  await showMore.click()
  await page.waitForFunction(()=>document.querySelectorAll('section[aria-label="Home"] [data-home-video-grid] [data-video-id]').length===8)
  assert.equal(await firstRow.count(),3)
  assert.equal(await regularGrid.count(),8,'continuation should append unique videos below the first row')
  assert.equal(await showMore.count(),0,'Show more must disappear after YouTube has no continuation')
  console.log('PASS: Home uses one For you feed, three equal cards first, paginates without duplicates')
  assert.equal(await page.locator('[data-home-shorts-strip]:visible [data-video-id]').count(),12)
  const strip=page.locator('[data-home-shorts-strip]:visible')
  const layout=await strip.evaluate(element=>({
    display:getComputedStyle(element).display,
    wrap:getComputedStyle(element).flexWrap,
    width:element.firstElementChild?.getBoundingClientRect().width
  }))
  assert.equal(layout.display,'flex')
  assert.equal(layout.wrap,'nowrap')
  assert.ok(layout.width>100 && layout.width<=160,JSON.stringify(layout))
  const firstShort=strip.locator('[data-video-id="hhhhhhhhhhh"] a[aria-label="Recommended Short 1"]').first()
  assert.equal(await firstShort.getAttribute('href'),'#/watch/hhhhhhhhhhh')
  const carousel=page.locator('section[aria-label="Shorts"]:visible [data-shorts-carousel="home"]')
  const next=carousel.getByRole('button',{name:'Next Shorts',exact:true})
  await next.waitFor()
  assert.equal(await carousel.getByRole('button',{name:'Previous Shorts',exact:true}).count(),0)
  const [carouselBox,nextBox]=await Promise.all([carousel.boundingBox(),next.boundingBox()])
  assert.ok(Math.abs(carouselBox.x+carouselBox.width-nextBox.x-nextBox.width)<3,
    'next arrow must overlay the rightmost edge, not the heading')
  await next.click()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-home-shorts-strip]')]
    .some(element => element.getClientRects().length && element.scrollLeft>50))
  const previous=carousel.getByRole('button',{name:'Previous Shorts',exact:true})
  await previous.waitFor()
  const [carouselLeft,previousBox]=await Promise.all([carousel.boundingBox(),previous.boundingBox()])
  assert.ok(Math.abs(carouselLeft.x-previousBox.x)<3,
    'previous arrow must overlay the leftmost edge')
  await previous.click()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-home-shorts-strip]')]
    .some(element => element.getClientRects().length && element.scrollLeft<2))
  assert.equal(await previous.count(),0)
  console.log('PASS: Home Shorts arrows overlay row edges, navigate both directions and hide at the start')
  // Topic filters are optional and default to hidden; account-curated choices
  // are shown only when a signed-in YouTube profile provides native chips.
  assert.equal(await page.locator('[data-home-topics]:visible').count(),0)
  const priorPreferences=await page.evaluate(()=>window.api.getAppPreferences())
  const priorAccount=await page.evaluate(()=>window.api.getYoutubeAccount())
  await page.evaluate(async () => {
    const previous=await window.api.getAppPreferences()
    await window.api.setAppPreferences({...previous,showHomeTopics:true})
    window.dispatchEvent(new Event('worldtube:preferences-changed'))
  })
  await app.evaluate(({BrowserWindow}) => {
    const account={signedIn:true,name:'Fixture YouTube',avatarUrl:null,persistent:true,error:null,syncError:null}
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('youtube:account-state',account)
    }
  })
  const chips=page.locator('section[aria-label="Home"]:visible [data-home-topics]')
  await chips.getByRole('button',{name:'Science'}).waitFor()
  assert.equal(await chips.getByRole('button',{name:'Gaming'}).count(),0,
    'topic filter should not invent categories not supplied by the signed-in account')
  await chips.getByRole('button',{name:'Science'}).click()
  await page.getByText('Science video',{exact:true}).waitFor()
  assert.equal(await firstRow.count(),1)
  assert.equal(await chips.getByRole('button',{name:'Science'}).getAttribute('aria-pressed'),'true')
  await chips.getByRole('button',{name:'All'}).click()
  await page.locator('section[aria-label="Home"]:visible').getByText('Video 1',{exact:true}).first().waitFor()
  assert.equal(await firstRow.count(),3)
  await page.evaluate(async prefs => {
    await window.api.setAppPreferences(prefs)
    window.dispatchEvent(new Event('worldtube:preferences-changed'))
  },priorPreferences)
  await app.evaluate(({BrowserWindow},account) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('youtube:account-state',account)
    }
  },priorAccount)
  console.log('PASS: optional Home chips use signed-in account topics and filter actual For you results')
  await page.locator('a[href="#/liked"]:visible').first().click()
  await page.getByRole('heading',{name:'Likes',exact:true}).waitFor()
  await page.getByText('Connect your YouTube account to see your liked videos.',{exact:false}).waitFor()
  console.log('PASS: Likes sidebar route requests a YouTube account when signed out')
}
