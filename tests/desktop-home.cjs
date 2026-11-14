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
    ipcMain.handle('youtube:get-home-feed', () => ({ok:true,data:feed,home:{shorts}}))
  })
  // TabRoutePages keeps previously visited Home pages mounted. A reload
  // discards the old feed and ensures Home picks up this deterministic fixture.
  await page.reload()
  // A reload preserves the current hash (often /account at the end of smoke).
  // Navigate to the now-fresh Home route after restoring the renderer.
  await page.locator('a[href="#/"]:visible').first().click()
  await page.getByRole('heading',{name:'More to explore',exact:true}).waitFor()

  const sectionTitles=await page.locator('section[aria-label="Home"]:visible h2').allTextContents()
  assert.deepEqual(sectionTitles,['For you','More to explore','Shorts'])
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
  await page.locator('a[href="#/liked"]:visible').first().click()
  await page.getByRole('heading',{name:'Likes',exact:true}).waitFor()
  await page.getByText('Connect your YouTube account to see your liked videos.',{exact:false}).waitFor()
  console.log('PASS: Likes sidebar route requests a YouTube account when signed out')
}
