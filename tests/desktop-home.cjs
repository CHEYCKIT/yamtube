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
    const shorts = [
      {...video('hhhhhhhhhhh','Recommended Short 1'),durationText:null},
      {...video('iiiiiiiiiii','Recommended Short 2'),durationText:null}
    ]
    ipcMain.removeHandler('youtube:get-home-feed')
    ipcMain.handle('youtube:get-home-feed', () => ({ok:true,data:feed,home:{shorts}}))
  })
  // TabRoutePages keeps previously visited Home pages mounted. A reload
  // discards the old feed and ensures Home picks up this deterministic fixture.
  await page.reload()
  await page.getByRole('heading',{name:'More to explore',exact:true}).waitFor()

  const sectionTitles=await page.locator('section[aria-label="Home"] h2').allTextContents()
  assert.deepEqual(sectionTitles,['For you','More to explore','Shorts'])
  assert.equal(await page.locator('[data-home-shorts-strip] [data-video-id]').count(),2)
  const strip=page.locator('[data-home-shorts-strip]')
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
  console.log('PASS: Home contains For you, More to explore and one compact scrollable Shorts strip only')
}
